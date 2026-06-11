/**
 * The composition root's canonical-loop entry [CLM-0046]: bind the
 * @kernloop/workflows engine to the real executor set (loop/executors.ts),
 * a durable JSONL checkpoint store under `<overlay>/checkpoints/<runId>.jsonl`
 * (machine-local; `kernloop init` gitignores it), and the loaded overlay's
 * loop config (K, vote gate thresholds, node overrides — field-for-field,
 * the schemas match by design [CLM-0045]).
 *
 * Statuses are surfaced honestly: `completed` carries retrospect's Outcome;
 * `escalated` means the K vote-iterate bound was exhausted — the run HALTED
 * with its findings and `kernloop run --resume <runId>` continues from plan
 * after the human edits; `failed` carries the typed engine error and the
 * last checkpoint stays resumable.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  BriefSchema,
  TaskContractSchema,
  type Cost,
  type Finding,
  type Outcome,
  type TaskContract,
} from '@kernloop/contracts';
import { appendEvent, type AdapterName } from '@kernloop/kernel';
import type { QualityCheck } from '@kernloop/faculty-gates';
import {
  JsonlCheckpointStore,
  createEngine,
  type BudgetGuard,
  type BudgetMode,
  type ChildIterateEvent,
  type Engine,
  type RunResult,
  type RunState,
  type TraceEntry,
} from '@kernloop/workflows';
import type { Kernloop } from '../kernel.js';
import { buildLoopExecutors, type LoopRefs } from './executors.js';
import {
  LoopResumeError,
  adapterInvoke,
  ensureAdapterAvailable,
  meteredInvoke,
  type LoopInvoke,
} from './invoke.js';
import { nodeRequirement, type TieredNode } from './node-model.js';
import {
  adapterForTier,
  buildNodeSeam,
  resolveServed,
  type NodeSeam,
  type TierAdapters,
} from './node-seam.js';
import { requirementForNode, type Overlay } from '../overlay.js';

export { TIERED_NODES, type TieredNode } from './node-model.js';
export {
  resolveServed,
  servedRef,
  identityRef,
  servedIdentity,
  adapterForTier,
  type ServedModel,
  type NodeSeam,
} from './node-seam.js';

/**
 * Build the per-NODE model seam [CLM-0078]: for each model-calling node, derive
 * its {@link ModelRequirement} from its single source (template/manifest), apply
 * any overlay per-node tier/effort override, pick the adapter that serves its
 * tier (`overlay.adapters[tier]`, else the run adapter), resolve the served
 * model+effort through the kernel translation seam, and bind a metered invoke
 * carrying that provenance. With NO `adapters` block AND no overrides, every
 * node binds the run adapter at its declared tier alias — the backward-compat
 * guarantee (unchanged spend shape). Seams are cached per node.
 *
 * Enforcement point note (honesty): this lives at the LOOP composition root,
 * not the Router — see loop/node-model.ts.
 */
export function buildInvokeForNode(
  runAdapter: AdapterName,
  overlay: Overlay,
  totals: { tokens: number; usd: number },
): (node: TieredNode) => NodeSeam {
  const cache = new Map<TieredNode, NodeSeam>();
  const adapters: TierAdapters | undefined = overlay.adapters;
  return (node) => {
    let seam = cache.get(node);
    if (seam === undefined) {
      const req = requirementForNode(overlay, node, nodeRequirement(node));
      const adapter = adapterForTier(req.tier, adapters, runAdapter);
      const served = resolveServed(req, adapter);
      seam = buildNodeSeam(served, adapterInvoke(adapter), totals);
      cache.set(node, seam);
    }
    return seam;
  };
}

/**
 * Per-node seams for an INJECTED invoke (tests script the model CLI). Every
 * node routes through the one injected `base`, but the node's served model +
 * effort are still resolved against the run adapter — so provenance records
 * what each node requested even though one scripted seam answers them all.
 */
function injectedSeamFor(
  runAdapter: AdapterName,
  overlay: Overlay,
  base: LoopInvoke,
  totals: { tokens: number; usd: number },
): (node: TieredNode) => NodeSeam {
  const cache = new Map<TieredNode, NodeSeam>();
  return (node) => {
    let seam = cache.get(node);
    if (seam === undefined) {
      const req = requirementForNode(overlay, node, nodeRequirement(node));
      const adapter = adapterForTier(req.tier, overlay.adapters, runAdapter);
      seam = buildNodeSeam(resolveServed(req, adapter), base, totals);
      cache.set(node, seam);
    }
    return seam;
  };
}

export {
  LoopParseError,
  LoopResumeError,
  adapterInvoke,
  ensureAdapterAvailable,
  extractJsonObject,
  type LoopInvoke,
} from './invoke.js';
export { writeWorkspaceFiles } from './executors.js';

/** One canonical-loop run request. */
export interface LoopRequest {
  /** The parent TaskContract (ignored by the engine on resume — the
   * checkpointed task is the truth; the caller loads it for routing). */
  readonly task: TaskContract;
  /** Workspace the loop's children implement into. */
  readonly workspaceDir: string;
  /** Adapter the default invoke binds to; default `claude`. */
  readonly adapter?: AdapterName;
  /** Injectable model seam (tests script it); default: the kernel adapter. */
  readonly invoke?: LoopInvoke;
  /** Resume the checkpointed run with this id instead of starting fresh. */
  readonly resumeRunId?: string;
  /** Caller-chosen run id for a fresh run (defaults to a UUID). */
  readonly runId?: string;
  /** Quality-check override (tests); real defaults otherwise. */
  readonly checks?: readonly QualityCheck[];
  /**
   * Force unlimited budget mode for this run [CLM-0077], overriding the
   * overlay's `budgetMode`. The run never halts on budget; usage/cost is still
   * metered and reported, and the run is recorded honestly as unlimited.
   */
  readonly unlimited?: boolean;
}

/** The loop RunResult mapped for the run tool, plus the metered model spend. */
export interface LoopReport {
  readonly runId: string;
  readonly status: 'completed' | 'escalated' | 'failed';
  readonly nodeTrace: readonly TraceEntry[];
  /**
   * Total model spend metered through the invoke seams [CLM-0077]. ALWAYS
   * reported, identically in both budget modes — unlimited removes the
   * restriction, never the tracking.
   */
  readonly cost: Cost;
  /**
   * True when the run executed in unlimited budget mode (budget not enforced).
   * Recorded honestly so a report never implies a cap was honored [CLM-0077].
   */
  readonly unlimited: boolean;
  readonly outcome?: Outcome;
  readonly findings?: readonly Finding[];
  readonly error?: { code: string; message: string };
}

/** Where one run's checkpoints live (machine-local, gitignored by init). */
export function checkpointFile(overlayDir: string, runId: string): string {
  return path.join(overlayDir, 'checkpoints', `${runId}.jsonl`);
}

/** The checkpointed parent task of a run, or undefined when none exists. */
export async function loadCheckpointTask(
  kern: Kernloop,
  runId: string,
): Promise<TaskContract | undefined> {
  const store = new JsonlCheckpointStore(checkpointFile(kern.paths.dir, runId));
  const latest = await store.latest(runId);
  return latest?.state.task;
}

/** Prime the cross-node refs from a checkpoint so no node re-executes. */
function primeRefs(refs: LoopRefs, state: RunState): void {
  const framed = TaskContractSchema.safeParse(state.values['frame']);
  if (framed.success) refs.framedTask = framed.data;
  const research = BriefSchema.safeParse(state.values['research']);
  if (research.success) refs.researchBrief = research.data;
  const plan = BriefSchema.safeParse(state.values['plan']);
  if (plan.success) refs.planBrief = plan.data;
}

/** Map the engine's RunResult into the report the run tool returns. */
function report(
  result: RunResult,
  totals: { tokens: number; usd: number },
  unlimited: boolean,
): LoopReport {
  return {
    runId: result.runId,
    status: result.status,
    nodeTrace: result.nodeTrace,
    // Always-on reporting [CLM-0077]: metered spend rides in both modes.
    cost: { tokens: totals.tokens, usd: totals.usd },
    unlimited,
    ...(result.outcome === undefined ? {} : { outcome: result.outcome }),
    ...(result.findings === undefined ? {} : { findings: result.findings }),
    ...(result.error === undefined
      ? {}
      : { error: { code: result.error.code, message: result.error.message } }),
  };
}

/**
 * Probe every adapter a default-seam run can actually call — the run adapter
 * plus any tier adapter the overlay declares — so a misconfigured environment
 * fails fast up front, never mid-loop. Each absence is a typed error.
 */
function ensureRunAdaptersAvailable(
  runAdapter: AdapterName,
  tierAdapters: TierAdapters | undefined,
): void {
  ensureAdapterAvailable(runAdapter);
  for (const tier of ['frontier', 'large', 'medium', 'small'] as const) {
    const tierAdapter = tierAdapters?.[tier];
    if (tierAdapter !== undefined && tierAdapter !== runAdapter) {
      ensureAdapterAvailable(tierAdapter);
    }
  }
}

/**
 * The runtime budget guard for one canonical-loop run [CLM-0077]. The limit is
 * the parent TaskContract's token/usd budget; `spent()` reads the live metered
 * `totals` (always-on tracking). In `enforce` mode the engine halts the run on
 * overspend; `unlimited` never halts but the spend is still metered. The
 * wall-clock dimension is the run's own concern, not metered here.
 */
function budgetGuardFor(
  mode: BudgetMode,
  task: { budget: { tokens: number; usd: number } },
  totals: { tokens: number; usd: number },
): BudgetGuard {
  return {
    mode,
    limit: { tokens: task.budget.tokens, usd: task.budget.usd },
    spent: () => ({ tokens: totals.tokens, usd: totals.usd }),
  };
}

/**
 * Wire the per-child-iteration audit hook [CLM-0043]: each re-entry appends a
 * `loop.child.iterate` event to the hash chain, so the refine history is
 * recorded and the Observer can later read iterations-to-pass as a fitness
 * signal. Workflows imports no kernel — this seam does the append.
 */
function childIterateAudit(kern: Kernloop, runId: string): (e: ChildIterateEvent) => void {
  return (e) =>
    appendEvent(kern.store, {
      type: 'loop.child.iterate',
      payload: {
        runId,
        childId: e.childId,
        iteration: e.iteration,
        gate: e.gate,
        findingCount: e.findingCount,
      },
    });
}

/**
 * Build the engine over the real executors + the run's budget/iterate seams.
 * `mode` is the effective budget mode; `totals` is the metered-spend accumulator
 * the budget guard reads (always-on tracking). Kc and budgetMode flow from the
 * overlay; the per-iteration audit hook wires re-entries to the chain [CLM-0043].
 */
function buildLoopEngine(
  kern: Kernloop,
  request: LoopRequest,
  seams: {
    runId: string;
    checkpoints: JsonlCheckpointStore;
    refs: LoopRefs;
    adapter: AdapterName;
    defaultInvoke: LoopInvoke;
    invokeFor: (node: TieredNode) => NodeSeam;
    mode: BudgetMode;
    totals: { tokens: number; usd: number };
  },
): Engine {
  return createEngine({
    executors: buildLoopExecutors({
      kern,
      workspaceDir: request.workspaceDir,
      invoke: seams.defaultInvoke,
      invokeFor: seams.invokeFor,
      adapter: seams.adapter,
      refs: seams.refs,
      ...(request.checks === undefined ? {} : { checks: request.checks }),
    }),
    checkpoints: seams.checkpoints,
    config: {
      K: kern.config.K,
      Kc: kern.config.Kc,
      gates: { vote: kern.config.gates.vote },
      nodeOverrides: kern.config.nodeOverrides,
    },
    budget: budgetGuardFor(seams.mode, request.task, seams.totals),
    onChildIterate: childIterateAudit(kern, seams.runId),
  });
}

/**
 * Resolve the run's effective budget mode [CLM-0077]: a run-level --unlimited
 * forces unlimited, else the overlay's budgetMode (default enforce). An
 * unlimited run is recorded honestly with a `loop.unlimited` audit event so no
 * report later implies a cap was honored when it wasn't.
 */
function resolveBudgetMode(kern: Kernloop, request: LoopRequest, runId: string): BudgetMode {
  const mode: BudgetMode = request.unlimited === true ? 'unlimited' : kern.config.budgetMode;
  if (mode === 'unlimited') {
    appendEvent(kern.store, {
      type: 'loop.unlimited',
      payload: {
        runId,
        taskId: request.task.id,
        reason: 'budget enforcement disabled for this run',
      },
    });
  }
  return mode;
}

/**
 * Run (or resume) the canonical loop over one assembled kernloop. The
 * default invoke requires the chosen adapter's CLI on PATH — probed up
 * front; unavailable is a typed error, never a stub.
 */
export async function executeCanonicalLoop(
  kern: Kernloop,
  request: LoopRequest,
): Promise<LoopReport> {
  const adapter = request.adapter ?? 'claude';
  const tierAdapters = kern.config.adapters;
  if (request.invoke === undefined) ensureRunAdaptersAvailable(adapter, tierAdapters);
  const base = request.invoke ?? adapterInvoke(adapter);
  const runId = request.resumeRunId ?? request.runId ?? randomUUID();
  const checkpoints = new JsonlCheckpointStore(checkpointFile(kern.paths.dir, runId));
  const refs: LoopRefs = {};
  if (request.resumeRunId !== undefined) {
    const latest = await checkpoints.latest(runId);
    if (latest === undefined) {
      throw new LoopResumeError(runId, checkpointFile(kern.paths.dir, runId));
    }
    primeRefs(refs, latest.state);
  }
  const totals = { tokens: 0, usd: 0 };
  // Default + per-node seams, all metered. With a real run, each node derives
  // its requirement and binds the adapter+model that serves it [CLM-0078]. An
  // injected invoke routes every node through that one base, but still resolves
  // the node's SERVED model+effort against the run adapter so provenance stays
  // honest about what each node requested.
  const defaultInvoke = meteredInvoke(base, totals);
  const invokeFor: (node: TieredNode) => NodeSeam =
    request.invoke === undefined
      ? buildInvokeForNode(adapter, kern.config, totals)
      : injectedSeamFor(adapter, kern.config, base, totals);
  // Effective budget mode [CLM-0077]: --unlimited forces unlimited; else the
  // overlay's budgetMode (default enforce). An unlimited run is recorded honestly.
  const mode = resolveBudgetMode(kern, request, runId);
  const engine = buildLoopEngine(kern, request, {
    runId,
    checkpoints,
    refs,
    adapter,
    defaultInvoke,
    invokeFor,
    mode,
    totals,
  });
  const result =
    request.resumeRunId === undefined
      ? await engine.run(request.task, { runId })
      : await engine.resume(runId);
  return report(result, totals, mode === 'unlimited');
}
