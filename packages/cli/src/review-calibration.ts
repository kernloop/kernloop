/**
 * Review-gate enforce-promotion evidence (#350, a #328 increment). #328 Inc2 promotes
 * the review gate advisory→enforce when an overlay declares `gates.review.ratifiedEnforce`,
 * but only ATTESTS the ratifier checked the PROMOTION_CRITERION (precision ≥ 0.8 over n=50).
 * This module makes the composition root VERIFY that criterion against a committed,
 * eval-set-bound calibration artifact before granting enforce — refusing (staying advisory,
 * audited) an under-evidenced or stale promotion. It does NOT measure precision (the kernel
 * holds no intelligence, rule 4): the model-driven calibration runs out-of-band (the
 * `calibrate` command) and writes the artifact; assembly only checks the committed numbers
 * meet the threshold AND were measured against the CURRENT eval-set. [CLM-0183]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PROMOTION_CRITERION, REVIEW_EVAL_SET } from '@kernloop/faculty-gates';
import type { EvidenceThreshold } from '@kernloop/contracts';

/** The committed artifact filename, read from the overlay directory. */
export const REVIEW_CALIBRATION_FILE = 'review-calibration.json';

/**
 * A committed review-gate calibration measurement — the EVIDENCE the enforce promotion
 * is verified against (#350). `value`/`n` are the measured precision and sample count;
 * `evalSetHash` binds the measurement to the eval-set version it ran over (a grown or
 * changed set invalidates a stale artifact); `adapter` records the reviewer the precision
 * was measured against (provenance — the review adapter is a per-run choice, so this is
 * recorded, not re-checked at assembly); `source` is provenance-tagged like a ratification ref.
 */
export const ReviewCalibrationSchema = z.strictObject({
  metric: z.literal('precision'),
  value: z.number().min(0).max(1),
  n: z.number().int().min(0),
  evalSetHash: z.string().min(1),
  adapter: z.string().min(1),
  generatedAt: z.string().min(1),
  source: z.string().regex(/^[a-z][a-z_]*:.+$/, 'source must be a provenance-tagged ref'),
});
export type ReviewCalibration = z.infer<typeof ReviewCalibrationSchema>;

/**
 * A stable fingerprint of the review eval-set the criterion is measured over. Binding an
 * artifact to this hash means a later change to the eval-set (e.g. growing it past n=50)
 * invalidates a stale measurement rather than letting it silently keep granting enforce.
 */
export function reviewEvalSetHash(): string {
  return createHash('sha256').update(JSON.stringify(REVIEW_EVAL_SET)).digest('hex').slice(0, 16);
}

/** Build a calibration artifact from a measured precision + sample size + provenance. */
export function buildReviewCalibration(
  measured: { readonly precision: number; readonly n: number },
  meta: { readonly adapter: string; readonly generatedAt: string; readonly source: string },
): ReviewCalibration {
  return ReviewCalibrationSchema.parse({
    metric: 'precision',
    value: measured.precision,
    n: measured.n,
    evalSetHash: reviewEvalSetHash(),
    adapter: meta.adapter,
    generatedAt: meta.generatedAt,
    source: meta.source,
  });
}

/** Write the artifact into the overlay directory (the `calibrate` command's sink). */
export function writeReviewCalibration(overlayDir: string, artifact: ReviewCalibration): string {
  const file = path.join(overlayDir, REVIEW_CALIBRATION_FILE);
  writeFileSync(file, JSON.stringify(artifact, null, 2) + '\n');
  return file;
}

/** The outcome of verifying a declared enforce promotion against its committed evidence. */
export type PromotionEvidence =
  | { readonly ok: true; readonly artifact: ReviewCalibration }
  | { readonly ok: false; readonly reason: string };

/**
 * Verify a review-gate enforce promotion against its committed calibration artifact (#350).
 * Refuses (ok:false + reason) when the artifact is absent, malformed, measured over a
 * different eval-set (stale), below the precision threshold, or under the sample-size
 * window — so enforce is NEVER granted on unverified or stale evidence. PURE except the
 * single fixed-path read inside the overlay dir; never throws.
 */
export function verifyReviewPromotion(
  overlayDir: string,
  criterion: EvidenceThreshold = PROMOTION_CRITERION,
): PromotionEvidence {
  let raw: string;
  try {
    raw = readFileSync(path.join(overlayDir, REVIEW_CALIBRATION_FILE), 'utf8');
  } catch {
    return {
      ok: false,
      reason: `no ${REVIEW_CALIBRATION_FILE} in the overlay — run \`kernloop calibrate\``,
    };
  }
  const parsed = ReviewCalibrationSchema.safeParse(parseJson(raw));
  if (!parsed.success) return { ok: false, reason: `malformed ${REVIEW_CALIBRATION_FILE}` };
  const a = parsed.data;
  if (a.evalSetHash !== reviewEvalSetHash()) {
    return {
      ok: false,
      reason: 'calibration is stale — measured over a different review eval-set',
    };
  }
  if (a.metric !== criterion.metric) {
    return {
      ok: false,
      reason: `calibration metric "${a.metric}" ≠ criterion "${criterion.metric}"`,
    };
  }
  if (a.value < criterion.threshold) {
    return { ok: false, reason: `precision ${a.value} < required ${criterion.threshold}` };
  }
  if (a.n < criterion.windowN) {
    return { ok: false, reason: `n=${a.n} < required window ${criterion.windowN}` };
  }
  return { ok: true, artifact: a };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
