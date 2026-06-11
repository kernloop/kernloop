/**
 * Mechanical child-result aggregation for the canonical loop's integrate node:
 * a per-child pass/fail Signal and the summed real cost. Kept apart from the
 * executors so neither file outgrows the 400-line budget.
 */
import { OutcomeSchema, type Cost, type Signal } from '@kernloop/contracts';
import type { ChildResult } from '@kernloop/workflows';

/**
 * Per-child verdict signal for integrate. The quality gate is blocking (a
 * child passes only on quality `pass`); the review gate is ADVISORY — its
 * verdict is reported for the record but never flips `passed`.
 */
export function childSignal(result: ChildResult): Signal {
  if (result.error !== undefined) {
    return { name: `child:${result.child.id}`, passed: false, detail: result.error };
  }
  const implemented = OutcomeSchema.safeParse(result.output);
  const implementStatus = implemented.success ? implemented.data.status : 'missing';
  // An escalated child hit the Kc/budget bound still failing [CLM-0043]: it is
  // never `passed`, and the signal says so honestly (with how many iterations
  // were spent), so integrate reports the stuck child rather than hiding it.
  const passed =
    result.escalated !== true && implementStatus === 'success' && result.verdict?.result === 'pass';
  const review =
    result.reviewVerdict === undefined ? '' : `; review ${result.reviewVerdict.result} (advisory)`;
  const escalated =
    result.escalated === true
      ? ` — ESCALATED after ${String(result.iteration + 1)} attempt(s)`
      : '';
  return {
    name: `child:${result.child.id}`,
    passed,
    detail: `implement ${implementStatus}; quality ${result.verdict?.result ?? 'not run'}${review}${escalated}`,
  };
}

/** Sum the real child costs (implement outcomes + quality verdicts). */
export function sumChildCosts(results: readonly ChildResult[]): Cost {
  const sum = { tokens: 0, usd: 0, wallClockMs: 0 };
  for (const result of results) {
    const implemented = OutcomeSchema.safeParse(result.output);
    for (const cost of [
      implemented.success ? implemented.data.cost : undefined,
      result.verdict?.cost,
    ]) {
      if (cost === undefined) continue;
      sum.tokens += cost.tokens;
      sum.usd += cost.usd;
      sum.wallClockMs += cost.wallClockMs ?? 0;
    }
  }
  return sum;
}
