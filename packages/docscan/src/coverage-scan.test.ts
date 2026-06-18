/**
 * Diff-coverage anti-rubber-stamp scanner (#226 item 2, CLM-0134). Per-branch
 * fixtures: an untested written module → error, uncovered statements → warn, a
 * fully-covered file → nothing, no report → fail-closed error. PLUS the review must-fix —
 * a `.d.ts`, a test file, and a pure type/re-export module are NEVER errored
 * (legitimately absent from coverage), gated by hasExecutableCode.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasExecutableCode, scanWrittenCoverage, type WrittenFile } from './coverage-scan.js';

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Write a coverage-final.json into a fresh workspace; entries keyed by absolute path. */
function workspaceWithCoverage(
  report: Record<string, { s: Record<string, number> }> | null,
): string {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-cov-'));
  if (report !== null) {
    mkdirSync(join(dir, 'coverage'), { recursive: true });
    const keyed = Object.fromEntries(
      Object.entries(report).map(([rel, v]) => [
        resolve(dir, rel),
        { path: resolve(dir, rel), ...v },
      ]),
    );
    writeFileSync(join(dir, 'coverage', 'coverage-final.json'), JSON.stringify(keyed));
  }
  return dir;
}

const fn = (name: string): WrittenFile => ({
  path: name,
  content: `export function f() {\n  return 1;\n}\n`,
});

describe('hasExecutableCode (#226 item 2 must-fix)', () => {
  it('is true for a function / value, false for a pure type / interface / re-export', () => {
    expect(hasExecutableCode('export function f() { return 1; }')).toBe(true);
    expect(hasExecutableCode('export const x = 1;')).toBe(true);
    expect(hasExecutableCode('export interface I { x: number }')).toBe(false);
    expect(hasExecutableCode("import { A } from './a';\nexport type T = A;")).toBe(false);
    expect(hasExecutableCode("export { a } from './b';")).toBe(false);
  });
});

describe('scanWrittenCoverage — branches (#226 item 2)', () => {
  it('errors on an executable written module ABSENT from the coverage report', () => {
    const ws = workspaceWithCoverage({ 'src/other.ts': { s: { '0': 1 } } });
    const out = scanWrittenCoverage([fn('src/new.ts')], ws);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.message).toContain('untested module');
    expect(out[0]?.path).toBe('src/new.ts');
  });

  it('warns on uncovered statements in a written file that IS in the report', () => {
    const ws = workspaceWithCoverage({ 'src/new.ts': { s: { '0': 1, '1': 0, '2': 0 } } });
    const out = scanWrittenCoverage([fn('src/new.ts')], ws);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warn');
    expect(out[0]?.message).toContain('2 uncovered statement');
  });

  it('emits NOTHING for a fully-covered written file', () => {
    const ws = workspaceWithCoverage({ 'src/new.ts': { s: { '0': 1, '1': 3 } } });
    expect(scanWrittenCoverage([fn('src/new.ts')], ws)).toEqual([]);
  });

  it('FAILS CLOSED with an error when opted-in but no coverage report exists (#283 review)', () => {
    const ws = workspaceWithCoverage(null);
    const out = scanWrittenCoverage([fn('src/new.ts')], ws);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('error'); // a graceful pass would let the reporter be disabled to bypass
    expect(out[0]?.message).toContain('no coverage report');
  });

  it('NEVER errors on a .d.ts, a test file, or a pure type module (the review must-fix)', () => {
    const ws = workspaceWithCoverage({ 'src/other.ts': { s: { '0': 1 } } });
    const written: WrittenFile[] = [
      { path: 'src/types.d.ts', content: 'export interface I { x: number }' },
      { path: 'src/new.test.ts', content: 'export function t() { return 1; }' },
      { path: 'src/model.ts', content: "import { A } from './a';\nexport type T = A;" },
      { path: 'README.md', content: '# not source' },
    ];
    expect(scanWrittenCoverage(written, ws)).toEqual([]); // all skipped — none absent-errored
  });

  it('matches a coverage key by path SUFFIX (sandbox-relocated absolute paths)', () => {
    dir = mkdtempSync(join(tmpdir(), 'kernloop-cov-'));
    mkdirSync(join(dir, 'coverage'), { recursive: true });
    // The report was produced in a container: keys are /work/... not the host dir.
    writeFileSync(
      join(dir, 'coverage', 'coverage-final.json'),
      JSON.stringify({ '/work/src/new.ts': { path: '/work/src/new.ts', s: { '0': 0 } } }),
    );
    const out = scanWrittenCoverage([fn('src/new.ts')], dir);
    expect(out[0]?.severity).toBe('warn'); // matched by suffix, NOT errored as absent
  });
});
