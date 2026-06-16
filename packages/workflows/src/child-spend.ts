/**
 * Per-child spend attribution for the fan-out (#56). Because the canonical loop
 * runs children SEQUENTIALLY, the engine slices the run-global meter by the
 * child boundary: snapshot an injected `meteredSpend` readout when it first
 * steps into a child, and the delta to any later point is that child's spend,
 * summed across all its Kc iterations. Pure of I/O — the engine owns the loop;
 * this owns the arithmetic and the per-child budget verdict.
 */
import { childOverOwnBudget, type BudgetSpend } from './budget.js';
import type { RunResult, RunState } from './state.js';

/**
 * Tracks the spend baseline of the child the fan-out is currently running and
 * derives each child's attributed slice from the live meter. Unmetered (no
 * `meteredSpend` seam) → every readout is undefined and nothing is attributed.
 */
export class ChildSpendTracker {
  private baseline: { index: number; spend: BudgetSpend } | undefined;

  constructor(private readonly meteredSpend: (() => BudgetSpend) | undefined) {}

  /**
   * Start-of-loop reset: forget the baseline AND drop any pre-resume child spend
   * (#212), so attribution is per-PROCESS — a resumed run re-attributes from the
   * fresh meter and `childSpend` stays within the (also per-process) run cost.
   */
  reset(state: RunState): void {
    this.baseline = undefined;
    for (const r of state.childResults) r.spend = undefined;
  }

  /** Snapshot the meter as child `index`'s baseline the first time it is stepped. */
  ensureBaseline(index: number): void {
    const spend = this.meteredSpend?.();
    if (spend === undefined || this.baseline?.index === index) return;
    this.baseline = { index, spend };
  }

  /** Spend attributed to child `index` so far: meter now minus its baseline (≥ 0). */
  delta(index: number): BudgetSpend | undefined {
    const spend = this.meteredSpend?.();
    if (spend === undefined || this.baseline?.index !== index) return undefined;
    const base = this.baseline.spend;
    return {
      tokens: Math.max(0, spend.tokens - base.tokens),
      usd: Math.max(0, spend.usd - base.usd),
    };
  }

  /** Record child `index`'s attributed spend onto its result row (#56). */
  attribute(state: RunState, index: number): void {
    const d = this.delta(index);
    const result = state.childResults[index];
    if (d !== undefined && result !== undefined) result.spend = d;
  }

  /**
   * False when the CURRENT fan-out child has overspent its OWN sliced budget —
   * gating re-iteration in ENFORCE mode only (`enforce` false → never halts
   * per-child, mirroring the run-level discipline). Sibling-independent.
   */
  withinOwnBudget(enforce: boolean, state: RunState): boolean {
    if (!enforce || state.cursor.phase !== 'fanout') return true;
    const d = this.delta(state.cursor.childIndex);
    const result = state.childResults[state.cursor.childIndex];
    if (d === undefined || result === undefined) return true;
    return !childOverOwnBudget(result.child.budget, d);
  }
}

/** Per-child spend entries for a RunResult, or undefined when none was metered (#56). */
export function childSpends(state: RunState): RunResult['childSpend'] {
  const entries = state.childResults.flatMap((r) =>
    r.spend === undefined ? [] : [{ childId: r.child.id, spend: r.spend }],
  );
  return entries.length > 0 ? entries : undefined;
}
