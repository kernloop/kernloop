/**
 * Branch-coverage tests for the Swift doc-comment extractor (treesitter-swift.ts,
 * CLM-0104), driven end-to-end through {@link scanTreeSitterFiles}. Each test
 * targets a distinct branch of the extractor: the public/open visibility rule
 * (internal-default + private/fileprivate skipped), the class_declaration
 * keyword→kind resolution (class/struct/enum/actor), property multi-binding
 * names, member descent through class_body/enum_class_body, the ERROR-node
 * recovery path, the `///` vs `/**`-block doc detection, and the documented-vs-not
 * and blank-line-gap cases. Snippets are MULTI-LINE so the real grammar parses
 * them cleanly (single-line type bodies emit ERROR nodes); the malformed case is
 * asserted not to throw.
 *
 * Finding message shape (from treesitter-scan.ts):
 *   `exported <kind> "<name>" (<rel>:<line>) has no doc-comment`
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanTreeSitterFiles } from './treesitter-scan.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ts-swift-'));
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

describe('Swift visibility rule (public/open vs internal/private/fileprivate)', () => {
  it('flags a public func, skips internal (default), private, and fileprivate', async () => {
    const names = await scan(
      'Vis.swift',
      [
        'public func pub() {',
        '    return',
        '}',
        'func internalFn() {',
        '    return',
        '}',
        'private func priv() {',
        '    return',
        '}',
        'fileprivate func fpriv() {',
        '    return',
        '}',
        'internal func explicitInternal() {',
        '    return',
        '}',
      ].join('\n') + '\n',
    );
    expect(has(names, 'function "pub"')).toBe(true);
    expect(has(names, '"internalFn"')).toBe(false);
    expect(has(names, '"priv"')).toBe(false);
    expect(has(names, '"fpriv"')).toBe(false);
    expect(has(names, '"explicitInternal"')).toBe(false);
  });

  it('treats an `open` declaration as public', async () => {
    const names = await scan(
      'Open.swift',
      ['open class Widget {', '    public var n = 0', '}'].join('\n') + '\n',
    );
    expect(has(names, 'class "Widget"')).toBe(true);
  });
});

describe('Swift class_declaration keyword → kind resolution', () => {
  it('reports the real keyword for class/struct/enum/actor', async () => {
    const names = await scan(
      'Kinds.swift',
      [
        'public class AClass {',
        '    public var a = 0',
        '}',
        'public struct AStruct {',
        '    public var b = 0',
        '}',
        'public enum AnEnum {',
        '    case one',
        '}',
        'public actor AnActor {',
        '    public var c = 0',
        '}',
      ].join('\n') + '\n',
    );
    expect(has(names, 'class "AClass"')).toBe(true);
    expect(has(names, 'struct "AStruct"')).toBe(true);
    expect(has(names, 'enum "AnEnum"')).toBe(true);
    expect(has(names, 'actor "AnActor"')).toBe(true);
  });

  it('skips an internal (default) type', async () => {
    const names = await scan(
      'Internal.swift',
      ['class Hidden {', '    var x = 0', '}'].join('\n') + '\n',
    );
    expect(has(names, '"Hidden"')).toBe(false);
  });
});

describe('Swift protocol declarations', () => {
  it('flags a public protocol, skips an internal one', async () => {
    const names = await scan(
      'Proto.swift',
      [
        'public protocol Drawable {',
        '    func draw()',
        '}',
        'protocol Hidden {',
        '    func go()',
        '}',
      ].join('\n') + '\n',
    );
    expect(has(names, 'protocol "Drawable"')).toBe(true);
    expect(has(names, '"Hidden"')).toBe(false);
  });
});

describe('Swift property declarations', () => {
  it('flags a public let and a public var', async () => {
    const names = await scan(
      'Props.swift',
      ['public let answer = 42', 'public var counter = 0'].join('\n') + '\n',
    );
    expect(has(names, 'property "answer"')).toBe(true);
    expect(has(names, 'property "counter"')).toBe(true);
  });

  it('emits one finding per name in a multi-binding property', async () => {
    const names = await scan('Multi.swift', 'public var a = 1, b = 2\n');
    expect(has(names, 'property "a"')).toBe(true);
    expect(has(names, 'property "b"')).toBe(true);
  });

  it('skips a non-public property', async () => {
    const names = await scan('PrivProp.swift', 'private let secret = 1\n');
    expect(has(names, '"secret"')).toBe(false);
  });
});

describe('Swift member descent', () => {
  it('flags a public method in a class body, skips a non-public one', async () => {
    const names = await scan(
      'Members.swift',
      [
        'public class Service {',
        '    public func handle() {',
        '        return',
        '    }',
        '    func internalHelper() {',
        '        return',
        '    }',
        '    private func secretHelper() {',
        '        return',
        '    }',
        '}',
      ].join('\n') + '\n',
    );
    expect(has(names, 'method "handle"')).toBe(true);
    expect(has(names, '"internalHelper"')).toBe(false);
    expect(has(names, '"secretHelper"')).toBe(false);
  });

  it('flags a public property member inside a class body', async () => {
    const names = await scan(
      'MemberProp.swift',
      ['public struct Box {', '    public let size = 0', '    private var hidden = 1', '}'].join(
        '\n',
      ) + '\n',
    );
    expect(has(names, 'property "size"')).toBe(true);
    expect(has(names, '"hidden"')).toBe(false);
  });

  it('descends an enum_class_body for a public method member', async () => {
    const names = await scan(
      'EnumBody.swift',
      [
        'public enum Direction {',
        '    case north',
        '    public func opposite() {',
        '        return',
        '    }',
        '}',
      ].join('\n') + '\n',
    );
    // the enum itself is undocumented + public
    expect(has(names, 'enum "Direction"')).toBe(true);
    // the member method is descended via enum_class_body
    expect(has(names, 'method "opposite"')).toBe(true);
    // `case`s are not the function/property surface
    expect(has(names, '"north"')).toBe(false);
  });

  it('does not descend members of an internal type', async () => {
    const names = await scan(
      'InternalMembers.swift',
      [
        'class Internal {',
        '    public func wouldBePublic() {',
        '        return',
        '    }',
        '}',
      ].join('\n') + '\n',
    );
    expect(has(names, '"wouldBePublic"')).toBe(false);
    expect(has(names, '"Internal"')).toBe(false);
  });

  it('descends a public protocol body for its method + property requirements (#184)', async () => {
    const names = await scan(
      'ProtoMembers.swift',
      [
        'public protocol P {',
        '    func required() -> String',
        '    var name: String { get }',
        '}',
      ].join('\n') + '\n',
    );
    expect(has(names, 'protocol "P"')).toBe(true);
    expect(has(names, 'method "required"')).toBe(true); // requirement enumerated (#184)
    expect(has(names, 'property "name"')).toBe(true);
  });

  it('a documented protocol requirement passes clean; an internal protocol is not descended (#184)', async () => {
    const documented = await scan(
      'DocProto.swift',
      ['public protocol P {', '    /// Greets.', '    func greet()', '}'].join('\n') + '\n',
    );
    expect(has(documented, '"greet"')).toBe(false); // its /// doc-comment documents it

    const internal = await scan(
      'IntProto.swift',
      ['protocol Hidden {', '    func req()', '}'].join('\n') + '\n',
    );
    expect(internal).toEqual([]); // internal protocol → neither it nor its requirements
  });
});

describe('Swift doc-comment detection', () => {
  it('treats a /// line doc immediately above as documented', async () => {
    expect(
      await scan(
        'LineDoc.swift',
        ['/// Returns nothing useful.', 'public func pub() {', '    return', '}'].join('\n') + '\n',
      ),
    ).toEqual([]);
  });

  it('treats a /** */ block doc immediately above as documented', async () => {
    expect(
      await scan(
        'BlockDoc.swift',
        ['/** A documented func. */', 'public func pub() {', '    return', '}'].join('\n') + '\n',
      ),
    ).toEqual([]);
  });

  it('still flags a public func when the doc is separated by a blank line', async () => {
    const names = await scan(
      'GapDoc.swift',
      ['/// Detached doc.', '', 'public func pub() {', '    return', '}'].join('\n') + '\n',
    );
    expect(has(names, 'function "pub"')).toBe(true);
  });

  it('flags an undocumented public func with the right message + line', async () => {
    const names = await scan(
      'Undoc.swift',
      ['public func bare() {', '    return', '}'].join('\n') + '\n',
    );
    expect(names).toContain('exported function "bare" (Undoc.swift:1) has no doc-comment');
  });
});

describe('Swift robustness (the prime directive: presence, never a throw)', () => {
  it('does not throw on a malformed/ERROR-producing snippet and returns cleanly', async () => {
    // A single-line / truncated type body is exactly the shape the real grammar
    // wraps in an ERROR node; the extractor must skip it defensively, not throw.
    const names = await scan('Broken.swift', 'public class { func\n');
    expect(Array.isArray(names)).toBe(true);
  });

  it('surfaces a public member of a single-line type body', async () => {
    // On the vendored grammar version this body parses cleanly (no ERROR), so the
    // member is reached via the normal class_body descent. Either way the public
    // class and its public method must be flagged.
    const names = await scan('OneLine.swift', 'public class C { public func m() {} }\n');
    expect(has(names, 'class "C"')).toBe(true);
    expect(has(names, 'method "m"')).toBe(true);
  });

  it('does not throw when an ERROR node sits among a type body (case in a class)', async () => {
    // A `case` inside a class_body is malformed and produces an ERROR sibling;
    // the member-iteration ERROR branch must walk it without throwing, and the
    // clean public func sibling after it still surfaces.
    const names = await scan(
      'ErrSibling.swift',
      [
        'public class C {',
        '    case stray',
        '    public func m() {',
        '        return',
        '    }',
        '}',
      ].join('\n') + '\n',
    );
    expect(has(names, 'class "C"')).toBe(true);
    expect(has(names, 'method "m"')).toBe(true);
  });

  it('handles an empty Swift file without error', async () => {
    expect(await scan('Empty.swift', '\n')).toEqual([]);
  });
});
