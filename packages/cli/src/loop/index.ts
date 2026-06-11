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
import {
  adapterForTier,
  type AdapterName,
  type TierAdapters as KernelTierAdapters,
} from '@kernloop/kernel';
import type { QualityCheck } from '@kernloop/faculty-gates';
import {
  JsonlCheckpointStore,
  createEngine,
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
import {
  nodeModelTier,
  defaultTierSources,
  type TieredNode,
  type TierSources,
} from './node-tiers.js';
import type { TierAdapters } from '../overlay.js';

export {
  TIERED_NODES,
  nodeModelTier,
  defaultTierSources,
  type TieredNode,
  type TierSources,
} from './node-tiers.js';

/**
 * Resolve which adapter NAME a node binds [CLM-0068, CLM-0076] — the SINGLE
 * source of truth path. The node's model tier is DERIVED from the
 * manifest/template it routes to (via {@link nodeModelTier}); the kernel's pure
 * {@link adapterForTier} resolver then maps that declared tier to the overlay's
 * configured adapter, or the run adapter when the overlay declares none. With
 * no `adapters` block every node resolves to `runAdapter` (the backward-compat
 * guarantee). Flip a source's `modelTier` and this returns a different adapter
 * for that node — there is no parallel tier map to diverge.
 */
export function nodeAdapter(
  runAdapter: AdapterName,
  adapters: TierAdapters | undefined,
  node: TieredNode,
  sources: TierSources = defaultTierSources(),
): AdapterName {
  return adapterForTier(nodeModelTier(node, sources), kernelTierAdapters(adapters), runAdapter);
}

/** Drop unset tiers so the overlay's optional-keyed config matches the kernel
 * resolver's `Partial<Record<ModelTier, AdapterName>>` (exactOptional). */
function kernelTierAdapters(adapters: TierAdapters | undefined): KernelTierAdapters {
  const out: KernelTierAdapters = {};
  if (adapters?.cheap !== undefined) out.cheap = adapters.cheap;
  if (adapters?.frontier !== undefined) out.frontier = adapters.frontier;
  return out;
}

/**
 * Build the per-node model seam [CLM-0068, CLM-0076]. Each node's adapter is
 * resolved from the manifest/template it routes to (its declared tier) through
 * the kernel resolver — so an overlay with no `adapters` block makes every node
 * resolve to the run adapter (byte-identical to today, the backward-compat
 * guarantee). Every returned invoke is metered through `totals`, exactly as the
 * single-seam path is.
 *
 * Enforcement point note (honesty): this lives at the LOOP composition root,
 * not the Router — see loop/node-tiers.ts.
 */
export function buildInvokeForNode(
  runAdapter: AdapterName,
  adapters: TierAdapters | undefined,
  totals: { tokens: number; usd: number },
  sources: TierSources = defaultTierSources(),
): (node: TieredNode) => LoopInvoke {
  const cache = new Map<AdapterName, LoopInvoke>();
  return (node) => {
    const adapter = nodeAdapter(runAdapter, adapters, node, sources);
    let invoke = cache.get(adapter);
    if (invoke === undefined) {
      invoke = meteredInvoke(adapterInvoke(adapter), totals);
      cache.set(adapter, invoke);
    }
    return invoke;
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
}

/** The loop RunResult mapped for the run tool, plus the metered model spend. */
export interface LoopReport {
  readonly runId: string;
  readonly status: 'completed' | 'escalated' | 'failed';
  readonly nodeTrace: readonly TraceEntry[];
  /** Total model spend metered through the one invoke seam. */
  readonly cost: Cost;
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
function report(result: RunResult, totals: { tokens: number; usd: number }): LoopReport {
  return {
    runId: result.runId,
    status: result.status,
    nodeTrace: result.nodeTrace,
    cost: { tokens: totals.tokens, usd: totals.usd },
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
  for (const tier of ['cheap', 'frontier'] as const) {
    const tierAdapter = tierAdapters?.[tier];
    if (tierAdapter !== undefined && tierAdapter !== runAdapter) {
      ensureAdapterAvailable(tierAdapter);
    }
  }
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
  // Default + per-node seams, both metered. An injected invoke makes every
  // node resolve to it (tests unaffected); else each node's adapter is derived
  // from the manifest/template it routes to, resolved through the kernel tier
  // resolver, defaulting to the run adapter [CLM-0068, CLM-0076].
  const defaultInvoke = meteredInvoke(base, totals);
  const invokeFor: (node: TieredNode) => LoopInvoke =
    request.invoke === undefined
      ? buildInvokeForNode(adapter, tierAdapters, totals)
      : () => defaultInvoke;
  const engine = createEngine({
    executors: buildLoopExecutors({
      kern,
      workspaceDir: request.workspaceDir,
      invokeFor,
      adapter,
      refs,
      ...(request.checks === undefined ? {} : { checks: request.checks }),
    }),
    checkpoints,
    config: {
      K: kern.config.K,
      gates: { vote: kern.config.gates.vote },
      nodeOverrides: kern.config.nodeOverrides,
    },
  });
  const result =
    request.resumeRunId === undefined
      ? await engine.run(request.task, { runId })
      : await engine.resume(runId);
  return report(result, totals);
}
