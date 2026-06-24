/**
 * Budget-metering honesty for the run tool (#462, #470), split from run.ts for line
 * budget. A `usd` budget can only be enforced on an adapter that reports per-call
 * dollar cost; on a CLI adapter that does not (`metersUsd: false`) OR a registered
 * endpoint with `metersUsd: false` (the default), the cap is silently inert (reads $0,
 * no ceiling) — so we audit the degradation rather than lie.
 */
import { ADAPTER_NAMES, adapterDefinitions, appendEvent, type AdapterName } from '@kernloop/kernel';
import type { TaskContract } from '@kernloop/contracts';
import type { Kernloop } from '../kernel.js';

/** Why a usd budget is unenforceable on this adapter, or null if it IS enforceable. */
interface Unenforceable {
  /** Static token-metering fact (CLI adapter), or null when runtime-dependent (endpoint). */
  readonly metersTokens: boolean | null;
  readonly text: string;
}

/**
 * Reason a usd budget cannot be enforced on `adapter`, or null when it is enforceable
 * (the adapter/endpoint reports dollar cost) or unknown. Covers BOTH halves of the
 * silently-inert-cap class: a built-in CLI adapter with `metersUsd: false`
 * (codex/agy/opencode/ollama) and a registered endpoint with `metersUsd !== true`
 * (#470 — the endpoint default, `endpoints.ts`). For a CLI adapter the token-metering
 * fact is static; for an endpoint it is runtime-dependent (tokens are metered only when
 * the 2xx returns OpenAI-compatible `usage.*`), so the reason states that honestly.
 */
function unenforceableUsdReason(kern: Kernloop, adapter: string): Unenforceable | null {
  if ((ADAPTER_NAMES as readonly string[]).includes(adapter)) {
    const def = adapterDefinitions[adapter as AdapterName];
    if (def.metersUsd) return null; // dollar cost metered → the usd budget is enforceable
    return {
      metersTokens: def.metersTokens,
      text: def.metersTokens
        ? 'adapter reports no per-call dollar cost (metersUsd: false); the usd budget is inert (reads $0) — the TOKEN budget still bounds the run'
        : 'adapter meters NEITHER dollar cost NOR tokens (metersUsd + metersTokens both false); BOTH the usd and token budgets are inert — the run is bounded only by the Kc iteration cap (plus any configured wallClock budget)',
    };
  }
  const endpoint = kern.config.endpoints[adapter];
  if (endpoint === undefined || endpoint.metersUsd === true) return null; // unknown, or cost-metered
  return {
    metersTokens: null, // endpoint token metering is runtime-dependent (only if usage.* is returned)
    text: 'endpoint reports no per-call dollar cost (metersUsd: false); the usd budget is inert (reads $0, no ceiling) — the TOKEN budget bounds the run only if this endpoint returns OpenAI-compatible token usage, which is endpoint-dependent',
  };
}

/**
 * Audit when a USD budget cannot be enforced (#462, #470): an enforce-mode run with a usd
 * budget on an adapter that reports no dollar cost would see $0 spend and never halt, so the
 * cap is silently inert. We do NOT fail closed (a fallback bound still exists, and blocking
 * every non-claude run with a default usd budget would be disproportionate); instead we record
 * the honest degradation (rule 7) so it is observable, never silent. The reason reflects REALITY
 * per adapter — see {@link unenforceableUsdReason}.
 *
 * GATED to `workflow.canonical` (#469): only the canonical loop wires the runtime budget
 * guard and makes adapter model calls, so only there is a usd budget actually consulted.
 * A non-loop capability (memory.read, gate.quality, brief.compile) consults NO budget, so
 * auditing "the usd budget is inert" for it would be a misleading record — exactly the
 * lie this audit exists to prevent.
 */
export function auditUsdBudgetUnenforceable(
  kern: Kernloop,
  task: TaskContract,
  opts: { readonly adapter: string; readonly unlimited: boolean; readonly capability: string },
): void {
  if (opts.capability !== 'workflow.canonical' || opts.unlimited || task.budget.usd <= 0) return;
  const reason = unenforceableUsdReason(kern, opts.adapter);
  if (reason === null) return;
  appendEvent(kern.store, {
    type: 'cli.budget.usd-unenforceable',
    payload: {
      adapter: opts.adapter,
      usdBudget: task.budget.usd,
      taskId: task.id,
      metersTokens: reason.metersTokens,
      reason: reason.text,
    },
  });
}
