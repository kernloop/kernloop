/**
 * The Scala declaration extractor behind the multi-language doc-comment gate
 * (#108/#122; CLM-0104). Enumerates a Scala source file's PUBLIC top-level
 * declarations PLUS each class/object/trait's public members, and whether each
 * carries an adjacent ScalaDoc comment — presence, NEVER accuracy (the prime
 * directive). Pure AST logic over `web-tree-sitter` nodes; no I/O, no model.
 *
 * SCALA RULES (verified against the vendored Scala-2 grammar via a probe):
 *  - Top-level decls are direct children of `compilation_unit`; a bare
 *    `package x.y` statement is a sibling `package_clause`, not a wrapper. A
 *    BRACED package (`package x { … }`) and a `package_object` instead wrap
 *    their members in a `template_body`, which we descend as file scope.
 *  - Declarations: `function_definition` (def), `class_/object_/trait_/
 *    type_definition`, and `val_/var_definition`. The first carry a `name`
 *    field; val/var carry a `pattern` field (an identifier, or a
 *    `tuple_pattern` binding several names at once).
 *  - Visibility: Scala is PUBLIC BY DEFAULT. A decl is non-public iff it has a
 *    `modifiers` child whose text declares `private` or `protected`.
 *  - Members: a class/object/trait body is a `template_body`; its public
 *    `function_definition`/`val_definition`/`var_definition` are enumerated
 *    (methods as 'method', value bindings keep their kind).
 *  - Documented: a a `/**`-style ScalaDoc parses as a `comment` node; it counts
 *    when it sits on the line immediately above the declaration.
 *
 * The grammar is Scala 2; Scala-3-only `enum`/`given` do not parse as clean
 * declaration nodes and are therefore not enumerated (honestly deferred: #184).
 */
import type Parser from 'web-tree-sitter';
import { isAdjacentComment, lineOf, kindOf, type Decl } from './treesitter-shared.js';

/** The Scala definition node types that bind a name via a `name` field. */
const NAMED_DEFS = new Set([
  'function_definition',
  'class_definition',
  'object_definition',
  'trait_definition',
  'type_definition',
]);

/** The Scala definition node types that bind name(s) via a `pattern` field. */
const PATTERN_DEFS = new Set(['val_definition', 'var_definition']);

/** The definition node types whose body members the gate descends into. */
const CONTAINER_DEFS = new Set(['class_definition', 'object_definition', 'trait_definition']);

/** True iff a node is non-public — it carries a `modifiers` child whose text
 * declares `private` or `protected` (Scala is public by default). */
function isNonPublic(node: Parser.SyntaxNode): boolean {
  const mods = node.namedChildren.find((c) => c.type === 'modifiers');
  return /\b(?:private|protected)\b/.test(mods?.text ?? '');
}

/** Whether a ScalaDoc/`comment` node sits on the line immediately above `node`. */
function documented(node: Parser.SyntaxNode): boolean {
  return isAdjacentComment(node.previousNamedSibling, node.startPosition.row, ['comment']);
}

/** The identifier names a val/var `pattern` binds: the identifier itself, or
 * each identifier of a `tuple_pattern` (`val (a, b) = …` declares two). */
function patternNames(pattern: Parser.SyntaxNode | null): string[] {
  if (pattern === null) return [];
  if (pattern.type === 'identifier') return [pattern.text];
  if (pattern.type === 'tuple_pattern') {
    return pattern.namedChildren.filter((c) => c.type === 'identifier').map((c) => c.text);
  }
  return [];
}

/** Emit the public Decl(s) for one definition node, or none when it is
 * non-public, an unhandled type, or nameless. `kind` overrides the derived kind
 * (members force 'method'); a val/var may yield several names. */
function emitDecl(node: Parser.SyntaxNode, kindOverride?: string): Decl[] {
  if (isNonPublic(node)) return [];
  const doc = documented(node);
  if (NAMED_DEFS.has(node.type)) {
    const name = node.childForFieldName('name')?.text;
    if (name === undefined) return [];
    const kind = kindOverride ?? kindOf(node.type);
    return [{ name, kind, line: lineOf(node), documented: doc }];
  }
  if (PATTERN_DEFS.has(node.type)) {
    const kind = kindOverride ?? kindOf(node.type);
    return patternNames(node.childForFieldName('pattern')).map((name) => ({
      name,
      kind,
      line: lineOf(node),
      documented: doc,
    }));
  }
  return [];
}

/** Public members inside a container's `template_body`: methods (as 'method')
 * and value bindings (their own kind). Private/protected members are skipped —
 * flagging them would demand docs on non-public surface. */
function members(container: Parser.SyntaxNode): Decl[] {
  const body = container.namedChildren.find((c) => c.type === 'template_body');
  if (body === undefined) return [];
  const out: Decl[] = [];
  for (const node of body.namedChildren) {
    if (node.type === 'function_definition') out.push(...emitDecl(node, 'method'));
    else if (PATTERN_DEFS.has(node.type)) out.push(...emitDecl(node));
  }
  return out;
}

/** Enumerate the public declarations of a flat scope (the file, or a braced
 * package / package-object body), descending one level into each container. */
function scope(nodes: readonly Parser.SyntaxNode[]): Decl[] {
  const out: Decl[] = [];
  for (const node of nodes) {
    if (NAMED_DEFS.has(node.type) || PATTERN_DEFS.has(node.type)) {
      out.push(...emitDecl(node));
      if (CONTAINER_DEFS.has(node.type)) out.push(...members(node));
    }
  }
  return out;
}

/**
 * Scala: public top-level `def`/`class`/`object`/`trait`/`type`/`val`/`var`
 * (public by default; `private`/`protected` skipped) PLUS each
 * class/object/trait's public members, documented iff a ScalaDoc `comment`
 * sits immediately above. A braced `package … { }` or `package object` wraps
 * its members in a `template_body` we treat as file scope; a bare `package x.y`
 * statement is not itself a declaration.
 */
export function extractScala(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = scope(root.namedChildren);
  for (const node of root.namedChildren) {
    if (node.type !== 'package_clause' && node.type !== 'package_object') continue;
    const body = node.namedChildren.find((c) => c.type === 'template_body');
    if (body === undefined) continue;
    if (node.type === 'package_object') {
      const name = node.childForFieldName('name')?.text;
      if (name !== undefined && !isNonPublic(node)) {
        out.push({ name, kind: 'object', line: lineOf(node), documented: documented(node) });
      }
    }
    out.push(...scope(body.namedChildren));
  }
  return out;
}
