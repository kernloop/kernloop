/**
 * The composition root's canonical-loop entry [CLM-0046]: bind the
 * @kernloop/workflows engine to the real executor set (loop/executors.ts),
 * a durable JSONL checkpoint store under `<overlay>/checkpoints/<runId>.jsonl`
 * (machine-local; `kernloop init` gitignores it), and the loaded overlay's
 * loop config (K, vote gate thresholds, node overrides — field-for-field,
 * the schemas match by design [CLM-0045]).
 *
 * Statuses are surfaced honestly: `completed` carries retrospect's Outcome;
 * `escalated` means the run HALTED resumably — the K vote-iterate bound was
 * exhausted, the budget hit, or a cooperative abort fired (#304, `haltReason`
 * distinguishes them) — and `kernloop run --resume <runId>` continues from the
 * last checkpoint; `failed` carries the typed engine error and the last
 * checkpoint stays resumable.
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
import { appendEvent, droppedEnvKeys, type AdapterName } from '@kernloop/kernel';
import { cleanHalt, guardWorkspaceContainment, report } from './finalize.js';
import type { QualityCheck } from '@kernloop/faculty-gates';
import { loadDiscoveredCache } from '@kernloop/faculty-models';
import {
  JsonlCheckpointStore,
  type RunResult,
  type RunState,
  type TraceEntry,
} from '@kernloop/workflows';
import type { Kernloop } from '../kernel.js';
import { type LoopRefs } from './executors.js';
import { writeDocArtifact, type DocArtifactResult } from './doc-artifact.js';
import { LoopResumeError, adapterInvoke, type LoopInvoke, type RunTotals } from './invoke.js';
import { type TieredNode } from './node-model.js';
import { type NodeSeam } from './node-seam.js';
import { buildInvokeForNode, injectedSeamFor } from './node-bind.js';
import { buildAdapterSelector } from './adapter-fitness.js';
import { LIVE_FITNESS_LEDGER_LIMIT } from '../tools/live-fitness-wiring.js';
import { type OnDowngrade } from './downgrade.js';

export { TIERED_NODES, type TieredNode } from './node-model.js';
export {
  resolveServed,
  servedRef,
  identityRef,
  servedIdentity,
  type ServedModel,
  type NodeSeam,
} from './node-seam.js';

export { buildInvokeForNode, injectedSeamFor } from './node-bind.js';
import { buildLoopEngine, ensureRunAdaptersAvailable, resolveBudgetMode } from './engine-build.js';

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
  /**
   * Cooperative-abort signal (#304, CLM-0143). When it fires, the engine halts
   * at the NEXT node boundary (CLM-0044) and the run is reported as a clean,
   * resumable cancel (status `escalated`, `haltReason: 'aborted'`) carrying the
   * spend-so-far — NOT a dirty failure. Absent ⇒ the run is byte-identical.
   */
  readonly signal?: AbortSignal;
}

/** The loop RunResult mapped for the run tool, plus the metered model spend. */
export interface LoopReport {
  readonly runId: string;
  readonly status: 'completed' | 'escalated' | 'failed';
  /**
   * Why an `escalated` run halted: `'vote'`/`'budget'` (the engine's halts) or
   * `'aborted'` (cooperative abort, #304). cli-owned (not a frozen field); it
   * lets the run-tool map an abort to the `cancelled` Outcome status, distinct
   * from a vote/budget escalate (which maps to `partial`).
   */
  readonly haltReason?: string;
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
  /**
   * Per-child metered spend attribution (#56): one entry per fan-out child whose
   * sub-chain incurred model spend, sliced from the run-global meter by the
   * sequential child boundary. Each carries only its OWN sub-chain spend, so the
   * entries sum to at most the run `cost` (the main chain is not attributed).
   * Both are per-PROCESS (#212): a resumed run reports only post-resume
   * attribution, just as `cost` reflects only the post-resume meter.
   */
  readonly childSpend?: readonly { readonly childId: string; readonly spend: Cost }[];
  /**
   * The derived API-doc artifact written from the deliverable's doc-comments on
   * a completed run [CLM-0105]. Absent when the run did not complete; present
   * with `written: false` when the deliverable exposed no TS/JS symbols.
   */
  readonly docArtifact?: DocArtifactResult;
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

/** Load the latest checkpoint for a resumed run and prime the cross-node refs. */
async function primeFromCheckpoint(
  kern: Kernloop,
  checkpoints: JsonlCheckpointStore,
  runId: string,
  refs: LoopRefs,
): Promise<void> {
  const latest = await checkpoints.latest(runId);
  if (latest === undefined) throw new LoopResumeError(runId, checkpointFile(kern.paths.dir, runId));
  primeRefs(refs, latest.state);
}

/**
 * Post-loop, only when the run reached retrospect (status `completed`) — whether
 * the work's Outcome was success OR failure: mine the deliverable's doc-comments
 * into a derived `API.generated.md` and audit the counts [CLM-0105]. (It
 * documents whatever was produced; a completed-but-failing run still has code.)
 * Deterministic and model-free; a run that ESCALATED or FAILED before retrospect
 * produces no artifact. Audited once with counts only — never a symbol name,
 * never code.
 */
/**
 * Audit each node's first budget-aware downgrade (#194) as `cli.loop.downgrade`
 * — the run-global meter crossed the configured fraction, so this node dropped a
 * tier. Deduped per node (a re-resolved node fires the callback every call; we
 * record the first drop only) so the audit names which nodes ran cheaper.
 */
function downgradeAudit(kern: Kernloop, runId: string): OnDowngrade {
  const seen = new Set<string>();
  return (e) => {
    if (seen.has(e.node)) return;
    seen.add(e.node);
    appendEvent(kern.store, {
      type: 'cli.loop.downgrade',
      payload: {
        runId,
        node: e.node,
        fromTier: e.fromTier,
        toTier: e.toTier,
        spendFraction: e.spendFraction,
      },
    });
  };
}

/**
 * The per-MODEL-CALL identity-fitness wiring threaded into the default seams
 * (#66, CLM-0125): each node's served {@link ModelIdentity} — normalized against
 * the SAME discovered cache provenance uses — feeds the Observer's ADDITIVE
 * identity-fitness series via `onModelCall`, re-keying fitness on the model
 * CLASS so a version bump does not reset learning. The subject-keyed ledger (and
 * the priors/router that read it) are untouched. The injected-invoke path
 * (tests / MCP sampling) omits it.
 */
function modelFitness(kern: Kernloop): Parameters<typeof buildInvokeForNode>[5] {
  const discovered = loadDiscoveredCache(kern.paths.modelsCache, kern.store.clock().toISOString());
  // Live identity-fitness adapter selection (#252, CLM-0130): read the ledger
  // ONCE per run (bounded, recency-ordered) and bind the selector when opted in.
  const selectAdapter = buildAdapterSelector({
    enabled: kern.config.adapterFitness.enabled,
    epsilon: kern.config.adapterFitness.epsilon,
    ledger: kern.observer.identityFitnessLedger(LIVE_FITNESS_LEDGER_LIMIT),
    deliverableLedger: kern.observer.outcomeFitnessLedger(LIVE_FITNESS_LEDGER_LIMIT),
    discovered,
    endpoints: kern.config.endpoints,
    store: kern.store,
    rng: kern.rng,
    now: () => kern.store.clock().getTime(),
  });
  return {
    discovered,
    onModelCall: (identity, success, cost) =>
      kern.observer.ingestModelFitness(identity, success, cost),
    ...(selectAdapter === undefined ? {} : { selectAdapter }),
  };
}

/**
 * Audit the env scoping once per real run (rule 7): a spawned model CLI gets
 * the benign base allowlist ∪ `adapterEnvAllow`, NOT the host env — record how
 * many host vars were withheld so the redaction is never silent (#227,
 * CLM-0122). Skipped when the caller injects its own invoke (no CLI spawns).
 */
function auditEnvScoping(kern: Kernloop, runId: string): void {
  appendEvent(kern.store, {
    type: 'cli.run.env-scoped',
    payload: {
      runId,
      droppedCount: droppedEnvKeys(process.env, kern.config.adapterEnvAllow).length,
      allowExtra: kern.config.adapterEnvAllow.length,
    },
  });
}

/**
 * The run's base model seam: a caller-injected invoke verbatim, else the real
 * adapter — probed up front (absence is the kernel's typed error, never a stub),
 * its child env scoped to the benign allowlist ∪ `adapterEnvAllow` and that
 * scoping audited (#227). Model-CLI subprocesses run in the task WORKSPACE, not
 * kernloop's launch dir (#146).
 */
function resolveBaseInvoke(
  kern: Kernloop,
  request: LoopRequest,
  adapter: AdapterName,
  runId: string,
): LoopInvoke {
  if (request.invoke !== undefined) return request.invoke;
  ensureRunAdaptersAvailable(adapter, kern.config);
  auditEnvScoping(kern, runId);
  return adapterInvoke(adapter, undefined, request.workspaceDir, kern.config.adapterEnvAllow);
}

function documentDeliverable(
  kern: Kernloop,
  runId: string,
  request: LoopRequest,
  status: RunResult['status'],
): DocArtifactResult | undefined {
  if (status !== 'completed') return undefined;
  const artifact = writeDocArtifact(request.workspaceDir);
  appendEvent(kern.store, {
    type: 'loop.document',
    payload: {
      taskId: request.task.id, // both ids so a task.id filter catches the run (#343)
      runId,
      written: artifact.written,
      symbolCount: artifact.symbolCount,
      documentedCount: artifact.documentedCount,
    },
  });
  return artifact;
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
  const runId = request.resumeRunId ?? request.runId ?? randomUUID();
  guardWorkspaceContainment(kern, adapter, request, runId);
  const base = resolveBaseInvoke(kern, request, adapter, runId);
  const checkpoints = new JsonlCheckpointStore(checkpointFile(kern.paths.dir, runId));
  const refs: LoopRefs = {};
  if (request.resumeRunId !== undefined) await primeFromCheckpoint(kern, checkpoints, runId, refs);
  const totals: RunTotals = { tokens: 0, usd: 0 };
  // Per-node seams, all metered. With a real run, each node derives its
  // requirement and binds the adapter+model that serves it [CLM-0078]. An
  // injected invoke routes every node through that one base, but still resolves
  // the node's SERVED model+effort against the run adapter so provenance stays
  // honest about what each node requested.
  // Budget-aware downgrade (#194): past the overlay fraction, later nodes route a tier lower.
  const budget = { tokens: request.task.budget.tokens, usd: request.task.budget.usd };
  const onDowngrade = downgradeAudit(kern, runId);
  const invokeFor: (node: TieredNode) => NodeSeam =
    request.invoke === undefined
      ? buildInvokeForNode(adapter, kern.config, totals, budget, onDowngrade, modelFitness(kern))
      : injectedSeamFor(adapter, kern.config, base, totals, budget, onDowngrade);
  // Effective budget mode [CLM-0077]: --unlimited forces unlimited; else the
  // overlay's budgetMode (default enforce). An unlimited run is recorded honestly.
  const mode = resolveBudgetMode(kern, request, runId);
  const engine = buildLoopEngine(kern, request, {
    runId,
    checkpoints,
    refs,
    adapter,
    invokeFor,
    mode,
    totals,
  });
  const signalOpt = request.signal === undefined ? {} : { signal: request.signal };
  const raw =
    request.resumeRunId === undefined
      ? await engine.run(request.task, { runId, ...signalOpt })
      : await engine.resume(runId, signalOpt);
  const { result, aborted } = cleanHalt(raw);
  const docArtifact = documentDeliverable(kern, runId, request, result.status);
  return report(result, totals, mode === 'unlimited', docArtifact, aborted ? 'aborted' : undefined);
}
