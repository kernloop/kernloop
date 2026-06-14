/**
 * Ruby doc-comment extractor (#122; member descent #150). Top-level
 * `def`/`def self.x`/`class`/`module` are public by default at file scope; each
 * class/module ALSO has its public instance methods enumerated, tracking Ruby's
 * STATEFUL `private`/`protected` visibility directives down the body. Pure AST
 * logic over `web-tree-sitter` nodes; the shared helpers live in
 * treesitter-shared.ts and the grammar/scan in treesitter-scan.ts.
 */
import type Parser from 'web-tree-sitter';
import { isAdjacentComment, lineOf, type Decl } from './treesitter-shared.js';

/** The Ruby top-level declarations the gate enumerates (`singleton_method` is
 * `def self.x`); each class/module's public instance methods are added by
 * {@link rubyMembers}. */
const RUBY_DECLS = new Set(['method', 'singleton_method', 'class', 'module']);

/** Public instance methods inside a class/module body, tracking Ruby's STATEFUL
 * visibility directives (#150): instance methods are public by default, a bare
 * `private`/`protected` flips all SUBSEQUENT defs non-public, and a bare `public`
 * flips them back. (The arg forms `private :x` / `private def x` are not yet
 * handled — they parse as calls, not bare identifiers, so they neither flip the
 * state nor are caught; honestly deferred.) `singleton_method`s (`def self.x`)
 * are already enumerated at the top level and skipped here. */
function rubyMembers(container: Parser.SyntaxNode): Decl[] {
  const body = container.namedChildren.find((c) => c.type === 'body_statement');
  if (body === undefined) return [];
  const out: Decl[] = [];
  let visible = true;
  for (const child of body.namedChildren) {
    if (child.type === 'identifier') {
      if (child.text === 'private' || child.text === 'protected') visible = false;
      else if (child.text === 'public') visible = true;
    } else if (child.type === 'method' && visible) {
      const name = child.childForFieldName('name')?.text;
      if (name !== undefined) {
        // A member's `#` doc sits inside the body (its prev sibling) — but the
        // FIRST member's doc lands OUTSIDE the body, as `body_statement`'s prev
        // sibling (a child of the class); fall back to it when the method opens
        // the body (Ruby grammar quirk).
        const prev = child.previousNamedSibling ?? body.previousNamedSibling;
        const documented = isAdjacentComment(prev, child.startPosition.row, ['comment']);
        out.push({ name, kind: 'method', line: lineOf(child), documented });
      }
    }
  }
  return out;
}

/** Ruby: top-level `def`/`def self.x`/`class`/`module` (public by default at
 * file scope), documented iff a `#` comment sits immediately above, PLUS each
 * class/module's public instance methods (#150, visibility-aware). */
export function extractRuby(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    if (!RUBY_DECLS.has(node.type)) continue;
    const name = node.childForFieldName('name')?.text;
    if (name === undefined) continue;
    const documented = isAdjacentComment(node.previousNamedSibling, node.startPosition.row, [
      'comment',
    ]);
    out.push({ name, kind: node.type, line: lineOf(node), documented });
    if (node.type === 'class' || node.type === 'module') out.push(...rubyMembers(node));
  }
  return out;
}
