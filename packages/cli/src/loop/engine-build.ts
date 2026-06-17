/**
 * Engine assembly for the canonical-loop composition root (#62, split from
 * loop/index.ts): the seams that turn an assembled kernloop + an overlay into a
 * ready `@kernloop/workflows` Engine — up-front adapter availability, the
 * runtime budget guard, the per-child-iteration audit hook, and the effective
 * budget-mode resolution. Pure composition; the workflows engine imports no
 * kernel, so each kernel touch (audit append, metered totals) lives here.
 */
import { appendEvent, type AdapterName } from '@kernloop/kernel';
import { loadDiscoveredCache } from '@kernloop/faculty-models';
import {
  JsonlCheckpointStore,
  createEngine,
  type BudgetGuard,
  type BudgetMode,
  type ChildIterateEvent,
  type Engine,
} from '@kernloop/workflows';
import type { Kernloop } from '../kernel.js';
import { type Overlay } from '../overlay.js';
import { tierCandidates } from '../overlay-schemas.js';
import { buildLoopExecutors, type LoopRefs } from './executors.js';
import { ensureAdapterAvailable } from './invoke.js';
import { type TieredNode } from './node-model.js';
import { type NodeSeam } from './node-seam.js';
import type { LoopRequest } from './index.js';

/**
 * Probe every adapter a default-seam run can actually call — the run adapter
 * plus any tier adapter the overlay declares — so a misconfigured environment
 * fails fast up front, never mid-loop. Each absence is a typed error.
 */
export function ensureRunAdaptersAvailable(runAdapter: AdapterName, overlay: Overlay): void {
  ensureAdapterAvailable(runAdapter);
  for (const tier of ['frontier', 'large', 'medium', 'small'] as const) {
    // A tier may list multiple candidate adapters (#252) — probe each CLI one.
    for (const tierAdapter of tierCandidates(overlay.adapters, tier)) {
      // A registered endpoint id is an api adapter — no CLI to probe on PATH; its
      // key is validated fail-closed at call time (ApiKeyMissingError), not here.
      if (tierAdapter !== runAdapter && overlay.endpoints[tierAdapter] === undefined) {
        ensureAdapterAvailable(tierAdapter as AdapterName);
      }
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
export function buildLoopEngine(
  kern: Kernloop,
  request: LoopRequest,
  seams: {
    runId: string;
    checkpoints: JsonlCheckpointStore;
    refs: LoopRefs;
    adapter: AdapterName;
    invokeFor: (node: TieredNode) => NodeSeam;
    mode: BudgetMode;
    totals: { tokens: number; usd: number };
  },
): Engine {
  return createEngine({
    executors: buildLoopExecutors({
      kern,
      workspaceDir: request.workspaceDir,
      invokeFor: seams.invokeFor,
      adapter: seams.adapter,
      refs: seams.refs,
      // The discovered cache is loaded ONCE per run; a synced served model then
      // normalizes by table in provenance (loadDiscoveredCache degrades a
      // missing/corrupt cache to empty, so an unsynced run is unaffected).
      discovered: loadDiscoveredCache(kern.paths.modelsCache, kern.store.clock().toISOString()),
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
    // Always-on metered readout for per-child attribution (#56) — the same
    // `totals` the budget guard reads, sliced per child by the engine.
    meteredSpend: () => ({ tokens: seams.totals.tokens, usd: seams.totals.usd }),
    onChildIterate: childIterateAudit(kern, seams.runId),
  });
}

/**
 * Resolve the run's effective budget mode [CLM-0077]: a run-level --unlimited
 * forces unlimited, else the overlay's budgetMode (default enforce). An
 * unlimited run is recorded honestly with a `loop.unlimited` audit event so no
 * report later implies a cap was honored when it wasn't.
 */
export function resolveBudgetMode(kern: Kernloop, request: LoopRequest, runId: string): BudgetMode {
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
