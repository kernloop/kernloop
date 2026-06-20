/**
 * The single routing classifier for a {@link VerdictResult} (#192). Every place
 * the canonical loop branches on a gate's verdict goes through this function, so
 * that growing the Frozen-Five `VerdictResult` enum is a COMPILE error here (the
 * `never`-exhaustiveness guard in the `default` arm) rather than a silent
 * mis-route at a scattered `=== 'pass'` comparison — the latent-defect class the
 * #192 consumer audit found.
 *
 * Three dispositions:
 * - `advance` — the gate cleared (`approve`/`pass`): proceed.
 * - `escalate` — the gate ruled "a human must decide" (`escalate`, #192): the
 *   loop HALTS as escalated and surfaces to the operator (never a silent pass,
 *   never an automatic reject). Not a synchronous prompt — an autonomous loop
 *   has no human present at the moment of escalation.
 * - `block` — the gate did not clear (`reject`/`fail`/`abstain`): re-iterate
 *   within bounds, else escalate at the bound (the pre-existing behavior).
 */
import type { VerdictResult } from '@kernloop/contracts';

/** How the loop routes a verdict — see {@link verdictDisposition}. */
export type VerdictDisposition = 'advance' | 'escalate' | 'block';

/** Classify a {@link VerdictResult} into its loop routing disposition (#192). */
export function verdictDisposition(result: VerdictResult): VerdictDisposition {
  switch (result) {
    case 'approve':
    case 'pass':
      return 'advance';
    case 'escalate':
      return 'escalate';
    case 'reject':
    case 'fail':
    case 'abstain':
      return 'block';
    /* v8 ignore next 2 -- unreachable: every VerdictResult is handled above; the
       default exists only as the compile-time exhaustiveness guard (see below). */
    default:
      return assertUnreachableResult(result);
  }
}

/**
 * Compile-time exhaustiveness guard: if a new `VerdictResult` value is added
 * without a `case` above, `result` is no longer `never` here and this fails to
 * typecheck — forcing the new disposition to be handled, not silently dropped.
 */
/* v8 ignore next 3 -- the guard never runs while the switch is exhaustive */
function assertUnreachableResult(result: never): never {
  throw new Error(`unhandled VerdictResult: ${String(result)}`);
}
