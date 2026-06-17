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
import { appendEvent, droppedEnvKeys, type AdapterName } from '@kernloop/kernel';
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
import { type OnDowngrade } from './downgrade.js';

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

/** Map the engine's RunResult into the report the run tool returns. */
function report(
  result: RunResult,
  totals: RunTotals,
  unlimited: boolean,
  docArtifact: DocArtifactResult | undefined,
): LoopReport {
  return {
    runId: result.runId,
    status: result.status,
    nodeTrace: result.nodeTrace,
    // Always-on reporting [CLM-0077]: metered spend rides in both modes, with the
    // per-adapter breakdown whenever any model call was metered (one bucket for a
    // single-adapter run, several for a tiered one) (#44).
    cost: {
      tokens: totals.tokens,
      usd: totals.usd,
      ...(totals.byAdapter === undefined ? {} : { byAdapter: totals.byAdapter }),
    },
    unlimited,
    // Per-child spend attribution (#56): the meter sliced by the fan-out boundary.
    ...(result.childSpend === undefined ? {} : { childSpend: result.childSpend }),
    ...(result.outcome === undefined ? {} : { outcome: result.outcome }),
    ...(result.findings === undefined ? {} : { findings: result.findings }),
    ...(result.error === undefined
      ? {}
      : { error: { code: result.error.code, message: result.error.message } }),
    ...(docArtifact === undefined ? {} : { docArtifact }),
  };
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
  return {
    discovered: loadDiscoveredCache(kern.paths.modelsCache, kern.store.clock().toISOString()),
    onModelCall: (identity, success, cost) =>
      kern.observer.ingestModelFitness(identity, success, cost),
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
  status: RunResult['status'],
  workspaceDir: string,
): DocArtifactResult | undefined {
  if (status !== 'completed') return undefined;
  const artifact = writeDocArtifact(workspaceDir);
  appendEvent(kern.store, {
    type: 'loop.document',
    payload: {
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
  const base = resolveBaseInvoke(kern, request, adapter, runId);
  const checkpoints = new JsonlCheckpointStore(checkpointFile(kern.paths.dir, runId));
  const refs: LoopRefs = {};
  if (request.resumeRunId !== undefined) {
    const latest = await checkpoints.latest(runId);
    if (latest === undefined) {
      throw new LoopResumeError(runId, checkpointFile(kern.paths.dir, runId));
    }
    primeRefs(refs, latest.state);
  }
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
  const result =
    request.resumeRunId === undefined
      ? await engine.run(request.task, { runId })
      : await engine.resume(runId);
  const docArtifact = documentDeliverable(kern, runId, result.status, request.workspaceDir);
  return report(result, totals, mode === 'unlimited', docArtifact);
}
