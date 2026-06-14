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
  it('covers the vendored-grammar languages', () => {
    expect([...TREE_SITTER_EXTS].sort()).toEqual([
      '.c',
      '.cc',
      '.cpp',
      '.cs',
      '.cxx',
      '.go',
      '.h',
      '.hh',
      '.hpp',
      '.java',
      '.kt',
      '.kts',
      '.php',
      '.py',
      '.rb',
      '.rs',
      '.sc',
      '.scala',
      '.swift',
    ]);
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
    const findings = await scanOne(
      'm.py',
      'def _private():\n    pass\n\nclass _Hidden:\n    pass\n',
    );
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
    const findings = await scanOne(
      'm.go',
      'package main\nfunc Exported() {}\nfunc unexported() {}\n',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"Exported"');
  });

  it('a comment on the line immediately above documents the declaration', async () => {
    const findings = await scanOne(
      'm.go',
      'package main\n// Exported greets.\nfunc Exported() {}\n',
    );
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

describe('Java', () => {
  it('flags an undocumented public class but not a package-private one', async () => {
    const findings = await scanOne('M.java', 'public class Pub {}\nclass Pkg {}\n');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"Pub"');
  });

  it('a Javadoc block (or // line) immediately above documents the type', async () => {
    expect(await scanOne('A.java', '/** A pub. */\npublic class A {}\n')).toEqual([]);
    expect(await scanOne('B.java', '// a pub\npublic interface B {}\n')).toEqual([]);
  });

  it('covers public enums and records', async () => {
    const findings = await scanOne('M.java', 'public enum E { A }\npublic record R() {}\n');
    const names = findings.map((f) => f.message);
    expect(names.some((m) => m.includes('"E"'))).toBe(true);
    expect(names.some((m) => m.includes('"R"'))).toBe(true);
  });

  it('descends into a public class for public methods + fields, skipping private (#121)', async () => {
    const findings = await scanOne(
      'M.java',
      'public class A {\n  public int x;\n  public void run() {}\n  private void hidden() {}\n}\n',
    );
    const names = findings.map((f) => f.message);
    expect(names.some((m) => m.includes('field "x"'))).toBe(true);
    expect(names.some((m) => m.includes('method "run"'))).toBe(true);
    expect(names.some((m) => m.includes('"hidden"'))).toBe(false);
  });

  it('a Javadoc above a public method documents it (member-level, #121)', async () => {
    const findings = await scanOne(
      'M.java',
      '/** A type. */\npublic class A {\n  /** Runs. */\n  public void run() {}\n}\n',
    );
    expect(findings).toEqual([]);
  });
});

describe('C', () => {
  it('flags a non-static function but not a static (internal-linkage) one', async () => {
    const findings = await scanOne(
      'm.c',
      'int Exported(int a) { return a; }\nstatic int hidden(void) { return 0; }\n',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"Exported"');
  });

  it('a comment immediately above documents the function', async () => {
    expect(await scanOne('m.c', '// adds\nint add(int a, int b) { return a + b; }\n')).toEqual([]);
  });

  it('covers named struct/union/enum DEFINITIONS but skips a bodyless forward declaration', async () => {
    const findings = await scanOne(
      'm.h',
      'struct Fwd;\nstruct Point { int x; };\nenum Color { RED };\n',
    );
    const names = findings.map((f) => f.message);
    expect(names.some((m) => m.includes('"Point"'))).toBe(true);
    expect(names.some((m) => m.includes('"Color"'))).toBe(true);
    // The forward declaration `struct Fwd;` is NOT a definition → no finding.
    expect(names.some((m) => m.includes('"Fwd"'))).toBe(false);
  });

  it('covers typedef aliases (the idiomatic public C type)', async () => {
    const findings = await scanOne('m.h', 'typedef struct { int x; } Handle;\ntypedef int Id;\n');
    const names = findings.map((f) => f.message);
    expect(names.some((m) => m.includes('typedef "Handle"'))).toBe(true);
    expect(names.some((m) => m.includes('typedef "Id"'))).toBe(true);
  });

  it('covers a header function prototype (declaration), not just the definition', async () => {
    const findings = await scanOne('api.h', 'int public_api(int a);\nstatic int internal(void);\n');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"public_api"');
  });

  it('extracts a pointer-returning function name (int *foo())', async () => {
    const findings = await scanOne('m.c', 'int *grab(void) { return 0; }\n');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"grab"');
  });
});

describe('PHP', () => {
  it('flags an undocumented top-level function and class', async () => {
    const findings = await scanOne('m.php', '<?php\nfunction foo() {}\nclass Bar {}\n');
    expect(findings).toHaveLength(2);
    expect(findings.some((f) => f.message.includes('"foo"'))).toBe(true);
    expect(findings.some((f) => f.message.includes('"Bar"'))).toBe(true);
  });

  it('a PHPDoc block (or # comment) immediately above documents the declaration', async () => {
    expect(await scanOne('a.php', '<?php\n/** Foo. */\nfunction foo() {}\n')).toEqual([]);
    expect(await scanOne('b.php', '<?php\n# a class\nclass Bar {}\n')).toEqual([]);
  });

  it('descends into a class for public methods; default-visibility is public, private/protected skipped (#121)', async () => {
    const findings = await scanOne(
      'm.php',
      '<?php\nclass A {\n  public function run() {}\n  function dflt() {}\n  private function h() {}\n  protected function p() {}\n}\n',
    );
    const names = findings.map((f) => f.message);
    expect(names.some((m) => m.includes('method "run"'))).toBe(true);
    expect(names.some((m) => m.includes('method "dflt"'))).toBe(true); // no modifier ⇒ public
    expect(names.some((m) => m.includes('"h"'))).toBe(false); // private
    expect(names.some((m) => m.includes('"p"'))).toBe(false); // protected
  });

  it('a PHPDoc above a public method documents it (member-level, #121)', async () => {
    const findings = await scanOne(
      'm.php',
      '<?php\n/** A class. */\nclass A {\n  /** Runs. */\n  public function run() {}\n}\n',
    );
    expect(findings).toEqual([]);
  });
});

describe('Ruby', () => {
  it('flags an undocumented top-level def, class, and module', async () => {
    const findings = await scanOne('m.rb', 'def foo\nend\n\nclass Bar\nend\n\nmodule Baz\nend\n');
    expect(findings).toHaveLength(3);
    const names = findings.map((f) => f.message);
    expect(names.some((m) => m.includes('"foo"'))).toBe(true);
    expect(names.some((m) => m.includes('"Bar"'))).toBe(true);
    expect(names.some((m) => m.includes('"Baz"'))).toBe(true);
  });

  it('a # comment immediately above documents the declaration', async () => {
    expect(await scanOne('m.rb', '# greets\ndef foo\nend\n')).toEqual([]);
  });

  it('a comment separated by a blank line does NOT document it', async () => {
    const findings = await scanOne('m.rb', '# stale\n\ndef foo\nend\n');
    expect(findings).toHaveLength(1);
  });

  it('covers a top-level singleton method (def self.x)', async () => {
    const findings = await scanOne('m.rb', 'def self.build\nend\n');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('"build"');
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

  it('bounds a single parse by a wall-clock budget, recording a timeout as info (#123)', async () => {
    // A 1µs budget is exceeded by any real parse; web-tree-sitter checks the
    // clock between steps and returns null — many decls guarantee a checkpoint.
    const big = Array.from({ length: 300 }, (_, i) => `def f${String(i)}():\n    pass\n`).join(
      '\n',
    );
    const findings = await scanTreeSitterFiles([write('slow.py', big)], dir, {
      parseTimeoutMicros: 1,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.message).toContain('timed out parsing');
    expect(findings[0]?.path).toBe('slow.py');
  });

  it('the default budget parses a normal file to real enforcement, not a timeout', async () => {
    // Same shape under the default multi-second budget: every decl is enforced.
    const findings = await scanOne('ok.py', 'def foo():\n    pass\n\ndef bar():\n    pass\n');
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
  });
});
