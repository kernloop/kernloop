/**
 * Tests for `kernloop doctor` (spec §7): overlay validation with real
 * failure modes — missing overlay, invalid config, tampered audit chain,
 * corrupt memory database.
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { doctor } from './doctor.js';
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

describe('doctor', () => {
  it('fails with guidance when the overlay directory does not exist', () => {
    const result = doctor(path.join(repoDir(), '.kernloop'));
    expect(result.ok).toBe(false);
    expect(result.checks[0]?.detail).toContain('kernloop init');
  });

  it('passes on a freshly initialized and used overlay', () => {
    const repo = repoDir();
    initOverlay(repo);
    const kern = createKernloop({ overlayDir: path.join(repo, '.kernloop') });
    kern.close();
    const result = doctor(path.join(repo, '.kernloop'));
    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(4);
    expect(result.checks.map((c) => c.ok)).toEqual([true, true, true, true]);
  });

  it('flags an invalid overlay.yaml', () => {
    const repo = repoDir();
    initOverlay(repo);
    writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), 'id: ""\n');
    const result = doctor(path.join(repo, '.kernloop'));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === 'overlay.yaml')?.ok).toBe(false);
  });

  it('flags a tampered audit chain', () => {
    const repo = repoDir();
    initOverlay(repo);
    const kern = createKernloop({ overlayDir: path.join(repo, '.kernloop') });
    kern.close();
    appendFileSync(path.join(repo, '.kernloop', 'audit.jsonl'), 'garbage line\n');
    const result = doctor(path.join(repo, '.kernloop'));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === 'audit chain')?.detail).toContain('malformed_line');
  });

  it('flags a corrupt memory database', () => {
    const repo = repoDir();
    initOverlay(repo);
    writeFileSync(path.join(repo, '.kernloop', 'memory.sqlite'), 'this is not a database');
    const result = doctor(path.join(repo, '.kernloop'));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === 'memory.sqlite')?.ok).toBe(false);
  });
});
