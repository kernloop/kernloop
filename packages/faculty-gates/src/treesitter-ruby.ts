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

/** The bare/arg-form visibility directive names Ruby tracks for instance methods. */
const VIS_DIRECTIVES = new Set(['private', 'protected', 'public']);

/** Build a method Decl, resolving its `#` doc. A member's doc sits inside the body
 * (its prev sibling) — but the FIRST member's doc lands OUTSIDE the body, as
 * `body_statement`'s prev sibling (a child of the class); fall back to it when the
 * member opens the body (Ruby grammar quirk). */
function methodDecl(node: Parser.SyntaxNode, name: string, body: Parser.SyntaxNode): Decl {
  const prev = node.previousNamedSibling ?? body.previousNamedSibling;
  const documented = isAdjacentComment(prev, node.startPosition.row, ['comment']);
  return { name, kind: 'method', line: lineOf(node), documented };
}

/** Apply a Ruby arg-form visibility call — `private :foo` / `protected :foo` /
 * `public :foo` / `private def foo` (#165). These parse as a `call`
 * (`identifier` + `argument_list`) and set the NAMED method's visibility, NOT
 * subsequent ones, so they retro-adjust what the bare-directive loop enumerated:
 * a private/protected target is dropped; a public target is (re)enumerated. */
function applyArgForm(call: Parser.SyntaxNode, body: Parser.SyntaxNode, out: Decl[]): void {
  const callee = call.namedChildren[0];
  if (callee?.type !== 'identifier' || !VIS_DIRECTIVES.has(callee.text)) return;
  const makePublic = callee.text === 'public';
  const args = call.namedChildren.find((c) => c.type === 'argument_list');
  for (const arg of args?.namedChildren ?? []) {
    const target = arg.type === 'method' ? arg : call; // doc anchors to an inline def
    const name =
      arg.type === 'simple_symbol'
        ? arg.text.replace(/^:/, '')
        : arg.type === 'method'
          ? arg.childForFieldName('name')?.text
          : undefined;
    if (name === undefined) continue;
    const at = out.findIndex((d) => d.kind === 'method' && d.name === name);
    if (at >= 0) out.splice(at, 1); // supersede any bare-directive enumeration
    if (makePublic) out.push(methodDecl(target, name, body));
  }
}

/** Public instance methods inside a class/module body, tracking Ruby's STATEFUL
 * visibility directives (#150): instance methods are public by default, a bare
 * `private`/`protected` flips all SUBSEQUENT defs non-public, and a bare `public`
 * flips them back. The arg forms (`private :x` / `private def x`) target a single
 * named method and are reconciled by {@link applyArgForm} (#165).
 * `singleton_method`s (`def self.x`) are enumerated at the top level, skipped here. */
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
      if (name !== undefined) out.push(methodDecl(child, name, body));
    } else if (child.type === 'call') {
      applyArgForm(child, body, out);
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
