/**
 * The Swift declaration extractor behind the multi-language doc-comment gate
 * (CLM-0104). Enumerates a source file's PUBLIC declarations and whether each
 * carries an adjacent doc-comment — presence, NEVER accuracy (the prime
 * directive). Pure AST logic over `web-tree-sitter` nodes — no I/O, no model.
 *
 * Swift's own rules, confirmed against the real grammar (tree-sitter-swift):
 *
 *  - Top-level decls are direct `source_file` children: `function_declaration`
 *    (name via the `name` field — a `simple_identifier`), `class_declaration`
 *    (which the grammar reuses for `class`/`struct`/`enum`/`actor`, the keyword
 *    distinguishing them; name via the `name` field — a `type_identifier`),
 *    `protocol_declaration` (likewise), and `property_declaration` (`let`/`var`
 *    — name(s) via each `pattern` child's `simple_identifier`).
 *  - Visibility: Swift's default is `internal`, NOT public. ONLY a decl whose
 *    `modifiers` child holds a `visibility_modifier` reading `public` or `open`
 *    is enumerated. A missing modifier (internal), `private`, `fileprivate`,
 *    and `internal` are all SKIPPED — they are not the public API surface.
 *    (This is the OPPOSITE of Kotlin/Scala, which are public-by-default.)
 *  - Members: a type's body is descended ONE level for its `public`/`open`
 *    `function_declaration` and `property_declaration` members (#121). The body
 *    is a `class_body` for class/struct/actor and an `enum_class_body` for enum;
 *    enum `case`s are not enumerated (they are not the function/property
 *    surface). Swift has no namespaces (modules, not lexical) — no namespace
 *    descent is needed.
 *  - Documented: a `///` line comment (`comment`) or a `/**`-delimited block
 *    doc-comment (`multiline_comment`) on the line immediately above the decl.
 *
 * Grammar quirk handled: the tree-sitter-swift grammar is imperfect — a
 * single-line type body (`public class C { public func m() {} }`) yields an
 * `ERROR` node wrapping the first member, though the wrapped
 * `function_declaration` is itself well-formed and the later members are clean
 * siblings. So member iteration descends one level THROUGH an `ERROR` node to
 * recover any well-formed member decls it wraps, and every node access is
 * defensive (a malformed subtree is skipped, never thrown on). Multi-line
 * Swift — the realistic shape of a real file — parses without the ERROR.
 *
 * Honestly deferred (#184): protocol requirements parse as distinct
 * `protocol_function_declaration`/`protocol_property_declaration` nodes with no
 * independent visibility (they inherit the protocol's), so a protocol is
 * enumerated at the top level only — its members are not descended.
 */
import type Parser from 'web-tree-sitter';
import { isAdjacentComment, lineOf, kindOf, type Decl } from './treesitter-shared.js';

/** The Swift comment node types that count as a doc-comment above a decl —
 * a `///` is a `comment`, a `/**`-delimited block is a `multiline_comment`. */
const SWIFT_COMMENTS = ['comment', 'multiline_comment'] as const;

/** The Swift top-level (and member) declaration types the gate enumerates. */
const SWIFT_DECLS = new Set([
  'function_declaration',
  'class_declaration',
  'protocol_declaration',
  'property_declaration',
]);

/** The declaration types descended inside a type's body. */
const SWIFT_MEMBERS = new Set(['function_declaration', 'property_declaration']);

/** The body node types a Swift type declaration uses for its members — a
 * `class_body` for class/struct/actor, an `enum_class_body` for enum. */
const SWIFT_BODIES = new Set(['class_body', 'enum_class_body']);

/** True iff a Swift node is PUBLIC API: its `modifiers` child holds a
 * `visibility_modifier` reading `public` or `open`. The default (no modifier)
 * is `internal`, and `private`/`fileprivate`/`internal` are all non-public —
 * the OPPOSITE of public-by-default languages, so a missing modifier is NOT
 * public here. */
function swiftIsPublic(node: Parser.SyntaxNode): boolean {
  const mods = node.namedChildren.find((c) => c.type === 'modifiers');
  if (mods === undefined) return false;
  const vis = mods.namedChildren.find((c) => c.type === 'visibility_modifier')?.text;
  return vis === 'public' || vis === 'open';
}

/** Whether a Swift node carries a `///` or `/**`-block comment immediately above. */
function swiftDocumented(node: Parser.SyntaxNode): boolean {
  return isAdjacentComment(node.previousNamedSibling, node.startPosition.row, SWIFT_COMMENTS);
}

/** A short kind label for a Swift decl. Functions report `function` (or
 * `method` for a body member); a `property_declaration` reports `property`; a
 * `class_declaration` reports its actual keyword (`class`/`struct`/`enum`/
 * `actor`, since the grammar reuses one node for all four); a protocol falls
 * back to {@link kindOf} (`protocol`). */
function swiftKind(node: Parser.SyntaxNode, member: boolean): string {
  if (node.type === 'function_declaration') return member ? 'method' : 'function';
  if (node.type === 'property_declaration') return 'property';
  if (node.type === 'class_declaration') {
    // The keyword (class/struct/enum/actor) is an ANONYMOUS child, so it is not
    // in namedChildren — scan all children to recover the real kind.
    const kw = node.children.find(
      (c) => c.type === 'class' || c.type === 'struct' || c.type === 'enum' || c.type === 'actor',
    );
    return kw?.type ?? 'class';
  }
  return kindOf(node.type);
}

/** Emit a public `function_declaration`/`protocol`/`class` decl (single name
 * via the `name` field) into `out`. `member` re-labels a body function as a
 * `method`. A name we cannot read is skipped, never thrown on. */
function emitNamed(node: Parser.SyntaxNode, member: boolean, out: Decl[]): void {
  const name = node.childForFieldName('name')?.text;
  if (name === undefined) return;
  out.push({
    name,
    kind: swiftKind(node, member),
    line: lineOf(node),
    documented: swiftDocumented(node),
  });
}

/** Emit a public `property_declaration`'s bindings. One `let`/`var` may bind
 * several names (`var a = 1, b = 2`) — each `pattern` child's
 * `simple_identifier` is its own undocumented surface, sharing the decl's
 * comment, matching how Java enumerates a multi-name field. */
function emitProperty(node: Parser.SyntaxNode, out: Decl[]): void {
  const documented = swiftDocumented(node);
  const line = lineOf(node);
  for (const pat of node.namedChildren) {
    if (pat.type !== 'pattern') continue;
    const name = pat.namedChildren.find((c) => c.type === 'simple_identifier')?.text;
    if (name === undefined) continue;
    out.push({ name, kind: 'property', line, documented });
  }
}

/** Emit one public declaration node (top-level or member). */
function emitDecl(node: Parser.SyntaxNode, member: boolean, out: Decl[]): void {
  if (!SWIFT_DECLS.has(node.type) || !swiftIsPublic(node)) return;
  if (node.type === 'property_declaration') emitProperty(node, out);
  else emitNamed(node, member, out);
}

/** The public `function`/`property` members inside a type's body (#121). The
 * grammar's imperfection wraps the first member of a single-line body in an
 * `ERROR` node, so a well-formed member decl wrapped one level under an `ERROR`
 * is recovered; everything else under an `ERROR` is left alone (no garbage). */
function swiftMembers(typeNode: Parser.SyntaxNode): Decl[] {
  const body = typeNode.namedChildren.find((c) => SWIFT_BODIES.has(c.type));
  if (body === undefined) return [];
  const out: Decl[] = [];
  for (const node of body.namedChildren) {
    if (SWIFT_MEMBERS.has(node.type)) {
      emitDecl(node, true, out);
    } else if (node.isError) {
      for (const wrapped of node.namedChildren) {
        if (SWIFT_MEMBERS.has(wrapped.type)) emitDecl(wrapped, true, out);
      }
    }
  }
  return out;
}

/** True for a type declaration whose body holds enumerable members — a
 * `class_declaration` (class/struct/enum/actor). A protocol's members have no
 * independent visibility and are honestly deferred (top-level only, #184). */
function swiftHasMembers(type: string): boolean {
  return type === 'class_declaration';
}

/** Swift: top-level functions/types/protocols/properties declared `public` or
 * `open` (Swift's default is `internal`, so everything else is skipped),
 * documented iff a `///` or `/**`-block comment sits immediately above, PLUS each
 * class/struct/enum/actor's public function and property members (#121). Robust
 * to the grammar's ERROR/MISSING nodes — a malformed subtree is skipped, never
 * thrown on. */
export function extractSwift(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    if (!SWIFT_DECLS.has(node.type)) continue;
    emitDecl(node, false, out);
    if (swiftHasMembers(node.type) && swiftIsPublic(node)) out.push(...swiftMembers(node));
  }
  return out;
}
