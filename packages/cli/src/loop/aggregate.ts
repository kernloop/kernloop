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

/** A short, bounded reason a review rejected — its concrete correctness findings, else a generic note. */
function summarizeConcern(verdict: NonNullable<ChildResult['reviewVerdict']>): string {
  const msgs = verdict.findings
    .filter((f) => f.severity === 'error' || f.severity === 'blocker')
    .map((f) => f.message);
  const text =
    msgs.length > 0 ? msgs.join('; ') : 'review rejected on correctness (no specific finding)';
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

/**
 * Non-blocking `needs-review` signals (#226 item 5, CLM-0133): the ADVISORY review
 * gate's verdict is published to audit but otherwise invisible to the human. A
 * correctness REJECT becomes a `needs-review` Outcome signal (passed:false) so the
 * terminal (JSON on stdout, spec §3.4) sees residual doubt even on an otherwise-
 * `success` run — surfaced, NEVER auto-failing (the caller appends these AFTER
 * computing status from the blocking child signals).
 */
export function reviewConcernSignals(results: readonly ChildResult[]): Signal[] {
  const signals: Signal[] = [];
  for (const result of results) {
    if (result.reviewVerdict?.result !== 'reject') continue;
    signals.push({
      name: 'needs-review',
      passed: false,
      detail: `${result.child.id}: review flagged correctness — ${summarizeConcern(result.reviewVerdict)}`,
    });
  }
  return signals;
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
