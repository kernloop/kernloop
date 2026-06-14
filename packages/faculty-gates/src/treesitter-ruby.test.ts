/**
 * Ruby doc-comment gate tests (#122 top-level, #150 member descent, #165/#173
 * arg-form visibility). Split out of treesitter-scan.test.ts to keep that
 * catch-all under its per-file LOC budget; mirrors the per-language test files
 * (treesitter-cpp.test.ts, treesitter-kotlin.test.ts, …).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanTreeSitterFiles } from './treesitter-scan.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ts-ruby-'));
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

  it('descends class/module bodies for PUBLIC instance methods, honoring private/protected (#150)', async () => {
    const names = (
      await scanOne(
        'm.rb',
        'class C\n  def pub\n  end\n  private\n  def priv\n  end\n  protected\n  def prot\n  end\n  public\n  def pub2\n  end\nend\n',
      )
    ).map((f) => f.message);
    expect(names.some((m) => m.includes('method "pub"'))).toBe(true);
    expect(names.some((m) => m.includes('method "pub2"'))).toBe(true); // after `public` again
    expect(names.some((m) => m.includes('"priv"'))).toBe(false); // after `private`
    expect(names.some((m) => m.includes('"prot"'))).toBe(false); // after `protected`
  });

  it('a # comment above a public instance method documents it (member-level, #150)', async () => {
    const findings = await scanOne(
      'm.rb',
      '# A class.\nclass C\n  # runs.\n  def run\n  end\nend\n',
    );
    expect(findings).toEqual([]);
  });

  it('the arg-form `private :foo` retro-hides a method the bare loop enumerated (#165)', async () => {
    const names = (await scanOne('m.rb', 'class C\n  def foo\n  end\n  private :foo\nend\n')).map(
      (f) => f.message,
    );
    expect(names.some((m) => m.includes('"foo"'))).toBe(false); // privated by `private :foo`
  });

  it('the inline arg-form `private def bar` does not enumerate the method (#165)', async () => {
    const names = (await scanOne('m.rb', 'class C\n  private def bar\n  end\nend\n')).map(
      (f) => f.message,
    );
    expect(names.some((m) => m.includes('"bar"'))).toBe(false);
  });

  it('the inline arg-form `public def bar` DOES enumerate the method (positive control, #173)', async () => {
    // An inline-def `call` is invisible to the bare loop, so `bar` appears ONLY if
    // applyArgForm actually descends the inline `method` arg — distinguishing the
    // feature from its absence (the `private def` test alone cannot).
    const names = (await scanOne('m.rb', 'class C\n  public def bar\n  end\nend\n')).map(
      (f) => f.message,
    );
    expect(names.some((m) => m.includes('method "bar"'))).toBe(true);
  });

  it('a non-visibility arg-form call (`attr_reader :x`) does not misfire on enumeration (#173)', async () => {
    // attr_reader parses as a `call` too; applyArgForm must early-return on it
    // (callee not a visibility directive), leaving a sibling `def run` enumerated
    // and never introducing the attribute symbol `x` as a member.
    const names = (await scanOne('m.rb', 'class C\n  attr_reader :x\n  def run\n  end\nend\n')).map(
      (f) => f.message,
    );
    expect(names.some((m) => m.includes('method "run"'))).toBe(true); // unaffected
    expect(names.some((m) => m.includes('"x"'))).toBe(false); // attribute not enumerated
  });

  it('the arg-form `public :baz` re-exposes a method privated by a bare directive (#165)', async () => {
    const names = (
      await scanOne('m.rb', 'class C\n  private\n  def baz\n  end\n  public :baz\nend\n')
    ).map((f) => f.message);
    expect(names.some((m) => m.includes('method "baz"'))).toBe(true); // re-published → gated again
  });
});
