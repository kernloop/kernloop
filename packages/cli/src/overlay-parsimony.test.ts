/**
 * Parsimony-gate overlay flag parsing (#9/#415, CLM-0177). The intensity dial
 * (off|lite|full|ultra) defaults to FULL — deliberately NOT byte-identical to the
 * pre-#9 advisory past (user-ratified enforce-by-default) — and `escalateOnRefute`
 * defaults false. Overrides parse; an unknown intensity is rejected at the boundary.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OVERLAY_DIR_NAME, initOverlay, loadOverlay } from './overlay.js';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-overlay-parsimony-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Init a repo, overwrite overlay.yaml with `yaml`, and load it. */
function loadFrom(yaml: string): ReturnType<typeof loadOverlay> {
  const repo = tmp();
  initOverlay(repo);
  writeFileSync(path.join(repo, OVERLAY_DIR_NAME, 'overlay.yaml'), yaml);
  return loadOverlay(path.join(repo, OVERLAY_DIR_NAME));
}

describe('parsimony-gate overlay flags [CLM-0177]', () => {
  it('defaults to { intensity: full, escalateOnRefute: false } when no block is set', () => {
    const def = loadFrom('id: x\n').gates.parsimony;
    expect(def.intensity).toBe('full'); // DEFAULT FULL (user-ratified enforce-by-default)
    expect(def.escalateOnRefute).toBe(false);
  });

  it('parses each intensity override (off|lite|full|ultra)', () => {
    for (const intensity of ['off', 'lite', 'full', 'ultra'] as const) {
      const g = loadFrom(`id: x\ngates:\n  parsimony:\n    intensity: ${intensity}\n`).gates
        .parsimony;
      expect(g.intensity).toBe(intensity);
    }
  });

  it('parses escalateOnRefute: true', () => {
    const g = loadFrom('id: x\ngates:\n  parsimony:\n    escalateOnRefute: true\n').gates.parsimony;
    expect(g.escalateOnRefute).toBe(true);
    expect(g.intensity).toBe('full'); // unset intensity still defaults to full
  });

  it('rejects an unknown intensity at the boundary', () => {
    expect(() => loadFrom('id: x\ngates:\n  parsimony:\n    intensity: paranoid\n')).toThrow();
  });
});
