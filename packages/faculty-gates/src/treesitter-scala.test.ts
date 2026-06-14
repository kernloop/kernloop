/**
 * Branch-coverage tests for the Scala doc-comment extractor (src/treesitter-scala.ts,
 * #108/#122; CLM-0104), driven end-to-end through {@link scanTreeSitterFiles}. Each
 * test exercises a distinct branch: every top-level definition kind, the val/var
 * pattern handling (identifier + tuple_pattern), the private/protected visibility
 * regex, template_body member descent, the braced-package and package-object scopes,
 * and the documented-vs-not ScalaDoc adjacency rule. Findings carry the format
 * `exported <kind> "<name>" (<rel>:<line>) has no doc-comment`.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanTreeSitterFiles } from './treesitter-scan.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ts-scala-'));
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

/** True iff some finding mentions an exported decl of `kind` named `name`. */
function has(names: string[], kind: string, name: string): boolean {
  return names.some((m) => m.includes(`${kind} "${name}"`));
}

describe('treesitter-scala: top-level definition kinds (NAMED_DEFS)', () => {
  it('flags an undocumented def, class, object, trait, and type', async () => {
    const names = await scan(
      'Kinds.scala',
      ['def fn(): Int = 1', 'class C', 'object O', 'trait T', 'type Ty = Int'].join('\n') + '\n',
    );
    expect(has(names, 'function', 'fn')).toBe(true);
    expect(has(names, 'class', 'C')).toBe(true);
    expect(has(names, 'object', 'O')).toBe(true);
    expect(has(names, 'trait', 'T')).toBe(true);
    expect(has(names, 'type', 'Ty')).toBe(true);
  });

  it('emits the documented-format message verbatim with rel path and line', async () => {
    const names = await scan('Fmt.scala', 'def fn(): Int = 1\n');
    expect(names).toContain('exported function "fn" (Fmt.scala:1) has no doc-comment');
  });
});

describe('treesitter-scala: val/var pattern definitions (PATTERN_DEFS)', () => {
  it('flags an undocumented top-level val and var (identifier pattern)', async () => {
    const names = await scan('Vals.scala', 'val a: Int = 1\nvar b: Int = 2\n');
    expect(has(names, 'val', 'a')).toBe(true);
    expect(has(names, 'var', 'b')).toBe(true);
  });

  it('a tuple pattern val (a, b) = ... yields one finding per bound name', async () => {
    const names = await scan('Tuple.scala', 'val (a, b) = (1, 2)\n');
    expect(has(names, 'val', 'a')).toBe(true);
    expect(has(names, 'val', 'b')).toBe(true);
  });
});

describe('treesitter-scala: visibility (isNonPublic regex)', () => {
  it('does not flag private/protected def, and not a private val', async () => {
    const names = await scan(
      'Vis.scala',
      [
        'def pub(): Int = 1',
        'private def hiddenP(): Int = 0',
        'protected def hiddenQ(): Int = 0',
        'private val secret: Int = 9',
      ].join('\n') + '\n',
    );
    expect(has(names, 'function', 'pub')).toBe(true);
    expect(names.some((m) => m.includes('"hiddenP"'))).toBe(false);
    expect(names.some((m) => m.includes('"hiddenQ"'))).toBe(false);
    expect(names.some((m) => m.includes('"secret"'))).toBe(false);
  });
});

describe('treesitter-scala: documented vs. not (ScalaDoc adjacency)', () => {
  it('a /** */ ScalaDoc immediately above a def documents it (no finding)', async () => {
    expect(await scan('Doc.scala', '/** Does it. */\ndef pub(): Int = 1\n')).toEqual([]);
  });

  it('a ScalaDoc separated by a blank line still flags the def', async () => {
    const names = await scan('Gap.scala', '/** Stale. */\n\ndef pub(): Int = 1\n');
    expect(has(names, 'function', 'pub')).toBe(true);
  });
});

describe('treesitter-scala: container members (template_body descent)', () => {
  it('flags public method + val inside a class body, skips private members', async () => {
    const names = await scan(
      'Members.scala',
      [
        'class C {',
        '  def m(): Int = 1',
        '  val v: Int = 2',
        '  private def hidden(): Int = 0',
        '  private val secret: Int = 3',
        '}',
      ].join('\n') + '\n',
    );
    expect(has(names, 'class', 'C')).toBe(true);
    expect(has(names, 'method', 'm')).toBe(true);
    expect(has(names, 'val', 'v')).toBe(true);
    expect(names.some((m) => m.includes('"hidden"'))).toBe(false);
    expect(names.some((m) => m.includes('"secret"'))).toBe(false);
  });

  it('descends an object and a trait body for public members', async () => {
    const names = await scan(
      'OT.scala',
      ['object O {', '  def om(): Int = 1', '}', 'trait T {', '  def tm(): Int = 2', '}'].join(
        '\n',
      ) + '\n',
    );
    expect(has(names, 'method', 'om')).toBe(true);
    expect(has(names, 'method', 'tm')).toBe(true);
  });

  it('a documented member is not flagged', async () => {
    const names = await scan(
      'DocMember.scala',
      'class C {\n  /** docs */\n  def m(): Int = 1\n}\n',
    );
    expect(names.some((m) => m.includes('"m"'))).toBe(false);
  });
});

describe('treesitter-scala: braced package and package object', () => {
  it('descends a braced package p { ... } body as file scope', async () => {
    const names = await scan(
      'Pkg.scala',
      ['package p {', '  def inPkg(): Int = 1', '  class InPkg', '}'].join('\n') + '\n',
    );
    expect(has(names, 'function', 'inPkg')).toBe(true);
    expect(has(names, 'class', 'InPkg')).toBe(true);
  });

  it('flags the package object itself and descends its members', async () => {
    const names = await scan(
      'PkgObj.scala',
      ['package object o {', '  def inPo(): Int = 1', '}'].join('\n') + '\n',
    );
    expect(has(names, 'object', 'o')).toBe(true);
    expect(has(names, 'function', 'inPo')).toBe(true);
  });

  it('a documented package object is not flagged for itself', async () => {
    const names = await scan(
      'PkgObjDoc.scala',
      '/** the pkg obj */\npackage object o {\n  def inPo(): Int = 1\n}\n',
    );
    expect(names.some((m) => m.includes('object "o"'))).toBe(false);
    expect(has(names, 'function', 'inPo')).toBe(true);
  });

  it('a bare package x.y statement is not itself a declaration', async () => {
    const names = await scan('Bare.scala', 'package x.y\n\ndef top(): Int = 1\n');
    expect(has(names, 'function', 'top')).toBe(true);
    expect(names.some((m) => m.includes('"x"') || m.includes('"y"'))).toBe(false);
  });
});

describe('treesitter-scala: Scala-3 deferral does not crash', () => {
  it('an enum / given file parses without throwing (deferred, may yield nothing useful)', async () => {
    await expect(
      scan('S3.scala', 'enum Color:\n  case Red, Green\n\ngiven Int = 1\n'),
    ).resolves.toBeDefined();
  });
});
