import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mineExportedSymbols, scanDocComments } from './doc-scan.js';

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
  it('a documented exported function produces no finding', async () => {
    write(
      'src/a.ts',
      '/** Adds two numbers. */\nexport function add(a: number, b: number) {\n  return a + b;\n}\n',
    );
    expect(await scanDocComments(dir)).toEqual([]);
  });

  it('an undocumented exported function is an error finding with file:line and path', async () => {
    write('src/a.ts', 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
    const findings = await scanDocComments(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('"add"');
    expect(findings[0]?.message).toContain('src/a.ts:1');
    expect(findings[0]?.path).toBe(path.join('src', 'a.ts'));
  });

  it('flags undocumented exported classes, interfaces, type aliases, enums, and consts', async () => {
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
    const names = (await scanDocComments(dir)).map((f) => f.message);
    expect(names.some((m) => m.includes('"C"'))).toBe(true);
    expect(names.some((m) => m.includes('"I"'))).toBe(true);
    expect(names.some((m) => m.includes('"T"'))).toBe(true);
    expect(names.some((m) => m.includes('"E"'))).toBe(true);
    expect(names.some((m) => m.includes('"k"'))).toBe(true);
    expect(await scanDocComments(dir)).toHaveLength(5);
  });

  it('ignores NON-exported declarations (only the public surface is gated)', async () => {
    write('src/a.ts', 'function helper() {}\nconst secret = 2;\n');
    expect(await scanDocComments(dir)).toEqual([]);
  });

  it('treats an empty/whitespace-only doc-comment as undocumented', async () => {
    write('src/a.ts', '/**  */\nexport function add() {}\n');
    expect(await scanDocComments(dir)).toHaveLength(1);
  });

  it('treats a /***/ (and /****/) empty doc shell as undocumented', async () => {
    write('a.ts', '/***/\nexport function f() {}\n');
    write('b.ts', '/****/\nexport function g() {}\n');
    const findings = await scanDocComments(dir);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
  });

  it('honors a leading // line comment as a doc-comment', async () => {
    write('src/a.ts', '// Adds.\nexport function add() {}\n');
    expect(await scanDocComments(dir)).toEqual([]);
  });

  it('does NOT flag re-exports (they declare nothing in this file)', async () => {
    write('src/a.ts', "export { foo } from './other.js';\nexport * from './all.js';\n");
    expect(await scanDocComments(dir)).toEqual([]);
  });

  it('scans .js/.jsx/.mts files too', async () => {
    write('a.js', 'export function f() {}\n');
    write('b.mts', 'export const g = 1;\n');
    expect(await scanDocComments(dir)).toHaveLength(2);
  });
});

describe('scanDocComments — directory walk', () => {
  it('recurses into subdirectories but skips node_modules and dist', async () => {
    write('src/deep/nested/x.ts', 'export function deep() {}\n');
    write('node_modules/pkg/index.ts', 'export function vendored() {}\n');
    write('dist/built.ts', 'export function built() {}\n');
    const findings = await scanDocComments(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"deep"');
  });

  it('returns no findings for a directory that does not exist', async () => {
    expect(await scanDocComments(path.join(dir, 'missing'))).toEqual([]);
  });
});

describe('scanDocComments — resource bounds (untrusted input)', () => {
  it('records and skips a file over the per-file byte limit, never parsing it', async () => {
    // > 1 MB: an undocumented export buried under a huge comment. If the file
    // were parsed it would be an `error`; the bound makes it a skipped `info`.
    write('big.ts', `export function big() {}\n// ${'a'.repeat(1_000_001)}\n`);
    const findings = await scanDocComments(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.message).toContain('skipped');
    expect(findings[0]?.message).toContain('per-file doc-scan limit');
    expect(findings.some((f) => f.severity === 'error')).toBe(false);
  });

  it('still scans normal-sized files alongside a skipped oversized one', async () => {
    write('big.ts', `export const x = 1;\n/* ${'b'.repeat(1_000_001)} */\n`);
    write('small.ts', 'export function undocumented() {}\n');
    const findings = await scanDocComments(dir);
    expect(findings.some((f) => f.severity === 'info' && f.message.includes('skipped'))).toBe(true);
    expect(
      findings.some((f) => f.severity === 'error' && f.message.includes('"undocumented"')),
    ).toBe(true);
  });
});

describe('scanDocComments — Python/Go/Rust enforcement (#108)', () => {
  it('flags an undocumented public Python def as an error (no longer degrades to info)', async () => {
    write('a.py', 'def f():\n    pass\n');
    const findings = await scanDocComments(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('"f"');
    expect(findings.some((f) => f.message.includes('does not yet cover Python'))).toBe(false);
  });

  it('flags an undocumented exported Go func and an undocumented pub Rust fn', async () => {
    write('main.go', 'package main\nfunc Exported() {}\n');
    write('lib.rs', 'pub fn thing() {}\n');
    const findings = await scanDocComments(dir);
    expect(findings.filter((f) => f.severity === 'error')).toHaveLength(2);
    expect(findings.some((f) => f.message.includes('"Exported"'))).toBe(true);
    expect(findings.some((f) => f.message.includes('"thing"'))).toBe(true);
  });

  it('a documented Python/Go/Rust surface passes clean', async () => {
    write('a.py', 'def f():\n    """does."""\n    pass\n');
    write('main.go', 'package main\n// Exported does.\nfunc Exported() {}\n');
    write('lib.rs', '/// docs\npub fn thing() {}\n');
    expect(await scanDocComments(dir)).toEqual([]);
  });
});

describe('scanDocComments — honest degradation (remaining languages)', () => {
  it('records ONE non-blocking info finding per still-uncovered known language', async () => {
    write('a.rb', 'def f\nend\n');
    write('b.rb', 'def g\nend\n');
    write('C.java', 'class C {}\n');
    const findings = await scanDocComments(dir);
    const rb = findings.filter((f) => f.message.includes('Ruby'));
    const java = findings.filter((f) => f.message.includes('Java'));
    expect(rb).toHaveLength(1);
    expect(rb[0]?.severity).toBe('info');
    expect(rb[0]?.message).toContain('2 file(s)');
    expect(java).toHaveLength(1);
    expect(java[0]?.severity).toBe('info');
  });

  it('skips non-code files entirely (no finding, no degradation note)', async () => {
    write('README.md', '# Hello\n');
    write('data.json', '{}\n');
    write('notes.txt', 'hi\n');
    expect(await scanDocComments(dir)).toEqual([]);
  });

  it('a still-uncovered-language info finding never blocks (no error/blocker severity)', async () => {
    write('only.rb', 'def f\nend\n');
    const findings = await scanDocComments(dir);
    expect(findings.every((f) => f.severity === 'info')).toBe(true);
  });
});

describe('mineExportedSymbols (#107)', () => {
  it('returns each file with its exported symbols + doc presence, relative path', () => {
    write('src/a.ts', '/** Adds. */\nexport function add() {}\nexport const k = 1;\n');
    const mined = mineExportedSymbols(dir);
    expect(mined).toHaveLength(1);
    expect(mined[0]?.file).toBe(path.join('src', 'a.ts'));
    const byName = Object.fromEntries(mined[0]!.symbols.map((s) => [s.name, s]));
    expect(byName['add']?.doc).toContain('Adds');
    expect(byName['k']?.doc).toBeNull(); // present but undocumented
    expect(mined[0]?.symbols).toHaveLength(2);
  });

  it('omits files with no exported symbols', () => {
    write('a.ts', 'function private() {}\n');
    write('b.ts', 'export function pub() {}\n');
    const mined = mineExportedSymbols(dir);
    expect(mined.map((m) => m.file)).toEqual(['b.ts']);
  });

  it('skips a file over the per-file byte budget (never parses it)', () => {
    write('big.ts', `export function big() {}\n// ${'a'.repeat(1_000_001)}\n`);
    expect(mineExportedSymbols(dir)).toEqual([]);
  });
});
