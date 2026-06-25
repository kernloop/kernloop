/**
 * The `kernloop calibrate` command (#350) — measures the review gate's precision over the
 * labeled eval-set and writes the committed calibration artifact the enforce promotion is
 * verified against ({@link verifyReviewPromotion}). This is the model-driven step that CANNOT
 * run at kernel assembly (rule 4); it runs the default reviewer panel over REVIEW_EVAL_SET via
 * the chosen adapter, computes aggregate precision, and records it bound to the eval-set hash +
 * the adapter it was measured against. Real precision needs reviewer model calls (adapter-gated);
 * the panel-evaluation + artifact write are hermetically testable with an injected invoke. [CLM-0183]
 */
import { evaluateReviewer, REVIEW_EVAL_SET, REVIEW_PANEL_DEFAULT } from '@kernloop/faculty-gates';
import type { Kernloop } from './kernel.js';
import type { LoopInvoke } from './loop/invoke.js';
import { resolveStandaloneInvoke } from './loop/standalone-invoke.js';
import { reviewerInvoker } from './loop/seams.js';
import {
  buildReviewCalibration,
  writeReviewCalibration,
  type ReviewCalibration,
} from './review-calibration.js';

/** Options for {@link calibrateReview}. `invoke`/`now` are test seams, never wire input. */
export interface CalibrateReviewOptions {
  /** Reviewer adapter (CLI name or registered endpoint id) the precision is measured against. */
  readonly adapter: string;
  /** Provenance-tagged ref recorded on the artifact (e.g. `calibrate:2026-06-25`). */
  readonly source: string;
  /** Injected reviewer invoke (test seam); defaults to the adapter's standalone invoke. */
  readonly invoke?: LoopInvoke;
  /** Clock seam for `generatedAt` (test determinism); defaults to wall-clock. */
  readonly now?: () => Date;
}

/**
 * Run the default reviewer panel over the labeled eval-set, compute the aggregate precision
 * (Σ matched / Σ scored across every reviewer × case — vacuously 1 when the panel scored
 * nothing), and write the artifact. `n` is the eval-set size (the review window); it is honestly
 * BELOW the promotion criterion's windowN until the eval-set grows (#478), so a real artifact
 * today does not yet satisfy a promotion.
 */
export async function calibrateReview(
  kern: Kernloop,
  opts: CalibrateReviewOptions,
): Promise<{ readonly artifact: ReviewCalibration; readonly file: string }> {
  const invoke = opts.invoke ?? resolveStandaloneInvoke(kern, opts.adapter);
  const invokeReviewer = reviewerInvoker({
    overlayDir: kern.paths.dir,
    runId: 'calibrate',
    invoke,
  });
  let scored = 0;
  let matched = 0;
  for (const reviewer of REVIEW_PANEL_DEFAULT) {
    const cal = await evaluateReviewer({ reviewer, cases: REVIEW_EVAL_SET, invokeReviewer });
    for (const c of cal.perCase) {
      scored += c.scored;
      matched += c.matched;
    }
  }
  const precision = scored === 0 ? 1 : matched / scored;
  const generatedAt = (opts.now ?? (() => new Date()))().toISOString();
  const artifact = buildReviewCalibration(
    { precision, n: REVIEW_EVAL_SET.length },
    { adapter: opts.adapter, generatedAt, source: opts.source },
  );
  const file = writeReviewCalibration(kern.paths.dir, artifact);
  return { artifact, file };
}
