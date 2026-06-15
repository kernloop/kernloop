/**
 * Runtime budget enforcement for the canonical loop (spec §8) [CLM-0077].
 * The kernel meters per-adapter spend; the engine reads a metered snapshot
 * through an injected `spent()` seam (workflows imports no kernel — it talks
 * a plain function) and decides whether a bounded run may continue.
 *
 * Two modes, one tracking discipline: `enforce` HALTS the run (escalates,
 * resumable) the moment metered spend exceeds the parent TaskContract budget;
 * `unlimited` NEVER halts on budget — the restriction is lifted, the tracking
 * is not. Usage/cost is metered and reported identically in both modes; an
 * `unlimited` run is recorded honestly so a report never implies a cap was
 * honored when it wasn't. Kc still bounds child iteration in unlimited mode
 * (unlimited budget is not unlimited iterations — raising Kc allows more).
 */
import { z } from 'zod';
import type { Finding } from '@kernloop/contracts';
import type { RunState } from './state.js';

/** Enforcement mode for a run's budget (spec §8) [CLM-0077]. */
export const BudgetModeSchema = z.enum(['enforce', 'unlimited']);
export type BudgetMode = z.infer<typeof BudgetModeSchema>;

/** Metered spend snapshot the engine reads (tokens + usd; wall-clock is the run's). */
export interface BudgetSpend {
  readonly tokens: number;
  readonly usd: number;
}

/** The parent budget a bounded run may not exceed (the TaskContract.budget dims). */
export interface BudgetLimit {
  readonly tokens: number;
  readonly usd: number;
}

/**
 * The injected budget guard. `mode` is the enforcement mode; `limit` is the
 * parent budget; `spent()` returns the live metered snapshot (the CLI's
 * `totals`). Absent → no runtime enforcement (the engine's tests and any
 * composition root that does not meter run with no budget halt; Kc still
 * bounds child iteration). Present with `enforce` → the run halts when spend
 * exceeds the limit on any tracked dimension.
 */
export interface BudgetGuard {
  readonly mode: BudgetMode;
  readonly limit: BudgetLimit;
  readonly spent: () => BudgetSpend;
}

/**
 * True when a bounded run has overspent its parent budget on any tracked
 * dimension. `unlimited` mode always returns false (never halts); an absent
 * guard never halts. Comparison is strict `>`: spending exactly the budget is
 * within it, exceeding it is the halt.
 */
export function overBudget(guard: BudgetGuard | undefined): boolean {
  if (guard === undefined || guard.mode === 'unlimited') return false;
  const spent = guard.spent();
  return spent.tokens > guard.limit.tokens || spent.usd > guard.limit.usd;
}

/** A per-child sliced budget the fan-out attributes spend against (#56). */
export interface ChildBudget {
  readonly tokens: number;
  readonly usd: number;
}

/**
 * True when a child has overspent ITS OWN sliced budget (#56) — gauged by the
 * spend ATTRIBUTED to its sub-chain, never the run total, so one child's
 * overspend is independent of its siblings'. A zero-slice child (a specialist
 * adds WORK, not budget — spec §6) carries nothing to overspend and is never
 * gated here; Kc and the run budget still bound it. Strict `>`, mirroring
 * {@link overBudget}.
 */
export function childOverOwnBudget(budget: ChildBudget, spend: BudgetSpend): boolean {
  if (budget.tokens <= 0 && budget.usd <= 0) return false;
  return spend.tokens > budget.tokens || spend.usd > budget.usd;
}

/** The structured finding recorded when an enforce-mode run halts on budget [CLM-0077]. */
export function overspendFinding(guard: BudgetGuard): Finding {
  const spent = guard.spent();
  return {
    severity: 'error',
    message:
      `run exceeded its budget (spent ${String(spent.tokens)} tokens / $${String(spent.usd)}; ` +
      `limit ${String(guard.limit.tokens)} tokens / $${String(guard.limit.usd)}) — ` +
      'halted in enforce mode; raise the budget or re-run unlimited, then resume',
  };
}

/**
 * Runtime budget enforcement [CLM-0077]: in `enforce` mode a run that has now
 * overspent its parent budget HALTS as escalated (resumable). `unlimited` never
 * halts here; a finished run is not retro-halted — its cost is still reported in
 * full by the always-on metering. Mutates `state` in place.
 */
export function enforceBudget(state: RunState, guard: BudgetGuard | undefined): void {
  if (state.status !== 'running' || state.cursor.phase === 'done') return;
  if (guard === undefined || !overBudget(guard)) return;
  state.status = 'escalated';
  state.haltReason = 'budget';
  state.findings.push(overspendFinding(guard));
}
