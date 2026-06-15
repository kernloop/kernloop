/**
 * `kernloop program emit` — the gated actor that turns a decomposed program
 * tree into labeled GitHub issues (spec §5.4; CLM-0098). It re-decomposes the
 * same parent/spec the preview verb does, then FILES each CHILD node as a
 * labeled GitHub issue through the EXISTING hardened @kernloop/tracker — there
 * is no new `gh` seam here. It is DRY-RUN BY DEFAULT: a real mutation happens
 * ONLY when the overlay grants `tracker.tier: enforce` AND `--execute` is
 * passed; at `suggest` an `--execute` is refused and the op stays dry-run (the
 * system never defaults upward, spec §3.2).
 *
 * A #52 vote condition — the ISSUE-SPAM GUARD (program-emit-shared.ts) — runs
 * BEFORE any provider is built or anything is proposed: emitting more than the
 * spam limit needs an explicit `--confirm-count N` matching the exact count, so
 * a human must acknowledge the number. Every emit is audited ONCE as
 * `cli.program.emit` with counts/refs only — never the node goal/body verbatim.
 * The ledger-driven `--program` mode lives in program-emit-ledger.ts.
 */
import { appendEvent } from '@kernloop/kernel';
import type { TaskContract } from '@kernloop/contracts';
import { decomposeGoal, programIssueBody, programLabels } from '@kernloop/faculty-scrum';
import {
  githubProvider,
  type GithubProviderHandle,
  type TrackerExec,
  type TrackerMode,
  type TrackerResult,
} from '@kernloop/tracker';
import type { CliIo } from './cli.js';
import type { Kernloop } from './kernel.js';
import {
  buildProgramParent,
  checkIdLength,
  isCleanError,
  ProgramInputError,
  readSpecFile,
} from './program-shared.js';
import { emitLedgerOp } from './program-emit-ledger.js';
import { checkSpamGuard, emitTrackerConfig, PREVIEW_NOTICE } from './program-emit-shared.js';
import { resolveMode } from './tracker-commands.js';

const EMIT_USAGE =
  'usage: kernloop program emit (--goal G --spec F [--parent ID] [--id ID] | --program ID) [--execute] [--confirm-count N]';

/** One node's filing outcome (the printable per-node row). */
interface NodeResult {
  readonly id: string;
  readonly labels: string[];
  readonly proposal?: unknown;
  readonly result?: { ok: boolean; ref?: string; reason?: string };
}

/** The JSON `emit` prints + the exit code it implies. */
interface EmitReport {
  readonly op: 'emit';
  readonly mode: TrackerMode;
  readonly refusedExecute: boolean;
  readonly parentId: string;
  readonly nodeCount: number;
  readonly notice: string;
  readonly nodes: NodeResult[];
}

/** Map a provider create-result to the printable per-node row (dry-run proposal
 * vs execute ref/reason). The provider's last proposal is the would-be `gh`. */
function nodeResultFor(
  node: TaskContract,
  labels: string[],
  provider: GithubProviderHandle,
  result: TrackerResult,
): NodeResult {
  if (!result.ok) {
    return { id: node.id, labels, result: { ok: false, reason: result.reason } };
  }
  if (provider.mode === 'dry-run') {
    return { id: node.id, labels, proposal: provider.proposals.at(-1) };
  }
  return { id: node.id, labels, result: { ok: true, ref: result.ref } };
}

/** File every child node through the provider; collect the per-node outcomes. */
async function emitNodes(
  provider: GithubProviderHandle,
  children: readonly TaskContract[],
): Promise<NodeResult[]> {
  const rows: NodeResult[] = [];
  for (const node of children) {
    const labels = programLabels(node.constraints);
    const result = await provider.createIssue({
      title: node.goal,
      body: programIssueBody(node),
      ...(labels.length > 0 ? { labels } : {}),
    });
    rows.push(nodeResultFor(node, labels, provider, result));
  }
  return rows;
}

/** The dry-run notice (refused-execute spells out the enforce-tier promotion). */
function emitNotice(mode: TrackerMode, refused: boolean): string {
  if (mode === 'execute') return 'EXECUTE — issues filed via the tracker';
  return refused
    ? 'DRY RUN — --execute refused: tracker tier is not enforce (set tracker.tier: enforce)'
    : 'DRY RUN — no issues filed';
}

/** Audit one emit op ONCE — counts/refs only, never a node goal/body verbatim. */
function auditEmit(
  kern: Kernloop,
  args: {
    parentId: string;
    mode: TrackerMode;
    refusedExecute: boolean;
    nodes: NodeResult[];
  },
): void {
  const okCount = args.nodes.filter((n) => n.result?.ok !== false).length;
  appendEvent(kern.store, {
    type: 'cli.program.emit',
    payload: {
      op: 'emit',
      path: 'adhoc', // discriminates this from the ledger-driven emit's audit shape
      parentId: args.parentId,
      mode: args.mode,
      refusedExecute: args.refusedExecute,
      tier: kern.config.tracker?.tier ?? 'suggest',
      nodeCount: args.nodes.length,
      okCount,
      labelCounts: args.nodes.map((n) => n.labels.length),
    },
  });
}

/** Build the gated provider, file every child, audit once, and print the report
 * — the GATED half of emit, after the spam guard has already passed. Returns the
 * exit code (1 only on an execute-mode createIssue failure). */
async function runEmit(
  kern: Kernloop,
  io: CliIo,
  parentId: string,
  children: readonly TaskContract[],
  executeFlag: boolean,
  exec: TrackerExec | undefined,
): Promise<number> {
  const { repo, tier, previewOnly } = emitTrackerConfig(kern.config.tracker, executeFlag);
  const { mode, refusedExecute } = resolveMode(tier, executeFlag);
  const provider =
    exec === undefined ? githubProvider({ repo }, mode) : githubProvider({ repo }, mode, exec);
  const nodes = await emitNodes(provider, children);
  auditEmit(kern, { parentId, mode, refusedExecute, nodes });
  const report: EmitReport = {
    op: 'emit',
    mode,
    refusedExecute,
    parentId,
    nodeCount: nodes.length,
    notice: previewOnly ? PREVIEW_NOTICE : emitNotice(mode, refusedExecute),
    nodes,
  };
  io.out(JSON.stringify(report, null, 2));
  // A failed createIssue is errors-as-data → clean nonzero exit, never a throw.
  return nodes.some((n) => n.result?.ok === false) ? 1 : 0;
}

/**
 * Run `program emit` [CLM-0098]: re-decompose the tree, enforce the spam guard,
 * resolve the mode from `tracker.tier` + `--execute`, file each child through
 * the hardened tracker (dry-run proposes only), audit once, print the report,
 * and exit 1 if any EXECUTE-mode createIssue failed. Typed faculty/input errors
 * (bad spec, budget breach, spam-guard refusal, missing tracker) surface as a
 * clean nonzero exit, never a throw. It mutates nothing in dry-run.
 */
export async function emitOp(
  kern: Kernloop,
  io: CliIo,
  v: Record<string, string | boolean>,
  str: (x: string | boolean | undefined) => string | undefined,
  exec: TrackerExec | undefined,
): Promise<number> {
  const program = str(v.program);
  const goal = str(v.goal);
  const specFile = str(v.spec);
  const execute = v.execute === true;
  const confirmCount = str(v['confirm-count']);
  try {
    // Mode selection: --program runs the LEDGER-DRIVEN path; --goal/--spec the
    // ad-hoc path. The two are mutually exclusive (a clean exit 1, never both).
    if (program !== undefined) {
      if (goal !== undefined || specFile !== undefined) {
        throw new ProgramInputError(
          '--program is mutually exclusive with --goal/--spec (ledger-driven vs ad-hoc emit)',
        );
      }
      return await emitLedgerOp(kern, io, program, execute, confirmCount, exec);
    }
    if (goal === undefined || specFile === undefined) throw new Error(EMIT_USAGE);
    const id = str(v.id) ?? str(v.parent) ?? 'program-root';
    checkIdLength(id);
    const specs = readSpecFile(io, specFile);
    const parent = buildProgramParent(kern, id, goal);
    const children = decomposeGoal({ parent, subtasks: specs });
    // The spam guard runs BEFORE any provider/proposal is built.
    checkSpamGuard(children.length, confirmCount);
    return await runEmit(kern, io, id, children, execute, exec);
  } catch (error) {
    if (isCleanError(error)) {
      io.err(JSON.stringify({ error: error.name, message: error.message }, null, 2));
      return 1;
    }
    throw error;
  }
}
