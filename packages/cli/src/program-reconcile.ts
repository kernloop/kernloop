/**
 * The RECONCILE half of `kernloop program` (spec §5.4; CLM-0102, #87). The
 * program ledger records the refs WE set; it cannot read GitHub issue state
 * back. This verb closes that gap: it READS each `emitted` node's GitHub issue
 * via the hardened @kernloop/tracker `getIssue` op and, GitHub being the live
 * AUTHORITY, advances a node `emitted → done` when its issue is CLOSED. The
 * ledger is thereby a reconciled cache of GitHub, not an independent record.
 *
 * The gh READ happens regardless of tier — a read is NOT a mutation, like
 * `models sync` — so reconcile never requires the `enforce` tier to look. Only
 * the LOCAL ledger write is gated: dry-run (the default) prints the would-be
 * reconciliation diff and writes NOTHING; `--execute` applies the
 * `emitted → done` advances. Every run is audited ONCE (`cli.program.reconcile`)
 * with counts only — never a goal/body. A node whose read FAILS is reported and
 * left unchanged, and any read failure makes the whole run exit 1 (a broken
 * reconcile is visible). Errors-as-clean-exit; mutates nothing on a failed read.
 */
import { appendEvent } from '@kernloop/kernel';
import {
  githubProvider,
  type GithubProviderHandle,
  type IssueState,
  type TrackerExec,
} from '@kernloop/tracker';
import type { CliIo } from './cli.js';
import type { Kernloop } from './kernel.js';
import { checkIdLength, ProgramInputError } from './program-shared.js';
import type { ProgramNodeRow } from './program-store.js';

/** What reconcile decides for one emitted node after reading its GitHub issue. */
type ReconcileAction = 'advance-to-done' | 'no-change' | 'read-failed';

/** One node's reconciliation outcome row (the printable per-node result). */
interface ReconcileNodeResult {
  readonly nodeId: string;
  readonly issueRef: string;
  readonly githubState?: IssueState;
  readonly action: ReconcileAction;
  readonly reason?: string;
}

/** The JSON the reconcile verb prints. */
interface ReconcileReport {
  readonly op: 'reconcile';
  readonly mode: 'dry-run' | 'execute';
  readonly programId: string;
  readonly notice: string;
  readonly checked: number;
  readonly closed: number;
  readonly advanced: number;
  readonly readFailed: number;
  readonly nodes: ReconcileNodeResult[];
}

/** Read one emitted node's GitHub issue state and decide its action (no write). */
async function classifyNode(
  provider: GithubProviderHandle,
  row: ProgramNodeRow,
  issueRef: string,
): Promise<ReconcileNodeResult> {
  const read = await provider.getIssue(issueRef);
  if (!read.ok) {
    return { nodeId: row.nodeId, issueRef, action: 'read-failed', reason: read.reason };
  }
  const action: ReconcileAction = read.state === 'closed' ? 'advance-to-done' : 'no-change';
  return { nodeId: row.nodeId, issueRef, githubState: read.state, action };
}

/** Apply the `emitted → done` advance for every closed-issue node (execute only). */
function applyAdvances(
  kern: Kernloop,
  programId: string,
  results: readonly ReconcileNodeResult[],
): number {
  let advanced = 0;
  for (const r of results) {
    if (r.action === 'advance-to-done') {
      kern.programs.advanceNode({ programId, nodeId: r.nodeId, state: 'done' });
      advanced += 1;
    }
  }
  return advanced;
}

/** The dry-run/execute notice line. */
function reconcileNotice(mode: 'dry-run' | 'execute'): string {
  return mode === 'execute'
    ? 'EXECUTE — closed-issue nodes advanced emitted → done in the ledger'
    : 'DRY RUN — GitHub read only; ledger unchanged (pass --execute to advance)';
}

/** Audit the reconcile ONCE — counts only, never a goal/body. */
function auditReconcile(
  kern: Kernloop,
  args: {
    programId: string;
    mode: 'dry-run' | 'execute';
    checked: number;
    closed: number;
    advanced: number;
    readFailed: number;
  },
): void {
  appendEvent(kern.store, {
    type: 'cli.program.reconcile',
    payload: {
      op: 'reconcile',
      programId: args.programId,
      mode: args.mode,
      checked: args.checked,
      closed: args.closed,
      advanced: args.advanced,
      readFailed: args.readFailed,
    },
  });
}

/** Build the GitHub provider for reconcile. Mode is moot for the READ (getIssue
 * ignores it), so we build a dry-run provider — the read still happens, and no
 * write op is ever called against it. A missing tracker block is a clean error. */
function buildReadProvider(kern: Kernloop, exec: TrackerExec | undefined): GithubProviderHandle {
  const cfg = kern.config.tracker;
  if (cfg === undefined) {
    throw new ProgramInputError(
      'no tracker configured — add tracker: { provider: github, repo: owner/name } to overlay.yaml',
    );
  }
  return exec === undefined
    ? githubProvider({ repo: cfg.repo }, 'dry-run')
    : githubProvider({ repo: cfg.repo }, 'dry-run', exec);
}

/**
 * Run `kernloop program reconcile --program <id> [--execute]` [CLM-0102, #87]:
 * load the persisted program (absent → clean exit 1), select its `emitted`
 * nodes that carry an `issueRef`, READ each one's GitHub issue state via the
 * tracker (the read happens at any tier — it is not a mutation), and decide per
 * node: a closed issue ⇒ `advance-to-done`, an open one ⇒ `no-change`, a failed
 * read ⇒ `read-failed`. In dry-run (default) it prints the diff and writes
 * NOTHING; `--execute` advances each closed-issue node `emitted → done`. Audits
 * once with counts; exits 1 if ANY read failed (else 0). Mutates nothing on a
 * read failure for that node.
 */
export async function reconcileOp(
  kern: Kernloop,
  io: CliIo,
  programId: string,
  executeFlag: boolean,
  exec: TrackerExec | undefined,
): Promise<number> {
  checkIdLength(programId);
  if (kern.programs.getProgram(programId) === undefined) {
    throw new ProgramInputError(`no program "${programId}" in the ledger`);
  }
  const emitted = kern.programs
    .listNodes(programId)
    .filter((n) => n.state === 'emitted' && n.issueRef !== null && n.issueRef !== '');
  const provider = buildReadProvider(kern, exec);
  const nodes: ReconcileNodeResult[] = [];
  for (const row of emitted) {
    nodes.push(await classifyNode(provider, row, row.issueRef as string));
  }
  const mode: 'dry-run' | 'execute' = executeFlag ? 'execute' : 'dry-run';
  const closed = nodes.filter((n) => n.action === 'advance-to-done').length;
  const readFailed = nodes.filter((n) => n.action === 'read-failed').length;
  const advanced = mode === 'execute' ? applyAdvances(kern, programId, nodes) : 0;
  auditReconcile(kern, { programId, mode, checked: nodes.length, closed, advanced, readFailed });
  const report: ReconcileReport = {
    op: 'reconcile',
    mode,
    programId,
    notice: reconcileNotice(mode),
    checked: nodes.length,
    closed,
    advanced,
    readFailed,
    nodes,
  };
  io.out(JSON.stringify(report, null, 2));
  return readFailed > 0 ? 1 : 0;
}
