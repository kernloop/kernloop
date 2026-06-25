/**
 * Review-gate enforce-promotion evidence verification (#350, a #328 increment) [CLM-0183]:
 * the composition root grants enforce ONLY when a committed calibration artifact proves the
 * gate met its PROMOTION_CRITERION (precision ≥ 0.8 over n ≥ 50) AND was measured over the
 * CURRENT eval-set. A missing / malformed / stale / under-threshold / under-window artifact is
 * REFUSED — enforce is never granted on unverified or stale evidence.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REVIEW_CALIBRATION_FILE,
  buildReviewCalibration,
  reviewEvalSetHash,
  verifyReviewPromotion,
} from './review-calibration.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function scratch(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'kernloop-calib-'));
  dirs.push(d);
  return d;
}
/** Write a raw artifact object into the overlay dir and return the dir. */
function withArtifact(obj: unknown): string {
  const d = scratch();
  writeFileSync(path.join(d, REVIEW_CALIBRATION_FILE), JSON.stringify(obj));
  return d;
}
/** A passing artifact: precision ≥ 0.8, n ≥ 50, current eval-set hash. */
const passing = () => ({
  metric: 'precision',
  value: 0.9,
  n: 50,
  evalSetHash: reviewEvalSetHash(),
  adapter: 'claude',
  generatedAt: '2026-06-25T00:00:00.000Z',
  source: 'calibrate:claude',
});

describe('verifyReviewPromotion (#350)', () => {
  it('PASSES a committed artifact that meets the criterion and matches the eval-set', () => {
    const result = verifyReviewPromotion(withArtifact(passing()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.artifact.value).toBe(0.9);
  });

  it('REFUSES when no artifact is committed (the common fresh-overlay case)', () => {
    const result = verifyReviewPromotion(scratch());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no review-calibration.json');
  });

  it('REFUSES a malformed artifact', () => {
    const d = scratch();
    writeFileSync(path.join(d, REVIEW_CALIBRATION_FILE), '{ not valid json');
    const result = verifyReviewPromotion(d);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('malformed');
  });

  it('REFUSES a STALE artifact measured over a different eval-set (hash mismatch)', () => {
    const result = verifyReviewPromotion(
      withArtifact({ ...passing(), evalSetHash: 'deadbeefdeadbeef' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('stale');
  });

  it('REFUSES below the precision threshold (0.7 < 0.8)', () => {
    const result = verifyReviewPromotion(withArtifact({ ...passing(), value: 0.7 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('precision');
  });

  it('REFUSES below the sample window (n=10 < 50) — the honest state today (#478)', () => {
    const result = verifyReviewPromotion(withArtifact({ ...passing(), n: 10 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('window');
  });
});

describe('buildReviewCalibration (#350)', () => {
  it('binds the measurement to the current eval-set hash and carries provenance', () => {
    const artifact = buildReviewCalibration(
      { precision: 0.85, n: 50 },
      { adapter: 'codex', generatedAt: '2026-06-25T00:00:00.000Z', source: 'calibrate:codex' },
    );
    expect(artifact.value).toBe(0.85);
    expect(artifact.n).toBe(50);
    expect(artifact.evalSetHash).toBe(reviewEvalSetHash());
    expect(artifact.adapter).toBe('codex');
    // A built artifact round-trips through the verifier (hash matches) at/above the bar.
    const d = withArtifact(artifact);
    expect(verifyReviewPromotion(d).ok).toBe(true);
  });
});
