/**
 * Branch-coverage tests for the C# doc-comment extractor (treesitter-csharp.ts),
 * driven end-to-end through {@link scanTreeSitterFiles} (CLM-0104, #120/#121).
 * Each test writes a real `.cs` file into a temp dir and asserts on the gate's
 * finding `message`s, whose format is:
 *   exported <kind> "<name>" (<rel>:<line>) has no doc-comment
 *
 * The cases below exercise every branch of the extractor: each public top-level
 * type kind, the default-internal/explicit-internal skips, the namespace
 * recursion (braced + file-scoped), each public member kind, multi-name fields,
 * the public/non-public member skips, and the documented-vs-not paths
 * (`///` XML-doc, `/**` block, and a blank-line-separated comment that does NOT
 * document).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanTreeSitterFiles } from './treesitter-scan.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ts-csharp-'));
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

/** True iff some finding names `<kind> "<name>"`. */
const has = (msgs: string[], kind: string, name: string): boolean =>
  msgs.some((m) => m.includes(`${kind} "${name}"`));

describe('C# extractor: top-level public type kinds', () => {
  it('flags each public type kind (class/interface/struct/enum/record/record struct/delegate)', async () => {
    const msgs = await scan(
      'Types.cs',
      [
        'public class Cls {}',
        'public interface Iface {}',
        'public struct Strct {}',
        'public enum En { A }',
        'public record Rec {}',
        'public record struct RecS {}',
        'public delegate void Del();',
        '',
      ].join('\n'),
    );
    expect(has(msgs, 'class', 'Cls')).toBe(true);
    expect(has(msgs, 'interface', 'Iface')).toBe(true);
    expect(has(msgs, 'struct', 'Strct')).toBe(true);
    expect(has(msgs, 'enum', 'En')).toBe(true);
    expect(has(msgs, 'record', 'Rec')).toBe(true);
    expect(has(msgs, 'record_struct', 'RecS')).toBe(true);
    expect(has(msgs, 'delegate', 'Del')).toBe(true);
  });
});

describe('C# extractor: visibility of top-level types', () => {
  it('does NOT flag a bare default-internal class', async () => {
    const msgs = await scan('Plain.cs', 'class Plain {}\n');
    expect(has(msgs, 'class', 'Plain')).toBe(false);
    expect(msgs).toEqual([]);
  });

  it('does NOT flag an explicit `internal` class', async () => {
    const msgs = await scan('Internal.cs', 'internal class D {}\n');
    expect(has(msgs, 'class', 'D')).toBe(false);
    expect(msgs).toEqual([]);
  });

  it('flags a public type sitting next to a skipped non-public one', async () => {
    const msgs = await scan(
      'Mixed.cs',
      'public class Pub {}\ninternal class Hidden {}\nclass AlsoHidden {}\n',
    );
    expect(has(msgs, 'class', 'Pub')).toBe(true);
    expect(has(msgs, 'class', 'Hidden')).toBe(false);
    expect(has(msgs, 'class', 'AlsoHidden')).toBe(false);
  });
});

describe('C# extractor: public members of a public type', () => {
  it('flags public method, property, and field members', async () => {
    const msgs = await scan(
      'Members.cs',
      [
        'public class C {',
        '  public void DoIt() {}',
        '  public int Prop { get; set; }',
        '  public int fld;',
        '}',
        '',
      ].join('\n'),
    );
    expect(has(msgs, 'method', 'DoIt')).toBe(true);
    expect(has(msgs, 'property', 'Prop')).toBe(true);
    expect(has(msgs, 'field', 'fld')).toBe(true);
  });

  it('does NOT flag private/internal members', async () => {
    const msgs = await scan(
      'PrivMembers.cs',
      [
        'public class C {',
        '  private void Secret() {}',
        '  internal int Internal { get; set; }',
        '  private int hidden;',
        '}',
        '',
      ].join('\n'),
    );
    // The public class itself is the only finding.
    expect(has(msgs, 'class', 'C')).toBe(true);
    expect(has(msgs, 'method', 'Secret')).toBe(false);
    expect(has(msgs, 'property', 'Internal')).toBe(false);
    expect(has(msgs, 'field', 'hidden')).toBe(false);
  });

  it('emits one finding per name in a multi-name public field', async () => {
    const msgs = await scan('MultiField.cs', 'public class C {\n  public int a, b;\n}\n');
    expect(has(msgs, 'field', 'a')).toBe(true);
    expect(has(msgs, 'field', 'b')).toBe(true);
  });

  it('does NOT enumerate members of an enum or delegate (non-container types)', async () => {
    // enum_declaration / delegate_declaration are CSHARP_TYPES but not
    // CSHARP_CONTAINERS — their inner names must not surface as members.
    const msgs = await scan(
      'NoMembers.cs',
      'public enum Color { Red, Green }\npublic delegate int Op(int x);\n',
    );
    expect(has(msgs, 'enum', 'Color')).toBe(true);
    expect(has(msgs, 'delegate', 'Op')).toBe(true);
    expect(has(msgs, 'field', 'Red')).toBe(false);
    expect(has(msgs, 'field', 'Green')).toBe(false);
    expect(has(msgs, 'field', 'x')).toBe(false);
  });

  it('flags public members of a public record (container) but not its nested type', async () => {
    const msgs = await scan(
      'RecordMembers.cs',
      [
        'public record R {',
        '  public int Val { get; set; }',
        '  public class Inner {}',
        '}',
        '',
      ].join('\n'),
    );
    expect(has(msgs, 'record', 'R')).toBe(true);
    expect(has(msgs, 'property', 'Val')).toBe(true);
    // A nested type is member-of-member: honestly deferred, not descended.
    expect(has(msgs, 'class', 'Inner')).toBe(false);
  });
});

describe('C# extractor: namespace recursion', () => {
  it('finds types inside a braced namespace, skipping the namespace itself', async () => {
    const msgs = await scan(
      'Braced.cs',
      'namespace N {\n  public class C {\n    public void M() {}\n  }\n  internal class D {}\n}\n',
    );
    expect(has(msgs, 'class', 'C')).toBe(true);
    expect(has(msgs, 'method', 'M')).toBe(true);
    expect(has(msgs, 'class', 'D')).toBe(false);
    // The namespace is not itself a documentable decl.
    expect(msgs.some((m) => m.includes('"N"'))).toBe(false);
  });

  it('descends a nested braced namespace', async () => {
    const msgs = await scan(
      'Nested.cs',
      'namespace Outer {\n  namespace Inner {\n    public class Deep {}\n  }\n}\n',
    );
    expect(has(msgs, 'class', 'Deep')).toBe(true);
  });

  it('finds types under a file-scoped namespace (`namespace N;`)', async () => {
    const msgs = await scan(
      'FileScoped.cs',
      'namespace N;\n\npublic class C {\n  public void M() {}\n}\ninternal class D {}\n',
    );
    expect(has(msgs, 'class', 'C')).toBe(true);
    expect(has(msgs, 'method', 'M')).toBe(true);
    expect(has(msgs, 'class', 'D')).toBe(false);
    expect(msgs.some((m) => m.includes('"N"'))).toBe(false);
  });
});

describe('C# extractor: doc-comment convention', () => {
  it('treats a `///` XML-doc immediately above a type as documented', async () => {
    expect(await scan('XmlDoc.cs', '/// A documented type.\npublic class A {}\n')).toEqual([]);
  });

  it('treats a `/**`-style block immediately above a type as documented', async () => {
    expect(await scan('BlockDoc.cs', '/** A documented type. */\npublic class A {}\n')).toEqual([]);
  });

  it('treats a `///` doc immediately above a public member as documented', async () => {
    const msgs = await scan(
      'MemberDoc.cs',
      'public class C {\n  /// Documented.\n  public void M() {}\n}\n',
    );
    // The class C is undocumented and still flagged, but M is not.
    expect(has(msgs, 'class', 'C')).toBe(true);
    expect(has(msgs, 'method', 'M')).toBe(false);
  });

  it('still flags a type whose doc-comment is separated by a blank line', async () => {
    const msgs = await scan('BlankGap.cs', '/// Not adjacent.\n\npublic class A {}\n');
    expect(has(msgs, 'class', 'A')).toBe(true);
  });
});
