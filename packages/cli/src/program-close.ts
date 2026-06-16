/**
 * The CLOSE half of `kernloop program` (EPIC #50 increment 1, CLM-0116): the
 * LEDGER-driven inverse of `reconcile`. Where `reconcile` lets GitHub be the
 * authority (a closed issue advances a node to `done`), `close` lets the LEDGER
 * be the authority: for each node the ledger already holds in `done` state with
 * a filed `issueRef`, it closes that GitHub issue via the hardened @kernloop/
 * tracker `closeIssue` op — reflecting "this work is done per the ledger" to the
 * tracker.
 *
 * SAFE-half discipline (#50): this never crosses a tier on its own and NEVER
 * auto-merges anything. The gh READ (getIssue, to skip an already-closed issue)
 * runs at any tier — a read is not a mutation. The CLOSE is double-gated:
 * `--execute` AND `tracker.tier: enforce` (resolveMode); otherwise it stays a
 * dry-run that proposes the would-be closes and writes nothing. This is the
 * LEDGER-driven closure; the run-success-driven counterpart is `kernloop run
 * --closes-issue` (#211, CLM-0118), which shares the same gated close primitive
 * ({@link closeOneIssue}). Audited once (`cli.program.close`) with counts only —
 * never a goal or body.
 */
import { appendEvent } from '@kernloop/kernel';
import {
  type GithubProviderHandle,
  type IssueState,
  type TrackerExec,
  type TrackerMode,
} from '@kernloop/tracker';
import type { CliIo } from './cli.js';
import type { Kernloop } from './kernel.js';
import { checkIdLength, ProgramInputError } from './program-shared.js';
import type { ProgramNodeRow } from './program-store.js';
import { buildGatedCloseProvider, closeOneIssue, type IssueCloseAction } from './tracker-close.js';

/** One node's close-outcome row (the printable per-node result). */
interface CloseNodeResult {
  readonly nodeId: string;
  readonly issueRef: string;
  readonly githubState?: IssueState;
  readonly action: IssueCloseAction;
  /** Typed failure detail on a failed read/close — never set on success. */
  readonly reason?: string;
}

/** The JSON the close verb prints. */
interface CloseReport {
  readonly op: 'close';
  readonly mode: TrackerMode;
  readonly refusedExecute: boolean;
  readonly tier: 'suggest' | 'enforce';
  readonly programId: string;
  readonly notice: string;
  readonly checked: number;
  readonly closed: number;
  readonly wouldClose: number;
  readonly alreadyClosed: number;
  readonly failed: number;
  readonly nodes: CloseNodeResult[];
}

/** Close one `done` node's issue via the shared gated primitive, tagged by node. */
async function classifyAndClose(
  provider: GithubProviderHandle,
  row: ProgramNodeRow,
  ref: string,
  mode: TrackerMode,
  closeReason: string,
): Promise<CloseNodeResult> {
  const out = await closeOneIssue(provider, ref, mode, closeReason);
  return {
    nodeId: row.nodeId,
    issueRef: ref,
    action: out.action,
    ...(out.githubState === undefined ? {} : { githubState: out.githubState }),
    ...(out.reason === undefined ? {} : { reason: out.reason }),
  };
}

/** The dry-run/execute notice (refused-execute spells out the enforce promotion). */
function closeNotice(mode: TrackerMode, refused: boolean): string {
  if (mode === 'execute') return 'EXECUTE — `done` nodes’ GitHub issues closed via the tracker';
  return refused
    ? 'DRY RUN — --execute refused: tracker tier is not enforce (set tracker.tier: enforce)'
    : 'DRY RUN — GitHub read only; no issues closed (pass --execute at enforce tier to act)';
}

/** Audit the close ONCE — counts only, never a goal/body. */
function auditClose(
  kern: Kernloop,
  args: { programId: string; mode: TrackerMode; refusedExecute: boolean; report: CloseReport },
): void {
  appendEvent(kern.store, {
    type: 'cli.program.close',
    payload: {
      op: 'close',
      programId: args.programId,
      mode: args.mode,
      refusedExecute: args.refusedExecute,
      tier: args.report.tier,
      checked: args.report.checked,
      closed: args.report.closed,
      wouldClose: args.report.wouldClose,
      alreadyClosed: args.report.alreadyClosed,
      failed: args.report.failed,
    },
  });
}

/** The `done` nodes carrying a filed issueRef, optionally narrowed to one node. */
function selectDoneNodes(
  kern: Kernloop,
  programId: string,
  node: string | undefined,
): ProgramNodeRow[] {
  const done = kern.programs
    .listNodes(programId)
    .filter((n) => n.state === 'done' && n.issueRef !== null && n.issueRef !== '');
  if (node === undefined) return done;
  checkIdLength(node);
  return done.filter((n) => n.nodeId === node);
}

/**
 * Run `kernloop program close --program <id> [--node NODE] [--reason completed|"not planned"] [--execute]`
 * (#50, CLM-0116): load the program (absent → clean exit 1), select its `done`
 * nodes that carry an `issueRef`, READ each issue (any tier), and CLOSE the open
 * ones — but only when `--execute` is given AND `tracker.tier: enforce`
 * (otherwise a dry-run that proposes the closes). Already-closed issues are a
 * no-op; a failed read or close leaves the issue untouched and makes the run
 * exit 1. Audited once with counts only.
 */
export async function closeOp(
  kern: Kernloop,
  io: CliIo,
  programId: string,
  opts: { node?: string; closeReason: string; executeFlag: boolean },
  exec: TrackerExec | undefined,
): Promise<number> {
  checkIdLength(programId);
  if (kern.programs.getProgram(programId) === undefined) {
    throw new ProgramInputError(`no program "${programId}" in the ledger`);
  }
  const targets = selectDoneNodes(kern, programId, opts.node);
  const { provider, mode, refusedExecute } = buildGatedCloseProvider(kern, opts.executeFlag, exec);
  const nodes: CloseNodeResult[] = [];
  for (const row of targets) {
    nodes.push(
      await classifyAndClose(provider, row, row.issueRef as string, mode, opts.closeReason),
    );
  }
  const count = (a: IssueCloseAction): number => nodes.filter((n) => n.action === a).length;
  const failed = count('read-failed') + count('close-failed');
  const report: CloseReport = {
    op: 'close',
    mode,
    refusedExecute,
    tier: kern.config.tracker?.tier ?? 'suggest',
    programId,
    notice: closeNotice(mode, refusedExecute),
    checked: nodes.length,
    closed: count('closed'),
    wouldClose: count('would-close'),
    alreadyClosed: count('already-closed'),
    failed,
    nodes,
  };
  auditClose(kern, { programId, mode, refusedExecute, report });
  io.out(JSON.stringify(report, null, 2));
  return failed > 0 ? 1 : 0;
}
