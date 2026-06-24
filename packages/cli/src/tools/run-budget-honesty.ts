/**
 * Budget-metering honesty for the run tool (#462), split from run.ts for line
 * budget. A `usd` budget can only be enforced on an adapter that reports per-call
 * dollar cost; on a CLI adapter that does not (`metersUsd: false`), the cap is
 * silently inert (reads $0) — so we audit the degradation rather than lie.
 */
import { ADAPTER_NAMES, adapterDefinitions, appendEvent, type AdapterName } from '@kernloop/kernel';
import type { TaskContract } from '@kernloop/contracts';
import type { Kernloop } from '../kernel.js';

/**
 * Audit when a USD budget cannot be enforced (#462): an enforce-mode run with a usd
 * budget on a CLI adapter that reports no dollar cost (`metersUsd: false` —
 * codex/agy/opencode/ollama) would see $0 spend and never halt, so the cap is silently
 * inert. We do NOT fail closed (a fallback bound still exists, and blocking every
 * non-claude run with a default usd budget would be disproportionate); instead we record
 * the honest degradation (rule 7) so it is observable, never silent.
 *
 * The reason reflects REALITY per adapter: codex/opencode meter TOKENS, so the token
 * budget still bounds the run; agy/ollama meter NOTHING (`metersTokens: false`), so
 * BOTH the usd AND token budgets are inert and only wallClock + the Kc iteration cap
 * bound the run — the audit must not claim a token budget applies when it does not. An
 * endpoint adapter has its own `metersUsd` handling (#393) and is skipped here.
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
  const adapter = opts.adapter;
  if (!(ADAPTER_NAMES as readonly string[]).includes(adapter)) return; // endpoint or unknown
  const def = adapterDefinitions[adapter as AdapterName];
  if (def.metersUsd) return; // dollar cost is metered → the usd budget is enforceable
  const reason = def.metersTokens
    ? 'adapter reports no per-call dollar cost (metersUsd: false); the usd budget is inert (reads $0) — the TOKEN budget still bounds the run'
    : 'adapter meters NEITHER dollar cost NOR tokens (metersUsd + metersTokens both false); BOTH the usd and token budgets are inert — the run is bounded only by the Kc iteration cap (plus any configured wallClock budget)';
  appendEvent(kern.store, {
    type: 'cli.budget.usd-unenforceable',
    payload: {
      adapter,
      usdBudget: task.budget.usd,
      taskId: task.id,
      metersTokens: def.metersTokens,
      reason,
    },
  });
}
