/**
 * `run --estimate` (#305, CLM-0138): a per-invocation pre-flight model-call-count estimate
 * for THIS overlay's loop shape, printed without running. Proves the estimate reflects the
 * overlay's K/Kc/panel/parsimony config (not a fixed default).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernloop, type Kernloop } from './kernel.js';
import { runEstimate } from './run-command.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function kernFor(overlayYaml?: string): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-run-estimate-'));
  dirs.push(repo);
  const overlayDir = path.join(repo, '.kernloop');
  mkdirSync(overlayDir, { recursive: true });
  if (overlayYaml !== undefined) writeFileSync(path.join(overlayDir, 'overlay.yaml'), overlayYaml);
  return createKernloop({ overlayDir, rng: () => 0.99 });
}

describe('runEstimate (#305)', () => {
  it('returns a per-node + total call band for the default overlay, with stated assumptions, no $', () => {
    const kern = kernFor();
    const { kind, estimate } = runEstimate(kern);
    expect(kind).toBe('estimate');
    expect(estimate.childCount).toBe(3); // decompose decides at runtime; assumed input
    expect(estimate.total.min).toBeGreaterThan(0);
    expect(estimate.total.max).toBeGreaterThanOrEqual(estimate.total.min);
    expect(estimate.perNode.quality).toEqual({ min: 0, max: 0 }); // mechanical, no model call
    expect(estimate.perNode.vote.min).toBe(3); // default panel 3 × first-pass plan(1)
    // Honest: never a $ figure — assumptions say cost is metered at runtime.
    expect(estimate.assumptions.join(' ')).toContain('no $ shown');
    kern.close();
  });

  it('reflects the overlay vote panel: panel 7 yields a larger vote band than the default 3', () => {
    const def = runEstimate(kernFor()).estimate.perNode.vote.min;
    const big = runEstimate(kernFor('id: x\ngates:\n  vote:\n    panel: 7\n')).estimate.perNode.vote
      .min;
    expect(def).toBe(3);
    expect(big).toBe(7);
  });

  it('reflects parsimony intensity: `off` zeroes the parsimony band, default `full` does not', () => {
    const full = runEstimate(kernFor()).estimate.perNode.parsimony;
    const off = runEstimate(kernFor('id: x\ngates:\n  parsimony:\n    intensity: off\n')).estimate
      .perNode.parsimony;
    expect(full.min).toBeGreaterThan(0);
    expect(off).toEqual({ min: 0, max: 0 });
  });
});
