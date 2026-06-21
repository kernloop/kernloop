/**
 * Pre-flight model-CALL-COUNT estimate (#303, EPIC #47·P5, CLM-0138). A PURE
 * function over the frozen CANONICAL_LOOP shape × the overlay K/Kc/panel config
 * → a [min,max] BAND on the number of model calls a run will make, computed
 * BEFORE it runs. Honest by construction: the call count is exactly derivable
 * from the graph, but a DOLLAR figure is NOT (per-call cost is metered at
 * runtime, never declared), so this NEVER invents one — a $ projection is the
 * caller's own explicit rate × this count.
 *
 * The band is wide because iteration/retry and the child count are
 * runtime-variable: `min` is the first-pass happy path; `max` assumes every gate
 * iterates to its cap and the implement parse-retry (CLM-0107) fires. Child
 * count is an EXPLICIT assumed input (decompose decides it at runtime). The
 * arithmetic is bound to ACTUAL loop behavior by a live-run test, not only
 * self-consistent vectors (#303 vote condition).
 */

/** The config knobs that drive the canonical loop's model-call count. */
export interface LoopShape {
  /** Vote-iterate cap (overlay K): plan+vote re-run up to K+1 times on reject. */
  readonly K: number;
  /** Child actor-critic cap (overlay Kc): implement re-runs up to Kc+1 times. */
  readonly Kc: number;
  /** Vote panel size (gates.vote.panel ∈ {3,7}) — one model call per voter. */
  readonly votePanel: number;
  /** Review panel size: 3 defect lenses, +1 when gates.review.groundedness. */
  readonly reviewPanel: number;
  /** When review drives child iteration (default off), review re-runs per attempt. */
  readonly reviewDrivesIteration: boolean;
  /**
   * The parsimony gate intensity (gates.parsimony.intensity, DEFAULT full, #9/#415):
   *  - `off`            ⇒ 0 parsimony calls (the gate does no work);
   *  - `lite`           ⇒ 2 calls/child, single-pass (advisory, never re-iterates);
   *  - `full` / `ultra` ⇒ 2 calls/child, and ENFORCING — a refute (or an ultra
   *                       deferral) re-runs the child, so the MAX scales with childAttempts.
   */
  readonly parsimonyIntensity: 'off' | 'lite' | 'full' | 'ultra';
}

/** A [min,max] count band — min is the happy path, max the worst case. */
export interface CallBand {
  readonly min: number;
  readonly max: number;
}

/** A per-node + total call-count estimate with its stated assumptions. */
export interface LoopCallEstimate {
  readonly perNode: Readonly<Record<string, CallBand>>;
  readonly total: CallBand;
  readonly childCount: number;
  readonly assumptions: readonly string[];
}

/** Default assumed child count when none is known (decompose is a runtime decision). */
export const DEFAULT_ASSUMED_CHILDREN = 3;

const band = (min: number, max: number): CallBand => ({ min, max });

/**
 * The parsimony node's call band (#9/#415): per child ONE assessor call + ONE blind-
 * verifier call (#413) = 2×c per attempt. `off` ⇒ 0 (the gate does no work); `lite` ⇒
 * 2×c single-pass (advisory, never re-iterates); `full`/`ultra` ENFORCE, so the MAX
 * scales with `childAttempts` (a refute / ultra-deferral re-runs the child, like review
 * at enforce). The sole sub-min case (an assessment with NO claimed-pass guard ⇒ the
 * verifier confirms vacuously without a call, c) is below this happy-path min.
 */
function parsimonyBand(
  intensity: LoopShape['parsimonyIntensity'],
  c: number,
  childAttempts: number,
): CallBand {
  if (intensity === 'off') return band(0, 0);
  const runs = intensity === 'full' || intensity === 'ultra' ? childAttempts : 1;
  return band(2 * c, 2 * c * runs);
}

/**
 * Estimate the model-call-count band for one canonical-loop run of the given
 * shape and assumed child count (#303, CLM-0138). Pure: same inputs → same
 * output. The arithmetic is proven against a real loop run, not just itself.
 */
export function estimateLoopCalls(
  shape: LoopShape,
  opts: { childCount: number },
): LoopCallEstimate {
  const { K, Kc, votePanel, reviewPanel, reviewDrivesIteration, parsimonyIntensity } = shape;
  const c = opts.childCount;
  const plan = band(1, K + 1); // vote reject re-enters plan until iteration ≥ K
  const childAttempts = Kc + 1; // quality reject reiterates until iteration ≥ Kc
  const reviewRuns = reviewDrivesIteration ? childAttempts : 1; // review is advisory by default
  const perNode: Record<string, CallBand> = {
    research: band(1, 1),
    plan,
    vote: band(votePanel * plan.min, votePanel * plan.max),
    decompose: band(1, 1),
    implement: band(c, 2 * c * childAttempts), // ×2: the CLM-0107 parse-retry
    quality: band(0, 0), // mechanical checks — no model call
    review: band(c * reviewPanel, c * reviewPanel * reviewRuns),
    parsimony: parsimonyBand(parsimonyIntensity, c, childAttempts), // #9/#415 (see helper)
    retrospect: band(0, 0),
  };
  const total = Object.values(perNode).reduce(
    (a, b) => band(a.min + b.min, a.max + b.max),
    band(0, 0),
  );
  return {
    perNode,
    total,
    childCount: c,
    assumptions: [
      `child count assumed = ${String(c)} (decompose decides this at runtime)`,
      `min = first-pass approval, no retries; max = every gate iterates to its cap (plan ×${String(K + 1)}, implement ×${String(childAttempts)}) and the parse-retry fires`,
      'quality runs mechanical checks only (0 model calls)',
      'no $ shown: per-call cost is metered at runtime, not declared — multiply this call count by your known per-call rate to project spend',
    ],
  };
}

/** A human summary for `doctor`: a one-line band + the assumptions as bullets. */
export function formatEstimate(e: LoopCallEstimate): string {
  return [
    `${String(e.total.min)}–${String(e.total.max)} model calls (assuming ${String(e.childCount)} child task(s); panels dominate)`,
    ...e.assumptions.map((a) => `    • ${a}`),
  ].join('\n');
}
