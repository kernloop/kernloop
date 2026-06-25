/**
 * The `kernloop calibrate` command (#350) [CLM-0183]: drives the default reviewer panel over
 * the labeled eval-set via an injected (hermetic) reviewer invoke, computes precision, and
 * writes the eval-set-bound calibration artifact the enforce promotion is verified against.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernloop, type Kernloop } from './kernel.js';
import { calibrateReview } from './calibrate-command.js';
import { reviewEvalSetHash, verifyReviewPromotion } from './review-calibration.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function freshKern(): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-calib-cmd-'));
  dirs.push(repo);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}

describe('calibrateReview (#350)', () => {
  it('runs the panel over the eval-set and writes an eval-set-bound artifact with provenance', async () => {
    const kern = freshKern();
    // A reviewer that finds nothing → no scored findings → vacuous precision 1
    // ("silence makes no false claims"). Deterministic, no model calls.
    const cleanReview = JSON.stringify({ findings: [], summary: 'clean' });
    const { artifact, file } = await calibrateReview(kern, {
      adapter: 'codex',
      source: 'calibrate:test',
      invoke: () => Promise.resolve({ output: cleanReview, cost: { tokens: 0, usd: 0 } }),
      now: () => new Date('2026-06-25T00:00:00.000Z'),
    });

    expect(artifact.metric).toBe('precision');
    expect(artifact.value).toBe(1); // vacuous: the panel scored nothing
    expect(artifact.n).toBe(10); // the current REVIEW_EVAL_SET size (< windowN=50, honest, #478)
    expect(artifact.adapter).toBe('codex');
    expect(artifact.evalSetHash).toBe(reviewEvalSetHash()); // bound to the eval-set version
    expect(artifact.generatedAt).toBe('2026-06-25T00:00:00.000Z');
    expect(file.endsWith('review-calibration.json')).toBe(true);

    // The written artifact loads + verifies as PRESENT, but is REFUSED on n<50 — the
    // mechanism is correct even though kernloop's own gate is not yet promotable.
    const evidence = verifyReviewPromotion(kern.paths.dir);
    expect(evidence.ok).toBe(false);
    if (!evidence.ok) expect(evidence.reason).toContain('window');
    kern.close();
  });
});
