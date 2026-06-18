/**
 * Tests for `kernloop doctor` (spec §7): overlay validation with real
 * failure modes — missing overlay, malformed YAML, schema violations
 * (bad K, bad vote panel, non-positive budgets), tampered audit chain,
 * corrupt memory database.
 */
import { appendFileSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { doctor, type DoctorResult } from './doctor.js';
import { initOverlay } from './overlay.js';
import { createKernloop } from './kernel.js';

const dirs: string[] = [];
function repoDir(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-doctor-'));
  dirs.push(repo);
  return repo;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Init a repo, replace overlay.yaml with `yaml`, and run doctor. */
function doctorOn(yaml: string): DoctorResult {
  const repo = repoDir();
  initOverlay(repo);
  writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), yaml);
  return doctor(path.join(repo, '.kernloop'));
}

function check(result: DoctorResult, name: string): { ok: boolean; detail: string } {
  const found = result.checks.find((c) => c.name === name);
  if (found === undefined) throw new Error(`no check named "${name}"`);
  return found;
}

describe('doctor', () => {
  it('fails with guidance when the overlay directory does not exist', () => {
    const result = doctor(path.join(repoDir(), '.kernloop'));
    expect(result.ok).toBe(false);
    expect(result.checks[0]?.detail).toContain('kernloop init');
  });

  it('passes all eight checks on a freshly initialized and used overlay', () => {
    const repo = repoDir();
    initOverlay(repo);
    const kern = createKernloop({ overlayDir: path.join(repo, '.kernloop') });
    kern.close();
    const result = doctor(path.join(repo, '.kernloop'));
    expect(result.ok).toBe(true);
    expect(result.checks.map((c) => c.name)).toEqual([
      'overlay dir',
      'overlay.yaml',
      'K bound',
      'vote panel',
      'budgets',
      'loop call estimate',
      'audit chain',
      'memory.sqlite',
    ]);
    expect(result.checks.every((c) => c.ok)).toBe(true);
    // The pre-flight estimate is informational (#303): a call-count band + its
    // stated assumptions, and NEVER a fabricated dollar figure.
    const estimate = check(result, 'loop call estimate');
    expect(estimate.detail).toContain('model calls');
    expect(estimate.detail).toContain('decompose decides this at runtime');
    expect(estimate.detail).toMatch(/no \$ shown/);
  });

  it('fails the overlay.yaml check when the file is missing from an existing overlay dir', () => {
    const repo = repoDir();
    initOverlay(repo);
    unlinkSync(path.join(repo, '.kernloop', 'overlay.yaml'));
    const result = doctor(path.join(repo, '.kernloop'));
    expect(result.ok).toBe(false);
    expect(check(result, 'overlay.yaml')).toMatchObject({ ok: false });
    expect(check(result, 'overlay.yaml').detail).toContain('kernloop init');
  });

  it('fails only the overlay.yaml check on malformed YAML — knob checks need a document', () => {
    const result = doctorOn('id: [unclosed\n');
    expect(result.ok).toBe(false);
    expect(check(result, 'overlay.yaml').detail).toContain('not valid YAML');
    expect(result.checks.map((c) => c.name)).toEqual([
      'overlay dir',
      'overlay.yaml',
      'audit chain',
      'memory.sqlite',
    ]);
  });

  it('surfaces the zod issues when overlay.yaml violates the schema', () => {
    const result = doctorOn('id: x\npriors: priors.yaml\n');
    expect(result.ok).toBe(false);
    expect(check(result, 'overlay.yaml').detail).toContain('priors');
    // The knob checks still pass — the violation is the unknown key, not a knob.
    expect(check(result, 'K bound').ok).toBe(true);
    expect(check(result, 'vote panel').ok).toBe(true);
    expect(check(result, 'budgets').ok).toBe(true);
  });

  it('fails the K bound check on K = 0 with a targeted message', () => {
    const result = doctorOn('id: x\nK: 0\n');
    expect(result.ok).toBe(false);
    expect(check(result, 'K bound')).toMatchObject({ ok: false });
    expect(check(result, 'K bound').detail).toContain('integer ≥ 1');
  });

  it('fails the K bound check on a non-integer K', () => {
    expect(check(doctorOn('id: x\nK: 2.5\n'), 'K bound').ok).toBe(false);
    expect(check(doctorOn('id: x\nK: three\n'), 'K bound').ok).toBe(false);
  });

  it('reports the default K when the file omits it', () => {
    const result = doctorOn('id: x\n');
    expect(check(result, 'K bound')).toMatchObject({ ok: true });
    expect(check(result, 'K bound').detail).toContain('default');
  });

  it('fails the vote panel check on panel = 5 with a targeted message', () => {
    const result = doctorOn('id: x\ngates:\n  vote:\n    panel: 5\n');
    expect(result.ok).toBe(false);
    expect(check(result, 'vote panel')).toMatchObject({ ok: false });
    expect(check(result, 'vote panel').detail).toContain('3 or 7');
  });

  it('passes the vote panel check on the 7-voter ratification panel', () => {
    const result = doctorOn('id: x\ngates:\n  vote:\n    panel: 7\n');
    expect(check(result, 'vote panel')).toMatchObject({ ok: true, detail: 'panel = 7' });
  });

  it('fails the budgets check on non-positive or non-numeric budgets', () => {
    const result = doctorOn('id: x\nbudgets:\n  tokens: 0\n  usd: free\n');
    expect(result.ok).toBe(false);
    expect(check(result, 'budgets').ok).toBe(false);
    expect(check(result, 'budgets').detail).toContain('tokens = 0');
    expect(check(result, 'budgets').detail).toContain('usd = "free"');
  });

  it('flags a tampered audit chain', () => {
    const repo = repoDir();
    initOverlay(repo);
    const kern = createKernloop({ overlayDir: path.join(repo, '.kernloop') });
    kern.close();
    appendFileSync(path.join(repo, '.kernloop', 'audit.jsonl'), 'garbage line\n');
    const result = doctor(path.join(repo, '.kernloop'));
    expect(result.ok).toBe(false);
    expect(check(result, 'audit chain').detail).toContain('malformed_line');
  });

  it('flags a corrupt memory database', () => {
    const repo = repoDir();
    initOverlay(repo);
    writeFileSync(path.join(repo, '.kernloop', 'memory.sqlite'), 'this is not a database');
    const result = doctor(path.join(repo, '.kernloop'));
    expect(result.ok).toBe(false);
    expect(check(result, 'memory.sqlite').ok).toBe(false);
  });
});
