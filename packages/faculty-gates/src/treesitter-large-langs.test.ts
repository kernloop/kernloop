/**
 * Integration tests for the large-grammar languages (#120) end-to-end through
 * {@link scanTreeSitterFiles}: each new extractor (C#, Scala, Kotlin, C++, Swift)
 * is routed by its extension and flags an undocumented PUBLIC declaration while
 * skipping the language's non-public surface and honoring its doc convention.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanTreeSitterFiles } from './treesitter-scan.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ts-large-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function scan(rel: string, content: string) {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return (await scanTreeSitterFiles([full], dir)).map((f) => f.message);
}

describe('C# (#120)', () => {
  it('flags a public type + public member inside a namespace, skips internal/private', async () => {
    const names = await scan(
      'M.cs',
      'namespace N {\n  public class C {\n    public void M() {}\n    private int x;\n  }\n  internal class D {}\n}\n',
    );
    expect(names.some((m) => m.includes('"C"'))).toBe(true);
    expect(names.some((m) => m.includes('method "M"'))).toBe(true);
    expect(names.some((m) => m.includes('"x"'))).toBe(false);
    expect(names.some((m) => m.includes('"D"'))).toBe(false);
  });

  it('a /// doc above a public class documents it', async () => {
    expect(await scan('A.cs', '/// A type.\npublic class A {}\n')).toEqual([]);
  });
});

describe('Scala (#120)', () => {
  it('flags a public def + class but not a private def', async () => {
    const names = await scan(
      'M.scala',
      'def pub(): Int = 1\nprivate def hidden(): Int = 0\nclass C\n',
    );
    expect(names.some((m) => m.includes('"pub"'))).toBe(true);
    expect(names.some((m) => m.includes('"C"'))).toBe(true);
    expect(names.some((m) => m.includes('"hidden"'))).toBe(false);
  });

  it('a /** */ ScalaDoc above a def documents it', async () => {
    expect(await scan('A.scala', '/** Does it. */\ndef pub(): Int = 1\n')).toEqual([]);
  });
});

describe('Kotlin (#120)', () => {
  it('flags a public fun + class member, skips a private fun', async () => {
    const names = await scan(
      'M.kt',
      'fun pub() {}\nprivate fun hidden() {}\nclass C {\n  fun m() {}\n}\n',
    );
    expect(names.some((m) => m.includes('"pub"'))).toBe(true);
    expect(names.some((m) => m.includes('"m"'))).toBe(true);
    expect(names.some((m) => m.includes('"hidden"'))).toBe(false);
  });

  it('a KDoc above a public fun documents it', async () => {
    expect(await scan('A.kt', '/** Does it. */\nfun pub() {}\n')).toEqual([]);
  });
});

describe('C++ (#120)', () => {
  it('flags a non-static function + class, skips a static function', async () => {
    const names = await scan(
      'm.cpp',
      'int pub(int a) { return a; }\nstatic int hidden() { return 0; }\nclass C { public: void pm(); };\n',
    );
    expect(names.some((m) => m.includes('"pub"'))).toBe(true);
    expect(names.some((m) => m.includes('"C"'))).toBe(true);
    expect(names.some((m) => m.includes('"hidden"'))).toBe(false);
  });

  it('a // comment above a function documents it', async () => {
    expect(await scan('m.cpp', '// adds\nint add(int a, int b) { return a + b; }\n')).toEqual([]);
  });
});

describe('Swift (#120)', () => {
  it('flags a public func but not an internal (default) or private one', async () => {
    const names = await scan(
      'M.swift',
      'public func pub() {}\nfunc internalFn() {}\nprivate func priv() {}\n',
    );
    expect(names.some((m) => m.includes('"pub"'))).toBe(true);
    expect(names.some((m) => m.includes('"internalFn"'))).toBe(false);
    expect(names.some((m) => m.includes('"priv"'))).toBe(false);
  });

  it('a /// doc above a public func documents it', async () => {
    expect(await scan('A.swift', '/// Does it.\npublic func pub() {}\n')).toEqual([]);
  });
});
