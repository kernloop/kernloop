import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanTreeSitterFiles, TREE_SITTER_EXTS } from './treesitter-scan.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ts-scan-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Seed a file and return its absolute path (the scanner takes absolute paths). */
function write(rel: string, content: string): string {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return full;
}

/** Run the scanner over one freshly-written file. */
async function scanOne(rel: string, content: string) {
  return scanTreeSitterFiles([write(rel, content)], dir);
}

describe('TREE_SITTER_EXTS', () => {
  it('covers exactly .py, .go, .rs', () => {
    expect([...TREE_SITTER_EXTS].sort()).toEqual(['.go', '.py', '.rs']);
  });
});

describe('Python', () => {
  it('flags an undocumented public def and class with file:line + path', async () => {
    const findings = await scanOne('m.py', 'def foo():\n    pass\n\nclass Bar:\n    pass\n');
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
    const foo = findings.find((f) => f.message.includes('"foo"'));
    expect(foo?.message).toContain('m.py:1');
    expect(foo?.path).toBe('m.py');
    expect(findings.some((f) => f.message.includes('"Bar"') && f.message.includes('m.py:4'))).toBe(
      true,
    );
  });

  it('a docstring as the first body statement counts as documented', async () => {
    const findings = await scanOne(
      'm.py',
      'def foo():\n    """Does foo."""\n    pass\n\nclass Bar:\n    """A bar."""\n    pass\n',
    );
    expect(findings).toEqual([]);
  });

  it('ignores underscore-prefixed (private) module members', async () => {
    const findings = await scanOne('m.py', 'def _private():\n    pass\n\nclass _Hidden:\n    pass\n');
    expect(findings).toEqual([]);
  });

  it('only enumerates module-level defs, not nested ones', async () => {
    const findings = await scanOne(
      'm.py',
      'def outer():\n    """ok."""\n    def inner():\n        pass\n',
    );
    expect(findings).toEqual([]);
  });
});

describe('Go', () => {
  it('flags an undocumented exported func but not an unexported one', async () => {
    const findings = await scanOne('m.go', 'package main\nfunc Exported() {}\nfunc unexported() {}\n');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"Exported"');
  });

  it('a comment on the line immediately above documents the declaration', async () => {
    const findings = await scanOne('m.go', 'package main\n// Exported greets.\nfunc Exported() {}\n');
    expect(findings).toEqual([]);
  });

  it('a comment separated by a blank line does NOT document it', async () => {
    const findings = await scanOne('m.go', 'package main\n// stale\n\nfunc Exported() {}\n');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"Exported"');
  });

  it('covers exported types, consts, and vars', async () => {
    const findings = await scanOne(
      'm.go',
      'package main\ntype Thing struct{}\nconst Pi = 3\nvar Count = 0\n',
    );
    const names = findings.map((f) => f.message);
    expect(names.some((m) => m.includes('"Thing"'))).toBe(true);
    expect(names.some((m) => m.includes('"Pi"'))).toBe(true);
    expect(names.some((m) => m.includes('"Count"'))).toBe(true);
  });
});

describe('Rust', () => {
  it('flags an undocumented pub fn but not a private fn', async () => {
    const findings = await scanOne('m.rs', 'pub fn thing() {}\nfn private_fn() {}\n');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"thing"');
  });

  it('a /// doc comment documents the item', async () => {
    const findings = await scanOne('m.rs', '/// Does a thing.\npub fn thing() {}\n');
    expect(findings).toEqual([]);
  });

  it('a /** */ block doc comment documents the item', async () => {
    const findings = await scanOne('m.rs', '/** docs */\npub struct S {}\n');
    expect(findings).toEqual([]);
  });

  it('covers pub structs, enums, traits, consts, and type aliases', async () => {
    const findings = await scanOne(
      'm.rs',
      'pub struct S {}\npub enum E { A }\npub trait T {}\npub const K: u8 = 1;\npub type Alias = u8;\n',
    );
    const names = findings.map((f) => f.message);
    expect(names.some((m) => m.includes('"S"'))).toBe(true);
    expect(names.some((m) => m.includes('"E"'))).toBe(true);
    expect(names.some((m) => m.includes('"T"'))).toBe(true);
    expect(names.some((m) => m.includes('"K"'))).toBe(true);
    expect(names.some((m) => m.includes('"Alias"'))).toBe(true);
  });
});

describe('resource bounds (untrusted input)', () => {
  it('records and skips a file over the per-file byte limit, never parsing it', async () => {
    const findings = await scanOne('big.py', `def foo():\n    pass\n# ${'a'.repeat(1_000_001)}\n`);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.message).toContain('per-file doc-scan limit');
  });

  it('truncates after the cumulative byte budget with one info note', async () => {
    // Two ~600 KB files: the second pushes past a (temporarily-irrelevant) cap?
    // Use enough files just under per-file cap to exceed the 32 MB total.
    const files: string[] = [];
    const filler = '#'.repeat(900_000);
    for (let i = 0; i < 40; i += 1) {
      files.push(write(`f${String(i)}.py`, `def foo():\n    pass\n${filler}\n`));
    }
    const findings = await scanTreeSitterFiles(files, dir);
    expect(findings.some((f) => f.message.includes('truncated'))).toBe(true);
  });

  it('returns nothing for a missing file', async () => {
    const findings = await scanTreeSitterFiles([path.join(dir, 'gone.py')], dir);
    expect(findings).toEqual([]);
  });
});
