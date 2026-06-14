/**
 * Branch-coverage tests for the C++ doc-comment extractor (treesitter-cpp.ts,
 * CLM-0104), driven end-to-end through {@link scanTreeSitterFiles}. Each case
 * exercises one decision in the extractor: the function-definition/prototype
 * path and its `static` skip, the declarator-chain name walk, class/struct/union
 * /enum DEFINITIONS vs bodyless forward declarations, `typedef`, named- vs
 * anonymous-namespace recursion, the class-vs-struct default-access tracking with
 * `access_specifier` flips, public method/field members, multi-declarator fields,
 * and the documented-vs-not (incl. blank-line gap) doc convention. Assertions are
 * over the finding messages, format `exported <kind> "<name>" (<rel>:<line>) has
 * no doc-comment`.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanTreeSitterFiles } from './treesitter-scan.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ts-cpp-'));
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

const has = (names: string[], frag: string): boolean => names.some((m) => m.includes(frag));

describe('C++ extractor — functions (treesitter-cpp)', () => {
  it('flags a non-static function definition but NOT a static one', async () => {
    const names = await scan(
      'f.cpp',
      'int pub(int a) { return a; }\nstatic int hidden() { return 0; }\n',
    );
    expect(has(names, 'function "pub"')).toBe(true);
    expect(has(names, '"hidden"')).toBe(false);
  });

  it('flags a non-static function PROTOTYPE (declaration), not just a definition', async () => {
    const names = await scan('p.hpp', 'int proto(int a);\nstatic int sp();\n');
    expect(has(names, 'function "proto"')).toBe(true);
    expect(has(names, '"sp"')).toBe(false);
  });

  it('reaches the innermost name through a pointer-returning declarator chain', async () => {
    const names = await scan('ptr.cpp', 'int *makeBuf(int n);\n');
    expect(has(names, 'function "makeBuf"')).toBe(true);
  });

  it('does NOT flag a plain non-function variable declaration', async () => {
    // a `declaration` that is not a function_declarator → cppIsFunctionDecl false
    const names = await scan('var.cpp', 'int counter = 0;\n');
    expect(has(names, '"counter"')).toBe(false);
  });
});

describe('C++ extractor — tags: class / struct / union / enum', () => {
  it('flags a class DEFINITION and a struct DEFINITION', async () => {
    const names = await scan('t.cpp', 'class C { };\nstruct S { };\n');
    expect(has(names, 'class "C"')).toBe(true);
    expect(has(names, 'struct "S"')).toBe(true);
  });

  it('does NOT flag a bodyless forward declaration', async () => {
    // `class Fwd;` has no field_declaration_list body → skipped
    const names = await scan('fwd.cpp', 'class Fwd;\nstruct FwdS;\n');
    expect(has(names, '"Fwd"')).toBe(false);
    expect(has(names, '"FwdS"')).toBe(false);
  });

  it('flags an enum DEFINITION', async () => {
    const names = await scan('e.cpp', 'enum Color { RED, GREEN };\n');
    expect(has(names, 'enum "Color"')).toBe(true);
  });

  it('flags a union DEFINITION and its public members', async () => {
    const names = await scan('u.cpp', 'union U {\n  int i;\n  float f;\n};\n');
    expect(has(names, 'union "U"')).toBe(true);
    expect(has(names, 'field "i"')).toBe(true);
    expect(has(names, 'field "f"')).toBe(true);
  });
});

describe('C++ extractor — typedef', () => {
  it('flags a typedef alias', async () => {
    const names = await scan('td.cpp', 'typedef int MyInt;\n');
    expect(has(names, 'typedef "MyInt"')).toBe(true);
  });
});

describe('C++ extractor — class/struct member access', () => {
  it('class defaults private: a public: method/field is flagged, a private: member is NOT', async () => {
    const names = await scan(
      'cls.cpp',
      [
        'class C {',
        '  int secret;', // default-private region → skipped
        'public:',
        '  void pm();', // public method → flagged
        '  int pub;', // public field → flagged
        'private:',
        '  int hidden;', // flipped back to private → skipped
        '};',
        '',
      ].join('\n'),
    );
    expect(has(names, 'class "C"')).toBe(true);
    expect(has(names, 'method "pm"')).toBe(true);
    expect(has(names, 'field "pub"')).toBe(true);
    expect(has(names, '"secret"')).toBe(false);
    expect(has(names, '"hidden"')).toBe(false);
  });

  it('struct defaults public: a member is flagged with no public: needed', async () => {
    const names = await scan('st.cpp', 'struct S {\n  int x;\n  void m();\n};\n');
    expect(has(names, 'struct "S"')).toBe(true);
    expect(has(names, 'field "x"')).toBe(true);
    expect(has(names, 'method "m"')).toBe(true);
  });

  it('skips a static member inside a public section', async () => {
    const names = await scan('sm.cpp', 'struct S {\n  static int shared;\n  int inst;\n};\n');
    expect(has(names, 'field "inst"')).toBe(true);
    expect(has(names, '"shared"')).toBe(false);
  });

  it('a multi-declarator field yields one finding per name', async () => {
    const names = await scan('multi.cpp', 'struct S {\n  int a, b;\n};\n');
    expect(has(names, 'field "a"')).toBe(true);
    expect(has(names, 'field "b"')).toBe(true);
  });
});

describe('C++ extractor — namespaces', () => {
  it('descends a NAMED namespace and enumerates its decls', async () => {
    const names = await scan('ns.cpp', 'namespace ns {\n  int inside();\n  class K { };\n}\n');
    expect(has(names, 'function "inside"')).toBe(true);
    expect(has(names, 'class "K"')).toBe(true);
  });

  it('descends NESTED named namespaces', async () => {
    const names = await scan(
      'nest.cpp',
      'namespace a {\n  namespace b {\n    int deep();\n  }\n}\n',
    );
    expect(has(names, 'function "deep"')).toBe(true);
  });

  it('SKIPS an anonymous namespace (internal linkage)', async () => {
    const names = await scan('anon.cpp', 'namespace {\n  int local();\n  class Hidden { };\n}\n');
    expect(has(names, '"local"')).toBe(false);
    expect(has(names, '"Hidden"')).toBe(false);
  });

  it('descends a namespaced type into its PUBLIC members, skipping private (#170)', async () => {
    const names = await scan(
      'nsmem.cpp',
      'namespace ns {\n  class K {\n  public:\n    void pub();\n  private:\n    void hid();\n  };\n}\n',
    );
    expect(has(names, 'class "K"')).toBe(true); // the namespaced type
    expect(has(names, 'method "pub"')).toBe(true); // its public member, reached through the namespace
    expect(has(names, '"hid"')).toBe(false); // private, skipped
  });
});

describe('C++ extractor — doc convention', () => {
  it('a /** */ block comment immediately above documents a function', async () => {
    expect(
      await scan('doc.cpp', '/** Adds. */\nint add(int a, int b) { return a + b; }\n'),
    ).toEqual([]);
  });

  it('a // line comment immediately above documents a function', async () => {
    expect(await scan('line.cpp', '// adds\nint add2(int a) { return a; }\n')).toEqual([]);
  });

  it('a blank-line-separated comment does NOT document (still flagged)', async () => {
    const names = await scan('gap.cpp', '// stale\n\nint gap(int a) { return a; }\n');
    expect(has(names, 'function "gap"')).toBe(true);
  });

  it('a documented class member is not flagged', async () => {
    const names = await scan(
      'dm.cpp',
      '/** a struct */\nstruct S {\n  /** the count */\n  int count;\n};\n',
    );
    expect(has(names, 'struct "S"')).toBe(false); // struct documented → not flagged
    expect(has(names, 'field "count"')).toBe(false); // member documented → not flagged
  });
});
