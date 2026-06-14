/**
 * Branch-coverage tests for the Kotlin doc-comment extractor
 * (src/treesitter-kotlin.ts, CLM-0104) driven end-to-end through
 * {@link scanTreeSitterFiles}. Each test pins a distinct branch: the four
 * top-level decl kinds, the simple_identifier vs type_identifier vs nested
 * property name extraction, every visibility_modifier path (private/internal/
 * protected skipped, explicit public flagged), class_body member descent
 * (public method + property flagged, private skipped), the package_header
 * trailing-comment doc fallback, and the documented-vs-not comment branches
 * (KDoc, line comment, blank-line gap defeats it). Findings are
 * `exported <kind> "<name>" (<rel>:<line>) has no doc-comment`.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanTreeSitterFiles } from './treesitter-scan.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ts-kotlin-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function scan(rel: string, content: string): Promise<string[]> {
  const full = path.join(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return (await scanTreeSitterFiles([full], dir)).map((f) => f.message);
}

const has = (msgs: string[], frag: string): boolean => msgs.some((m) => m.includes(frag));

describe('Kotlin top-level declaration kinds', () => {
  it('flags an undocumented top-level fun as kind "function"', async () => {
    const m = await scan('Fn.kt', 'fun pub() {}\n');
    expect(has(m, 'function "pub"')).toBe(true);
  });

  it('flags an undocumented class via its type_identifier name as kind "class"', async () => {
    const m = await scan('Cls.kt', 'class C {}\n');
    expect(has(m, 'class "C"')).toBe(true);
  });

  it('flags an undocumented object via its type_identifier name as kind "object"', async () => {
    const m = await scan('Obj.kt', 'object O {}\n');
    expect(has(m, 'object "O"')).toBe(true);
  });

  it('flags an undocumented val property (name nested under variable_declaration)', async () => {
    const m = await scan('ValP.kt', 'val answer = 42\n');
    expect(has(m, 'property "answer"')).toBe(true);
  });

  it('flags an undocumented var property as kind "property"', async () => {
    const m = await scan('VarP.kt', 'var counter = 0\n');
    expect(has(m, 'property "counter"')).toBe(true);
  });

  it('flags an undocumented interface (a class_declaration) by its type_identifier', async () => {
    const m = await scan('Iface.kt', 'interface I {}\n');
    expect(has(m, '"I"')).toBe(true);
  });
});

describe('Kotlin visibility_modifier paths', () => {
  it('skips a private fun (visibility_modifier reads private)', async () => {
    const m = await scan('Priv.kt', 'private fun hidden() {}\n');
    expect(has(m, '"hidden"')).toBe(false);
  });

  it('skips an internal fun (visibility_modifier reads internal)', async () => {
    const m = await scan('Internal.kt', 'internal fun pkg() {}\n');
    expect(has(m, '"pkg"')).toBe(false);
  });

  it('skips a protected member (visibility_modifier reads protected)', async () => {
    const m = await scan('Prot.kt', 'open class B {\n  protected fun guarded() {}\n}\n');
    expect(has(m, '"guarded"')).toBe(false);
  });

  it('flags an explicit public fun (visibility_modifier reads public => still public)', async () => {
    const m = await scan('Pub.kt', 'public fun shown() {}\n');
    expect(has(m, 'function "shown"')).toBe(true);
  });

  it('flags a fun with a non-visibility modifier (modifiers present, no visibility_modifier)', async () => {
    const m = await scan('Inline.kt', 'inline fun wrap() {}\n');
    expect(has(m, 'function "wrap"')).toBe(true);
  });
});

describe('Kotlin class_body member descent (#121)', () => {
  it('flags a public fun member as kind "method" and a public property member', async () => {
    const m = await scan('Members.kt', 'class C {\n  fun method1() {}\n  val field = 1\n}\n');
    expect(has(m, 'method "method1"')).toBe(true);
    expect(has(m, 'property "field"')).toBe(true);
  });

  it('skips a private fun member and a private property member', async () => {
    const m = await scan(
      'PrivMembers.kt',
      'class C {\n  private fun hiddenM() {}\n  private val secret = 1\n}\n',
    );
    expect(has(m, '"C"')).toBe(true);
    expect(has(m, '"hiddenM"')).toBe(false);
    expect(has(m, '"secret"')).toBe(false);
  });

  it('descends an object body for its public members too', async () => {
    const m = await scan('ObjMembers.kt', 'object O {\n  fun greet() {}\n}\n');
    expect(has(m, 'object "O"')).toBe(true);
    expect(has(m, 'method "greet"')).toBe(true);
  });

  it('a class with no body produces no member findings (class_body absent)', async () => {
    const m = await scan('NoBody.kt', 'class Empty\n');
    expect(has(m, '"Empty"')).toBe(true);
    expect(m.filter((x) => x.includes('method')).length).toBe(0);
  });
});

describe('Kotlin documented-vs-not branches', () => {
  it('a /** */ KDoc immediately above a fun documents it', async () => {
    expect(await scan('Kdoc.kt', '/** A function. */\nfun pub() {}\n')).toEqual([]);
  });

  it('a // line comment immediately above a fun documents it', async () => {
    expect(await scan('Line.kt', '// a function\nfun pub() {}\n')).toEqual([]);
  });

  it('a KDoc separated by a blank line does NOT document the fun (still flagged)', async () => {
    const m = await scan('Gap.kt', '/** A function. */\n\nfun pub() {}\n');
    expect(has(m, 'function "pub"')).toBe(true);
  });

  it('documents a class member via a KDoc immediately above it', async () => {
    const m = await scan('DocMember.kt', 'class C {\n  /** a method */\n  fun m() {}\n}\n');
    expect(has(m, '"C"')).toBe(true);
    expect(has(m, '"m"')).toBe(false);
  });
});

describe('Kotlin package_header trailing-comment fallback', () => {
  it('treats a KDoc after a package line as documenting the first decl', async () => {
    const m = await scan('Pkg.kt', 'package a.b\n/** doc */\nfun pub() {}\n');
    expect(has(m, '"pub"')).toBe(false);
  });

  it('still flags an undocumented first decl after a package line (no absorbed comment)', async () => {
    const m = await scan('PkgUndoc.kt', 'package a.b\nfun bare() {}\n');
    expect(has(m, 'function "bare"')).toBe(true);
  });
});
