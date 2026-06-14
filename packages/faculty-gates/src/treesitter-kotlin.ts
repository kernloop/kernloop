/**
 * The Kotlin declaration extractor behind the multi-language doc-comment gate
 * (CLM-0104). Enumerates a source file's PUBLIC declarations and whether each
 * carries an adjacent KDoc/line comment — presence, NEVER accuracy (the prime
 * directive). Pure AST logic over `web-tree-sitter` nodes — no I/O, no model.
 *
 * Kotlin's own rules, confirmed against the real grammar (tree-sitter-kotlin):
 *
 *  - Top-level decls are direct `source_file` children: `function_declaration`,
 *    `class_declaration` (interfaces parse as a `class_declaration` carrying an
 *    `interface` keyword), `object_declaration`, and `property_declaration`
 *    (`val`/`var`). A `package_header` is not a decl.
 *  - Names are NOT a `name` field. A `function_declaration`'s name is its
 *    `simple_identifier` child; a class/object's name is its `type_identifier`
 *    child; a `property_declaration`'s name is the `simple_identifier` nested
 *    under its `variable_declaration` child.
 *  - Visibility: Kotlin is PUBLIC BY DEFAULT. A decl is non-public iff its
 *    `modifiers` child holds a `visibility_modifier` reading `private`,
 *    `protected`, or `internal`; an explicit `public` (or no modifier) is public.
 *  - Members: a class/object body (`class_body`) is descended one level for its
 *    PUBLIC `function_declaration` and `property_declaration` members (#121).
 *  - Documented: a KDoc (`multiline_comment`) or `//` (`line_comment`) on the
 *    line immediately above the declaration.
 *
 * Grammar quirk handled: a comment leading the FIRST decl after a `package`
 * line is absorbed as the `package_header`'s last named child rather than a
 * sibling, so that header's trailing comment is checked too. The rarer case of
 * a comment leading the first decl after an `import` is absorbed INTO the
 * `import_header`'s own text (not separately addressable) and is honestly
 * deferred (#184) — a blank line is not enough to separate it. Nested types inside
 * a class body ARE descended into their own members recursively (#181).
 */
import type Parser from 'web-tree-sitter';
import { isAdjacentComment, lineOf, kindOf, type Decl } from './treesitter-shared.js';

/** The Kotlin comment node types that count as a doc-comment above a decl —
 * a KDoc/block `/* *​/` is a `multiline_comment`, a `//` is a `line_comment`. */
const KOTLIN_COMMENTS = ['multiline_comment', 'line_comment'] as const;

/** True iff a Kotlin node is PUBLIC: it has no `visibility_modifier`, or its
 * `visibility_modifier` reads `public` (the default is public, so a missing
 * modifier is public; `private`/`protected`/`internal` are not). */
function kotlinIsPublic(node: Parser.SyntaxNode): boolean {
  const mods = node.namedChildren.find((c) => c.type === 'modifiers');
  if (mods === undefined) return true;
  const vis = mods.namedChildren.find((c) => c.type === 'visibility_modifier')?.text;
  return vis === undefined || vis === 'public';
}

/** Whether a Kotlin node carries a KDoc or `//` comment immediately above it.
 * When the previous sibling is a `package_header`, the grammar has absorbed a
 * leading comment as that header's last named child, so it is checked there. */
function kotlinDocumented(node: Parser.SyntaxNode): boolean {
  const prev = node.previousNamedSibling;
  if (isAdjacentComment(prev, node.startPosition.row, KOTLIN_COMMENTS)) return true;
  if (prev?.type === 'package_header') {
    const last = prev.namedChildren[prev.namedChildren.length - 1] ?? null;
    return isAdjacentComment(last, node.startPosition.row, KOTLIN_COMMENTS);
  }
  return false;
}

/** The name of a Kotlin declaration. Functions name themselves with a direct
 * `simple_identifier`; classes/objects with a `type_identifier`; a property's
 * name is the `simple_identifier` nested under its `variable_declaration`. */
function kotlinName(node: Parser.SyntaxNode): string | undefined {
  if (node.type === 'property_declaration') {
    const vd = node.namedChildren.find((c) => c.type === 'variable_declaration');
    return vd?.namedChildren.find((c) => c.type === 'simple_identifier')?.text;
  }
  const idType = node.type === 'function_declaration' ? 'simple_identifier' : 'type_identifier';
  return node.namedChildren.find((c) => c.type === idType)?.text;
}

/** A short kind label for a Kotlin decl: functions/properties report `function`
 * and `property`; classes/objects fall back to {@link kindOf} (which strips the
 * `_declaration` suffix to `class`/`object`). */
function kotlinKind(type: string): string {
  if (type === 'function_declaration') return 'function';
  if (type === 'property_declaration') return 'property';
  return kindOf(type);
}

/** One Kotlin declaration node → a Decl, or null when it is not a named public
 * declaration we enumerate. `member` overrides the kind label for body members
 * (a function inside a type is a `method`). */
function kotlinDecl(node: Parser.SyntaxNode, member: boolean): Decl | null {
  if (!kotlinIsPublic(node)) return null;
  const name = kotlinName(node);
  if (name === undefined) return null;
  const kind = member && node.type === 'function_declaration' ? 'method' : kotlinKind(node.type);
  return { name, kind, line: lineOf(node), documented: kotlinDocumented(node) };
}

/** The Kotlin top-level declaration types the gate enumerates. */
const KOTLIN_DECLS = new Set([
  'function_declaration',
  'class_declaration',
  'object_declaration',
  'property_declaration',
]);

/** The member declaration types enumerated inside a class/object body. */
const KOTLIN_MEMBERS = new Set(['function_declaration', 'property_declaration']);

/** The public function/property members inside a type's `class_body` (#121), plus
 * each nested public type and ITS members descended recursively (#181). Public by
 * default — `private`/`protected`/`internal` members are skipped, since flagging
 * them would demand docs on non-public surface. */
function kotlinMembers(typeNode: Parser.SyntaxNode): Decl[] {
  const body = typeNode.namedChildren.find((c) => c.type === 'class_body');
  if (body === undefined) return [];
  const out: Decl[] = [];
  for (const node of body.namedChildren) {
    if (KOTLIN_MEMBERS.has(node.type)) {
      const decl = kotlinDecl(node, true);
      if (decl !== null) out.push(decl);
    } else if (node.type === 'class_declaration' || node.type === 'object_declaration') {
      const decl = kotlinDecl(node, true); // a nested type (#181)
      if (decl !== null) {
        out.push(decl);
        out.push(...kotlinMembers(node)); // descend ITS members
      }
    }
  }
  return out;
}

/** Kotlin: top-level functions/classes/interfaces/objects/properties that are
 * public (public by default; `private`/`protected`/`internal` skipped),
 * documented iff a KDoc or `//` comment sits immediately above, PLUS each
 * class/object's public function and property members (#121). */
export function extractKotlin(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    if (!KOTLIN_DECLS.has(node.type)) continue;
    const decl = kotlinDecl(node, false);
    if (decl === null) continue;
    out.push(decl);
    if (node.type === 'class_declaration' || node.type === 'object_declaration') {
      out.push(...kotlinMembers(node));
    }
  }
  return out;
}
