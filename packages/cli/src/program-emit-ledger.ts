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
 * built; every emit is audited ONCE with counts/ids — never a goal/body verbatim.
 *
 * SUB-ISSUE TREE (#84): the ledger stores a program as a tree (each node's
 * `parentId`, null for the root umbrella). This path files PARENTS-FIRST and
 * body-ref-links — a filed parent's issue number is injected as a `Parent: #N`
 * line into each child's body, and once a parent's children are filed its body
 * is REPLACED (via the `editBody` tracker op — the allowlisted `gh issue edit`
 * subcommand, no GraphQL) with a `- [ ] #child` task-list GitHub renders as
 * tracked sub-issues. Linking runs only on a real `execute`; dry-run reports the
 * would-be tree edges and spawns nothing.
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
import {
  epicBodyWithTaskList,
  issueNumberFromRef,
  orderParentsFirst,
  withParentRef,
} from './program-emit-tree.js';

/** One filed node's outcome row (the printable per-node result/proposal). */
interface LedgerNodeResult {
  readonly nodeId: string;
  readonly state: 'planned' | 'emitted';
  /** The `#N` of the parent this child was body-ref-linked to (execute only). */
  readonly parentRef?: string;
  readonly proposal?: unknown;
  readonly result?: { ok: boolean; ref?: string; reason?: string };
}

/** One parent epic's sub-issue task-list body edit outcome (execute only). */
interface EpicUpdate {
  readonly nodeId: string;
  readonly childCount: number;
  readonly ok: boolean;
  readonly reason?: string;
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
  /** The parent→child sub-issue edges this emit would create / created. */
  readonly links: Array<{ parentNodeId: string; childNodeId: string }>;
  /** Per-parent epic-body task-list edits (execute only; empty in dry-run). */
  readonly epicUpdates: EpicUpdate[];
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
 * node stays `planned`. When `parentNumber` is set (the node's parent was filed
 * first this run), a `Parent: #N` back-link is injected into the body before
 * filing. Returns the printable per-node row. */
async function emitOneNode(
  kern: Kernloop,
  programId: string,
  row: ProgramNodeRow,
  provider: GithubProviderHandle,
  parentNumber: string | undefined,
): Promise<LedgerNodeResult> {
  const base = bodyForRow(row);
  const body = parentNumber !== undefined ? withParentRef(base, parentNumber) : base;
  const parentRef = parentNumber !== undefined ? `#${parentNumber}` : undefined;
  const result = await provider.createIssue({
    title: row.goal,
    body,
    ...(row.labels.length > 0 ? { labels: row.labels } : {}),
  });
  if (!result.ok) {
    return {
      nodeId: row.nodeId,
      state: 'planned',
      ...(parentRef !== undefined ? { parentRef } : {}),
      result: { ok: false, reason: result.reason },
    };
  }
  if (provider.mode === 'dry-run') {
    return { nodeId: row.nodeId, state: 'planned', proposal: provider.proposals.at(-1) };
  }
  return recordFiled(kern, programId, row, result.ref, parentRef);
}

/** A real execute create SUCCEEDED — the issue is ALREADY filed; auto-record its
 * ref into the ledger (planned → emitted). If the ref gh returned is
 * unrecordable (a non-https URL, or no URL at all), advanceNode throws — but the
 * issue exists, so DON'T abort: surface the filed-but-unrecorded node WITH its
 * ref and exit 1, so the operator verifies it on GitHub and advances it manually
 * instead of a blind retry silently double-filing it (#98). */
function recordFiled(
  kern: Kernloop,
  programId: string,
  row: ProgramNodeRow,
  ref: string,
  parentRef: string | undefined,
): LedgerNodeResult {
  try {
    kern.programs.advanceNode({ programId, nodeId: row.nodeId, state: 'emitted', issueRef: ref });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      nodeId: row.nodeId,
      state: 'planned',
      result: {
        ok: false,
        ref,
        reason: `filed but NOT recorded (${reason}) — verify the issue on GitHub and 'program advance' it before re-emitting (a retry will re-file)`,
      },
    };
  }
  return {
    nodeId: row.nodeId,
    state: 'emitted',
    ...(parentRef !== undefined ? { parentRef } : {}),
    result: { ok: true, ref },
  };
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
    epicUpdatedCount: number;
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
      epicUpdatedCount: args.epicUpdatedCount,
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

/** One node filed THIS run: its issue number + the stored row (for the body). */
type FiledNode = { number: string; row: ProgramNodeRow };

/** Seed parent issue numbers from nodes already emitted in a PRIOR run, so a
 * newly-emitted child can still body-ref-link to an ancestor filed earlier. */
function seedFiledNumbers(all: readonly ProgramNodeRow[]): Map<string, string> {
  const filed = new Map<string, string>();
  for (const node of all) {
    if (node.state === 'planned') continue;
    const num = issueNumberFromRef(node.issueRef);
    if (num !== null) filed.set(node.nodeId, num);
  }
  return filed;
}

/** Emit the planned nodes PARENTS-FIRST [CLM-0106], injecting each child's
 * filed-parent `#N` back-link. Returns the per-node rows + the numbers filed
 * this run. */
async function emitInOrder(
  kern: Kernloop,
  programId: string,
  planned: readonly ProgramNodeRow[],
  all: readonly ProgramNodeRow[],
  provider: GithubProviderHandle,
): Promise<{ nodes: LedgerNodeResult[]; filedThisRun: Map<string, FiledNode> }> {
  const filed = seedFiledNumbers(all);
  const filedThisRun = new Map<string, FiledNode>();
  const nodes: LedgerNodeResult[] = [];
  for (const row of orderParentsFirst(planned)) {
    const parentNumber = row.parentId !== null ? filed.get(row.parentId) : undefined;
    const res = await emitOneNode(kern, programId, row, provider, parentNumber);
    nodes.push(res);
    const num = res.state === 'emitted' ? issueNumberFromRef(res.result?.ref) : null;
    if (num !== null) {
      filed.set(row.nodeId, num);
      filedThisRun.set(row.nodeId, { number: num, row });
    }
  }
  return { nodes, filedThisRun };
}

/** REPLACE each parent's body (filed this run) with one carrying a `- [ ] #child`
 * sub-issue task-list. Parents with no filed children are skipped. */
async function updateEpicBodies(
  provider: GithubProviderHandle,
  filedThisRun: ReadonlyMap<string, FiledNode>,
): Promise<EpicUpdate[]> {
  const out: EpicUpdate[] = [];
  for (const [parentId, parent] of filedThisRun) {
    const childNumbers = [...filedThisRun.values()]
      .filter((c) => c.row.parentId === parentId)
      .map((c) => c.number);
    const newBody = epicBodyWithTaskList(bodyForRow(parent.row), childNumbers);
    if (newBody === null) continue;
    const result = await provider.editBody(`#${parent.number}`, newBody);
    out.push({
      nodeId: parentId,
      childCount: childNumbers.length,
      ok: result.ok,
      ...(result.ok ? {} : { reason: result.reason }),
    });
  }
  return out;
}

/** The parent→child sub-issue edges this emit links (every planned child with a
 * parent — the would-be links in dry-run, the created links in execute). */
function treeLinks(
  planned: readonly ProgramNodeRow[],
): Array<{ parentNodeId: string; childNodeId: string }> {
  const links: Array<{ parentNodeId: string; childNodeId: string }> = [];
  for (const node of planned) {
    if (node.parentId !== null)
      links.push({ parentNodeId: node.parentId, childNodeId: node.nodeId });
  }
  return links;
}

/** File every planned node parents-first, link the tree, audit once, print the
 * report; the gated half after the spam guard has passed. Returns the exit code
 * (1 on any createIssue OR epic-body-edit failure). */
async function fileLedgerNodes(
  kern: Kernloop,
  io: CliIo,
  programId: string,
  planned: readonly ProgramNodeRow[],
  all: readonly ProgramNodeRow[],
  skipped: readonly SkippedNode[],
  gated: { provider: GithubProviderHandle; mode: TrackerMode; refusedExecute: boolean },
): Promise<number> {
  const { provider, mode, refusedExecute } = gated;
  const { nodes, filedThisRun } = await emitInOrder(kern, programId, planned, all, provider);
  const epicUpdates = mode === 'execute' ? await updateEpicBodies(provider, filedThisRun) : [];
  const emittedCount = nodes.filter((n) => n.state === 'emitted').length;
  auditLedgerEmit(kern, {
    programId,
    mode,
    refusedExecute,
    plannedCount: planned.length,
    emittedCount,
    skippedCount: skipped.length,
    epicUpdatedCount: epicUpdates.filter((e) => e.ok).length,
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
    links: treeLinks(planned),
    epicUpdates,
  };
  io.out(JSON.stringify(report, null, 2));
  const failed = nodes.some((n) => n.result?.ok === false) || epicUpdates.some((e) => !e.ok);
  return failed ? 1 : 0;
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
  return fileLedgerNodes(kern, io, programId, planned, all, skipped, gated);
}
