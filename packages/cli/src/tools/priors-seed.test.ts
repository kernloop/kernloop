/**
 * Unit tests for the priors loader (CLM-0126): Laplace smoothing, the
 * degrade-to-neutral contract (absent / oversized / malformed / schema-invalid
 * / older-file-missing-invocations), and the provenance fields (sha256, ageMs).
 * The INFLUENCE on routing is proven separately in priors-seed-influence.test.ts.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { MAX_PRIORS_BYTES, laplaceScore, loadSeedPriors } from './priors-seed.js';

const dirs: string[] = [];
function tmpFile(name = 'priors.yaml'): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-priors-seed-'));
  dirs.push(dir);
  return path.join(dir, name);
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writePriors(file: string, priors: unknown[]): void {
  writeFileSync(file, YAML.stringify({ version: '1', priors }), 'utf8');
}

describe('laplaceScore (CLM-0126)', () => {
  it('a thin 1-invocation/100% sample does NOT outrank a deep 50-invocation/90% one', () => {
    const thin = laplaceScore(1.0, 1); // (1+1)/(1+2) = 0.6667
    const deep = laplaceScore(0.9, 50); // (45+1)/(50+2) = 0.8846
    expect(thin).toBeCloseTo(0.6667, 4);
    expect(deep).toBeCloseTo(0.8846, 4);
    expect(deep).toBeGreaterThan(thin); // the load-bearing assertion
  });

  it('a 0-invocation subject degrades to the neutral 0.5', () => {
    expect(laplaceScore(0, 0)).toBe(0.5);
    expect(laplaceScore(1, 0)).toBe(0.5);
  });
});

describe('loadSeedPriors (CLM-0126)', () => {
  it('a valid file → a correct Laplace-smoothed Map plus populated sha256 and ageMs', () => {
    const file = tmpFile();
    writePriors(file, [
      { subject: 'foo@1.0', invocations: 1, successRate: 1.0, lastUsedAt: 1000 },
      { subject: 'bar@1.0', invocations: 50, successRate: 0.9, lastUsedAt: 5000 },
    ]);
    const result = loadSeedPriors(file, () => 5000 + 86_400_000); // 1 day after newest
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a result');
    expect(result.map.get('foo@1.0')).toBeCloseTo(0.6667, 4);
    expect(result.map.get('bar@1.0')).toBeCloseTo(0.8846, 4);
    expect(result.count).toBe(2);
    // sha256 is the hex digest of the raw file bytes (provenance).
    const expectedSha = createHash('sha256').update(readFileSync(file, 'utf8')).digest('hex');
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sha256).toBe(expectedSha);
    expect(result.ageMs).toBe(86_400_000); // now − max(lastUsedAt)
    expect(result.scores).toContainEqual({
      subject: 'bar@1.0',
      score: result.map.get('bar@1.0'),
      invocations: 50,
    });
  });

  it('an ABSENT file → null (byte-identical neutral behavior), no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = loadSeedPriors(path.join(tmpFile(), 'does-not-exist.yaml'));
    expect(result).toBeNull();
    expect(warn).not.toHaveBeenCalled(); // absent is the expected case, not a warning
  });

  it('an OVERSIZED file → null + a warning, never a throw', () => {
    const file = tmpFile();
    const huge = 'subject: x\n'.repeat(MAX_PRIORS_BYTES / 5);
    writeFileSync(file, huge, 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => loadSeedPriors(file)).not.toThrow();
    expect(loadSeedPriors(file)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('a MALFORMED file (bad YAML) → null + a warning, never a throw', () => {
    const file = tmpFile();
    writeFileSync(file, 'priors: [ unbalanced', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => loadSeedPriors(file)).not.toThrow();
    expect(loadSeedPriors(file)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('a schema-INVALID file (successRate out of range) → null, never a throw', () => {
    const file = tmpFile();
    writePriors(file, [{ subject: 'x', invocations: 1, successRate: 2, lastUsedAt: 1 }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadSeedPriors(file)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('an OLDER file MISSING invocations → degrades that subject to 0 (treats as low-confidence), no crash', () => {
    const file = tmpFile();
    // Pre-invocations export shape: {subject, successRate, lastUsedAt} only.
    writePriors(file, [{ subject: 'legacy@1.0', successRate: 1.0, lastUsedAt: 2000 }]);
    const result = loadSeedPriors(file, () => 2000);
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a result');
    // invocations treated as 0 → Laplace over 0 → neutral 0.5, never NaN/crash.
    expect(result.map.get('legacy@1.0')).toBe(0.5);
    expect(result.scores[0]?.invocations).toBe(0);
  });

  it('a SAFE-mode parse refuses a custom YAML tag rather than executing it', () => {
    const file = tmpFile();
    // A custom tag must not be honored; SAFE-mode parse drops/rejects it and the
    // result degrades to neutral rather than constructing an exotic value.
    writeFileSync(file, 'version: "1"\npriors: !!js/function "function(){}"\n', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => loadSeedPriors(file)).not.toThrow();
    expect(loadSeedPriors(file)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
