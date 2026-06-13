/**
 * The LEDGER-DRIVEN half of `kernloop program emit` (spec §5.4; CLM-0098,
 * Increment 3b / #88). Where the ad-hoc `--goal --spec` path re-decomposes and
 * files without touching the ledger, this path files a PERSISTED program's
 * `planned` nodes from the STORED rows (the single source — it never
 * re-decomposes) through the SAME hardened @kernloop/tracker, and AUTO-RECORDS
 * each filed issue ref back into the ledger (planned → emitted) on a real
 * execute success. It is idempotent: nodes already `emitted`/`done` are skipped
 * (re-emit files nothing), and zero planned nodes is a clean exit 0. Dry-run
 * proposes only and records NOTHING; the spam guard runs BEFORE any provider is
 * built; every emit is audited ONCE with counts/ids — never a goal/body
 * verbatim. There is no new `gh` seam — the tracker plumbing is reused.
 *
 * SNAPSHOT semantics: labels come from the node's STORED `row.labels` (frozen by
 * `program create` at decompose time), NOT re-mapped fresh — the ledger is the
 * single source of truth, so a program created before a label-map change emits
 * the labels it was planned with, by design.
 */
import { appendEvent } from '@kernloop/kernel';
import { TaskContractSchema } from '@kernloop/contracts';
import { programIssueBody } from '@kernloop/faculty-scrum';
import {
  githubProvider,
  type GithubProviderHandle,
  type TrackerExec,
  type TrackerMode,
} from '@kernloop/tracker';
import type { CliIo } from './cli.js';
import type { Kernloop } from './kernel.js';
import { checkIdLength, ProgramInputError } from './program-shared.js';
import { checkSpamGuard } from './program-emit-shared.js';
import type { ProgramNodeRow } from './program-store.js';
import { resolveMode } from './tracker-commands.js';

/** One filed node's outcome row (the printable per-node result/proposal). */
interface LedgerNodeResult {
  readonly nodeId: string;
  readonly state: 'planned' | 'emitted';
  readonly proposal?: unknown;
  readonly result?: { ok: boolean; ref?: string; reason?: string };
}

/** The JSON the ledger-driven emit prints. */
interface LedgerEmitReport {
  readonly op: 'emit';
  readonly mode: TrackerMode;
  readonly refusedExecute: boolean;
  readonly programId: string;
  readonly notice: string;
  readonly plannedCount: number;
  readonly emittedCount: number;
  readonly skippedCount: number;
  readonly nodes: LedgerNodeResult[];
  readonly skipped: Array<{ nodeId: string; state: string }>;
}

/** Build the `programIssueBody` for one STORED node row, validating its
 * `taskJson` back through `TaskContractSchema` first — a malformed row is a
 * clean {@link ProgramInputError}, never a raw zod/JSON throw. */
function bodyForRow(row: ProgramNodeRow): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.taskJson);
  } catch {
    throw new ProgramInputError(
      `node "${row.nodeId}" has a malformed stored task (not valid JSON)`,
    );
  }
  const result = TaskContractSchema.safeParse(parsed);
  if (!result.success) {
    throw new ProgramInputError(
      `node "${row.nodeId}" has a stored task that is not a valid TaskContract`,
    );
  }
  return programIssueBody(result.data);
}

/** File one planned node through the provider and, on a real execute success,
 * auto-record the filed ref into the ledger (planned → emitted). A failed/dry
 * node stays `planned`. Returns the printable per-node row. */
async function emitOneNode(
  kern: Kernloop,
  programId: string,
  row: ProgramNodeRow,
  provider: GithubProviderHandle,
): Promise<LedgerNodeResult> {
  const body = bodyForRow(row);
  const result = await provider.createIssue({
    title: row.goal,
    body,
    ...(row.labels.length > 0 ? { labels: row.labels } : {}),
  });
  if (!result.ok) {
    return { nodeId: row.nodeId, state: 'planned', result: { ok: false, reason: result.reason } };
  }
  if (provider.mode === 'dry-run') {
    return { nodeId: row.nodeId, state: 'planned', proposal: provider.proposals.at(-1) };
  }
  // Real execute success — auto-record the filed ref into the ledger.
  kern.programs.advanceNode({
    programId,
    nodeId: row.nodeId,
    state: 'emitted',
    issueRef: result.ref,
  });
  return { nodeId: row.nodeId, state: 'emitted', result: { ok: true, ref: result.ref } };
}

/** The dry-run/execute notice (refused-execute spells out the enforce promotion). */
function ledgerNotice(mode: TrackerMode, refused: boolean): string {
  if (mode === 'execute')
    return 'EXECUTE — issues filed via the tracker, refs recorded in the ledger';
  return refused
    ? 'DRY RUN — --execute refused: tracker tier is not enforce (set tracker.tier: enforce)'
    : 'DRY RUN — no issues filed, ledger unchanged';
}

/** Audit the ledger-driven emit ONCE — counts/ids only, never a goal/body. */
function auditLedgerEmit(
  kern: Kernloop,
  args: {
    programId: string;
    mode: TrackerMode;
    refusedExecute: boolean;
    plannedCount: number;
    emittedCount: number;
    skippedCount: number;
  },
): void {
  appendEvent(kern.store, {
    type: 'cli.program.emit',
    payload: {
      op: 'emit',
      path: 'ledger', // discriminates this from the ad-hoc emit's audit shape
      mode: args.mode,
      refusedExecute: args.refusedExecute,
      tier: kern.config.tracker?.tier ?? 'suggest',
      programId: args.programId,
      plannedCount: args.plannedCount,
      emittedCount: args.emittedCount,
      skippedCount: args.skippedCount,
    },
  });
}

/** A node to skip (already emitted/done), in the printable shape. */
type SkippedNode = { nodeId: string; state: string };

/** Build the gated provider for one program emit (reusing the tracker plumbing). */
function buildProvider(
  kern: Kernloop,
  executeFlag: boolean,
  exec: TrackerExec | undefined,
): { provider: GithubProviderHandle; mode: TrackerMode; refusedExecute: boolean } {
  const cfg = kern.config.tracker;
  if (cfg === undefined) {
    throw new ProgramInputError(
      'no tracker configured — add tracker: { provider: github, repo: owner/name } to overlay.yaml',
    );
  }
  const { mode, refusedExecute } = resolveMode(cfg.tier, executeFlag);
  const provider =
    exec === undefined
      ? githubProvider({ repo: cfg.repo }, mode)
      : githubProvider({ repo: cfg.repo }, mode, exec);
  return { provider, mode, refusedExecute };
}

/** File every planned node, audit once, print the report; the gated half after
 * the spam guard has passed. Returns the exit code (1 only on execute failure). */
async function fileLedgerNodes(
  kern: Kernloop,
  io: CliIo,
  programId: string,
  planned: readonly ProgramNodeRow[],
  skipped: readonly SkippedNode[],
  gated: { provider: GithubProviderHandle; mode: TrackerMode; refusedExecute: boolean },
): Promise<number> {
  const nodes: LedgerNodeResult[] = [];
  for (const row of planned) {
    nodes.push(await emitOneNode(kern, programId, row, gated.provider));
  }
  const emittedCount = nodes.filter((n) => n.state === 'emitted').length;
  const { mode, refusedExecute } = gated;
  auditLedgerEmit(kern, {
    programId,
    mode,
    refusedExecute,
    plannedCount: planned.length,
    emittedCount,
    skippedCount: skipped.length,
  });
  const report: LedgerEmitReport = {
    op: 'emit',
    mode,
    refusedExecute,
    programId,
    notice: ledgerNotice(mode, refusedExecute),
    plannedCount: planned.length,
    emittedCount,
    skippedCount: skipped.length,
    nodes,
    skipped: [...skipped],
  };
  io.out(JSON.stringify(report, null, 2));
  return nodes.some((n) => n.result?.ok === false) ? 1 : 0;
}

/**
 * Run the LEDGER-DRIVEN `program emit --program <id>` [CLM-0098]: load the
 * persisted program (absent → clean exit 1), select its `planned` nodes
 * (skipping `emitted`/`done` for idempotency), enforce the spam guard, build the
 * gated provider, file each planned node from its STORED row, auto-record each
 * filed ref into the ledger on a real execute success, audit once, print the
 * report, and exit 1 only on an execute-mode createIssue failure. Mutates
 * nothing in dry-run; never re-decomposes.
 */
export async function emitLedgerOp(
  kern: Kernloop,
  io: CliIo,
  programId: string,
  executeFlag: boolean,
  confirmCount: string | undefined,
  exec: TrackerExec | undefined,
): Promise<number> {
  checkIdLength(programId);
  if (kern.programs.getProgram(programId) === undefined) {
    throw new ProgramInputError(`no program "${programId}" in the ledger`);
  }
  const all = kern.programs.listNodes(programId);
  const planned = all.filter((n) => n.state === 'planned');
  const skipped: SkippedNode[] = all
    .filter((n) => n.state !== 'planned')
    .map((n) => ({ nodeId: n.nodeId, state: n.state }));
  if (planned.length === 0) {
    const notice = 'nothing to emit (all nodes already emitted/done)';
    io.out(JSON.stringify({ op: 'emit', programId, notice, nodes: [], skipped }, null, 2));
    return 0;
  }
  // The spam guard runs BEFORE any provider/proposal is built.
  checkSpamGuard(planned.length, confirmCount);
  const gated = buildProvider(kern, executeFlag, exec);
  return fileLedgerNodes(kern, io, programId, planned, skipped, gated);
}
