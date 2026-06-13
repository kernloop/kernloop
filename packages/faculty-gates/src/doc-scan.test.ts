import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanDocComments } from './doc-scan.js';

/** A throwaway workspace seeded with the given files, cleaned up per test. */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'doc-scan-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

describe('scanDocComments — covered TS/JS', () => {
  it('a documented exported function produces no finding', () => {
    write(
      'src/a.ts',
      '/** Adds two numbers. */\nexport function add(a: number, b: number) {\n  return a + b;\n}\n',
    );
    expect(scanDocComments(dir)).toEqual([]);
  });

  it('an undocumented exported function is an error finding with file:line and path', () => {
    write('src/a.ts', 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
    const findings = scanDocComments(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('"add"');
    expect(findings[0]?.message).toContain('src/a.ts:1');
    expect(findings[0]?.path).toBe(path.join('src', 'a.ts'));
  });

  it('flags undocumented exported classes, interfaces, type aliases, enums, and consts', () => {
    write(
      'm.ts',
      [
        'export class C {}',
        'export interface I { x: number }',
        'export type T = string;',
        'export enum E { A }',
        'export const k = 1;',
      ].join('\n') + '\n',
    );
    const names = scanDocComments(dir).map((f) => f.message);
    expect(names.some((m) => m.includes('"C"'))).toBe(true);
    expect(names.some((m) => m.includes('"I"'))).toBe(true);
    expect(names.some((m) => m.includes('"T"'))).toBe(true);
    expect(names.some((m) => m.includes('"E"'))).toBe(true);
    expect(names.some((m) => m.includes('"k"'))).toBe(true);
    expect(scanDocComments(dir)).toHaveLength(5);
  });

  it('ignores NON-exported declarations (only the public surface is gated)', () => {
    write('src/a.ts', 'function helper() {}\nconst secret = 2;\n');
    expect(scanDocComments(dir)).toEqual([]);
  });

  it('treats an empty/whitespace-only doc-comment as undocumented', () => {
    write('src/a.ts', '/**  */\nexport function add() {}\n');
    expect(scanDocComments(dir)).toHaveLength(1);
  });

  it('treats a /***/ (and /****/) empty doc shell as undocumented', () => {
    write('a.ts', '/***/\nexport function f() {}\n');
    write('b.ts', '/****/\nexport function g() {}\n');
    const findings = scanDocComments(dir);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
  });

  it('honors a leading // line comment as a doc-comment', () => {
    write('src/a.ts', '// Adds.\nexport function add() {}\n');
    expect(scanDocComments(dir)).toEqual([]);
  });

  it('does NOT flag re-exports (they declare nothing in this file)', () => {
    write('src/a.ts', "export { foo } from './other.js';\nexport * from './all.js';\n");
    expect(scanDocComments(dir)).toEqual([]);
  });

  it('scans .js/.jsx/.mts files too', () => {
    write('a.js', 'export function f() {}\n');
    write('b.mts', 'export const g = 1;\n');
    expect(scanDocComments(dir)).toHaveLength(2);
  });
});

describe('scanDocComments — directory walk', () => {
  it('recurses into subdirectories but skips node_modules and dist', () => {
    write('src/deep/nested/x.ts', 'export function deep() {}\n');
    write('node_modules/pkg/index.ts', 'export function vendored() {}\n');
    write('dist/built.ts', 'export function built() {}\n');
    const findings = scanDocComments(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"deep"');
  });

  it('returns no findings for a directory that does not exist', () => {
    expect(scanDocComments(path.join(dir, 'missing'))).toEqual([]);
  });
});

describe('scanDocComments — resource bounds (untrusted input)', () => {
  it('records and skips a file over the per-file byte limit, never parsing it', () => {
    // > 1 MB: an undocumented export buried under a huge comment. If the file
    // were parsed it would be an `error`; the bound makes it a skipped `info`.
    write('big.ts', `export function big() {}\n// ${'a'.repeat(1_000_001)}\n`);
    const findings = scanDocComments(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.message).toContain('skipped');
    expect(findings[0]?.message).toContain('per-file doc-scan limit');
    expect(findings.some((f) => f.severity === 'error')).toBe(false);
  });

  it('still scans normal-sized files alongside a skipped oversized one', () => {
    write('big.ts', `export const x = 1;\n/* ${'b'.repeat(1_000_001)} */\n`);
    write('small.ts', 'export function undocumented() {}\n');
    const findings = scanDocComments(dir);
    expect(findings.some((f) => f.severity === 'info' && f.message.includes('skipped'))).toBe(true);
    expect(
      findings.some((f) => f.severity === 'error' && f.message.includes('"undocumented"')),
    ).toBe(true);
  });
});

describe('scanDocComments — honest degradation', () => {
  it('records ONE non-blocking info finding per uncovered known language', () => {
    write('a.py', 'def f():\n    pass\n');
    write('b.py', 'def g():\n    pass\n');
    write('c.go', 'package main\n');
    const findings = scanDocComments(dir);
    const py = findings.filter((f) => f.message.includes('Python'));
    const go = findings.filter((f) => f.message.includes('Go'));
    expect(py).toHaveLength(1);
    expect(py[0]?.severity).toBe('info');
    expect(py[0]?.message).toContain('2 file(s)');
    expect(go).toHaveLength(1);
    expect(go[0]?.severity).toBe('info');
  });

  it('skips non-code files entirely (no finding, no degradation note)', () => {
    write('README.md', '# Hello\n');
    write('data.json', '{}\n');
    write('notes.txt', 'hi\n');
    expect(scanDocComments(dir)).toEqual([]);
  });

  it('an uncovered-language info finding never blocks (no error/blocker severity)', () => {
    write('only.py', 'def f():\n    pass\n');
    const findings = scanDocComments(dir);
    expect(findings.every((f) => f.severity === 'info')).toBe(true);
  });
});
