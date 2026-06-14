/**
 * The C# declaration extractor behind the multi-language doc-comment gate
 * (CLM-0104), a sibling of the Java/PHP extractors in treesitter-langs.ts. It
 * enumerates a `.cs` file's PUBLIC type declarations and each public type's
 * public members, reporting whether each carries an adjacent doc-comment —
 * presence, NEVER accuracy (the prime directive).
 *
 * VISIBILITY is C#'s own rule, not a name convention: a declaration is public
 * iff it carries an explicit `public` modifier node. C#'s defaults are NOT
 * public (a top-level type defaults to `internal`, a member to `private`), so a
 * declaration without a `public` modifier is correctly skipped as non-API.
 *
 * NAMESPACES are descended, not enumerated: real C# nests its types inside
 * `namespace_declaration` (a braced body, possibly nested) and the C#-10
 * `file_scoped_namespace_declaration` (whose types are its following siblings).
 * A namespace is not itself a documentable decl — we recurse through it to reach
 * the public types, so the gate works on idiomatic namespaced source.
 *
 * "documented" is C#'s doc convention: a `comment` node — covering both the
 * `///` XML-doc form and a a `/**`-style block block — on the line immediately above.
 *
 * SCOPE. Types at any namespace nesting depth, plus one level of each public
 * type's public methods/properties/fields. A nested type declared INSIDE another
 * type's body is not descended (member-of-member), honestly deferred — matching
 * the Java extractor's one-level member boundary.
 *
 * Pure AST logic over `web-tree-sitter` nodes — no I/O, no model. The grammar
 * loading, byte budgets, and walk live in treesitter-scan.ts.
 */
import type Parser from 'web-tree-sitter';
import { isAdjacentComment, kindOf, lineOf, type Decl } from './treesitter-shared.js';

/** The C# top-level type declarations the gate enumerates. */
const CSHARP_TYPES = new Set([
  'class_declaration',
  'interface_declaration',
  'struct_declaration',
  'enum_declaration',
  'record_declaration',
  'record_struct_declaration',
  'delegate_declaration',
]);

/** The C# types that own a `declaration_list` body whose public members the gate
 * also enumerates (enum members and a delegate's parameters are not members). */
const CSHARP_CONTAINERS = new Set([
  'class_declaration',
  'interface_declaration',
  'struct_declaration',
  'record_declaration',
  'record_struct_declaration',
]);

/** True iff a C# node carries an explicit `public` modifier (modifiers parse as
 * separate `modifier` children). C#'s defaults are non-public, so the absence of
 * this modifier means the declaration is not public API. */
function csharpIsPublic(node: Parser.SyntaxNode): boolean {
  return node.namedChildren.some((c) => c.type === 'modifier' && c.text === 'public');
}

/** Whether a C# node carries a `///` XML-doc or a `/**`-style block block comment on the
 * line immediately above (both parse as a `comment` node). */
function csharpDocumented(node: Parser.SyntaxNode): boolean {
  return isAdjacentComment(node.previousNamedSibling, node.startPosition.row, ['comment']);
}

/** Public methods, properties, and fields inside a type's `declaration_list`
 * (#121). A `field_declaration` wraps a `variable_declaration` that may declare
 * several names (`public int a, b;`) — each public field name is its own
 * undocumented surface, and the C# grammar names them via a declarator's
 * `identifier` child (there is no `name` field on `variable_declarator`). */
function csharpMembers(typeNode: Parser.SyntaxNode): Decl[] {
  const body = typeNode.namedChildren.find((c) => c.type === 'declaration_list');
  if (body === undefined) return [];
  const out: Decl[] = [];
  for (const node of body.namedChildren) {
    if (!csharpIsPublic(node)) continue;
    if (node.type === 'method_declaration' || node.type === 'property_declaration') {
      const name = node.childForFieldName('name')?.text;
      if (name !== undefined) {
        const kind = node.type === 'method_declaration' ? 'method' : 'property';
        out.push({ name, kind, line: lineOf(node), documented: csharpDocumented(node) });
      }
    } else if (node.type === 'field_declaration') {
      const vars = node.namedChildren.find((c) => c.type === 'variable_declaration');
      if (vars === undefined) continue;
      for (const d of vars.namedChildren.filter((c) => c.type === 'variable_declarator')) {
        const name = d.namedChildren.find((c) => c.type === 'identifier')?.text;
        if (name !== undefined)
          out.push({ name, kind: 'field', line: lineOf(node), documented: csharpDocumented(node) });
      }
    }
  }
  return out;
}

/** Collect the public-type Decls reachable from one namespace-or-type node into
 * `out`. A `namespace_declaration` (braced, possibly nested) and a
 * `file_scoped_namespace_declaration` are not documentable themselves — recurse
 * through their bodies to reach the public types. A public type contributes its
 * own Decl plus its public members (#121); a non-public type is skipped. */
function collectCSharp(node: Parser.SyntaxNode, out: Decl[]): void {
  if (node.type === 'namespace_declaration') {
    const body = node.namedChildren.find((c) => c.type === 'declaration_list');
    if (body !== undefined) for (const child of body.namedChildren) collectCSharp(child, out);
    return;
  }
  if (node.type === 'file_scoped_namespace_declaration') {
    for (const child of node.namedChildren) collectCSharp(child, out);
    return;
  }
  if (!CSHARP_TYPES.has(node.type) || !csharpIsPublic(node)) return;
  const name = node.childForFieldName('name')?.text;
  if (name === undefined) return;
  out.push({
    name,
    kind: kindOf(node.type),
    line: lineOf(node),
    documented: csharpDocumented(node),
  });
  if (CSHARP_CONTAINERS.has(node.type)) out.push(...csharpMembers(node));
}

/** C#: PUBLIC type declarations (class/interface/struct/enum/record/record
 * struct/delegate) at any namespace nesting depth, documented iff a `///` or
 * a `/**`-style block comment sits immediately above, PLUS each public type's public
 * methods, properties, and fields (#121). */
export function extractCSharp(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) collectCSharp(node, out);
  return out;
}
