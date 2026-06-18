/**
 * Overlay LOAD-REJECTION matrix — split out of overlay.test.ts (#291) to keep
 * that file under the 400-line ceiling. Every malformed overlay.yaml must fail
 * fast with a typed OverlayError (unparseable YAML → no zod issues; schema
 * violations → the zod issues). Uncited by claims — pure defensive coverage.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OVERLAY_DIR_NAME, OverlayError, initOverlay, loadOverlay } from './overlay.js';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-overlay-rej-'));
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

describe('loadOverlay rejection matrix', () => {
  it('rejects unparseable YAML with a typed OverlayError carrying no zod issues', () => {
    const repo = tmp();
    initOverlay(repo);
    writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), 'id: [unclosed\n');
    let caught: unknown;
    try {
      loadOverlay(path.join(repo, OVERLAY_DIR_NAME));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OverlayError);
    expect((caught as OverlayError).issues).toHaveLength(0);
  });

  it.each([
    ['empty id', 'id: ""\n'],
    ['K below 1', 'id: x\nK: 0\n'],
    ['fractional K', 'id: x\nK: 2.5\n'],
    ['non-numeric K', 'id: x\nK: three\n'],
    ['vote panel outside {3,7}', 'id: x\ngates:\n  vote:\n    panel: 5\n'],
    ['unknown vote strategy', 'id: x\ngates:\n  vote:\n    strategy: plurality\n'],
    ['zero token budget', 'id: x\nbudgets:\n  tokens: 0\n'],
    ['negative usd budget', 'id: x\nbudgets:\n  usd: -1\n'],
    ['zero briefTokens', 'id: x\nbriefTokens: 0\n'],
    ['non-positive quality timeout', 'id: x\ngates:\n  quality:\n    timeoutMsPerCheck: 0\n'],
    ['unknown top-level key (P3 priors)', 'id: x\npriors: priors.yaml\n'],
    ['unknown key inside gates.vote', 'id: x\ngates:\n  vote:\n    quorum: 2\n'],
    ['empty node override (hides intent)', 'id: x\nnodeOverrides:\n  review: {}\n'],
    ['skip in a node override', 'id: x\nnodeOverrides:\n  review: { skip: true }\n'],
    ['empty gate name in an override', 'id: x\nnodeOverrides:\n  review: { gate: "" }\n'],
    ['unknown adapter name in a tier', 'id: x\nadapters:\n  medium: gpt5\n'],
    ['unknown tier key inside adapters', 'id: x\nadapters:\n  cheap: claude\n'],
    ['unknown model tier in a node override', 'id: x\nnodeOverrides:\n  research: { tier: huge }\n'],
    ['unknown effort in a node override', 'id: x\nnodeOverrides:\n  research: { effort: max-plus }\n'],
  ])('rejects %s with a typed OverlayError carrying the zod issues', (_name, yaml) => {
    let caught: unknown;
    try {
      loadFrom(yaml);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OverlayError);
    expect((caught as OverlayError).issues.length).toBeGreaterThan(0);
    expect((caught as OverlayError).message).toContain('overlay.yaml is invalid');
  });
});
