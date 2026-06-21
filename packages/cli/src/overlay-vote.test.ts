/**
 * Vote-gate overlay flag parsing (split from overlay.test.ts for line budget).
 * The vote gate's opt-in knobs — escalateOnNoConsensus (#192), precisionWeighted
 * (#369 Inc3), correlationAware/correlationForm (#369 Inc4) — parse with their
 * defaults and accept overrides.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OVERLAY_DIR_NAME, initOverlay, loadOverlay } from './overlay.js';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-overlay-vote-'));
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

describe('vote-gate overlay flags', () => {
  it('vote correlationAware defaults off with sqrt form, and parses an opt-in (#369 Inc4, CLM-0167)', () => {
    const def = loadFrom('id: x\n').gates.vote;
    expect(def.correlationAware).toBe(false);
    expect(def.correlationForm).toBe('sqrt');
    const on = loadFrom(
      'id: x\ngates:\n  vote:\n    correlationAware: true\n    correlationForm: linear\n',
    ).gates.vote;
    expect(on.correlationAware).toBe(true);
    expect(on.correlationForm).toBe('linear');
  });
});
