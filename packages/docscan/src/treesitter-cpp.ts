/**
 * The C++ declaration extractor behind the multi-language doc-comment gate
 * (CLM-0104), a sibling of the C extractor in treesitter-langs.ts. It enumerates
 * a `.cpp`/`.hpp` file's PUBLIC declarations — functions, defined
 * class/struct/enum types, typedef aliases, and each defined class/struct's
 * PUBLIC members — reporting whether each carries an adjacent doc-comment:
 * presence, NEVER accuracy (the prime directive).
 *
 * C++ shares C's grammar core, so the function/typedef/tag logic mirrors the C
 * extractor (those helpers are private to treesitter-langs.ts, so the small ones
 * are re-implemented here rather than imported):
 *
 *  - A non-`static` `function_definition` or prototype `declaration` whose
 *    declarator chain reaches a `function_declarator` is a public function; its
 *    name is the innermost `identifier`.
 *  - A `type_definition` is a `typedef` alias; its name is the `declarator`'s
 *    `type_identifier`.
 *  - A `class_specifier`/`struct_specifier`/`enum_specifier` is enumerated only
 *    when it is a DEFINITION (carries a `field_declaration_list`/`enumerator_list`
 *    body). A bodyless forward declaration (`class X;`) is skipped — it is not the
 *    documentable definition, and flagging it would be a false positive.
 *
 * NAMESPACES are descended, not enumerated: `namespace_definition` wraps a
 * `declaration_list` body, possibly nested, and is not itself a documentable
 * decl — we recurse through it to reach the same file-scope decl kinds. An
 * ANONYMOUS namespace (no `name` field) gives its contents internal linkage, so
 * its body is skipped, exactly like a `static` function.
 *
 * MEMBERS. Inside a `class`/`struct` body, members live under `access_specifier`
 * sections; a `struct` defaults to PUBLIC, a `class` to PRIVATE. We track the
 * current access (flipping on each `access_specifier`) and enumerate only PUBLIC,
 * non-`static` methods (`field_declaration` reaching a `function_declarator`) and
 * data fields (each `field_identifier`). A nested type inside a class body is
 * itself enumerated and its own members descended recursively (#181).
 *
 * "documented" is C++'s doc convention: a `comment` node (covering both the
 * block-comment and `//` line-comment forms) on the line immediately above.
 *
 * Pure AST logic over `web-tree-sitter` nodes — no I/O, no model. The grammar
 * loading, byte budgets, and walk live in treesitter-scan.ts.
 */
import type Parser from 'web-tree-sitter';
import { isAdjacentComment, lineOf, kindOf, type Decl } from './treesitter-shared.js';

/** Descend a declarator chain (pointer/array/function wrappers) from `start` to
 * the innermost name node — an `identifier` (free function) or `field_identifier`
 * (member) — or undefined. */
function cppDeclaratorName(start: Parser.SyntaxNode | null): string | undefined {
  let d = start;
  while (d !== null && d.type !== 'identifier' && d.type !== 'field_identifier') {
    const next = d.childForFieldName('declarator');
    if (next === null) break;
    d = next;
  }
  return d?.type === 'identifier' || d?.type === 'field_identifier' ? d.text : undefined;
}

/** True when a node's declarator chain is (or wraps) a `function_declarator` —
 * i.e. it declares a function (a prototype/definition/method), not a variable. */
function cppIsFunctionDecl(node: Parser.SyntaxNode): boolean {
  let d = node.childForFieldName('declarator');
  while (d !== null) {
    if (d.type === 'function_declarator') return true;
    d = d.childForFieldName('declarator');
  }
  return false;
}

/** True when a node carries the `static` storage class (internal linkage at file
 * scope; non-instance, non-API at class scope). */
function cppIsStatic(node: Parser.SyntaxNode): boolean {
  return node.namedChildren.some(
    (c) => c.type === 'storage_class_specifier' && c.text === 'static',
  );
}

/** Whether a node carries a block or `//` line comment on the line immediately
 * above (both forms parse as a `comment` node). */
function cppDocumented(node: Parser.SyntaxNode): boolean {
  return isAdjacentComment(node.previousNamedSibling, node.startPosition.row, ['comment']);
}

/** The C++ type specifiers that name a tag (struct/class/union/enum). */
const CPP_TAG_SPECIFIERS = new Set([
  'struct_specifier',
  'class_specifier',
  'union_specifier',
  'enum_specifier',
]);

/** The class/struct/union specifiers whose PUBLIC members are also enumerated. */
const CPP_MEMBER_OWNERS = new Set(['struct_specifier', 'class_specifier', 'union_specifier']);

/** Public, non-`static` members inside a defined class/struct/union body. Members
 * sit under `access_specifier` sections; a `struct`/`union` starts PUBLIC, a
 * `class` starts PRIVATE, and each `access_specifier` flips the current access.
 * A method is a `field_declaration` reaching a `function_declarator`; a data
 * field is a `field_declaration` declaring one or more `field_identifier`s (each
 * its own undocumented surface). A nested type (a `field_declaration` wrapping a
 * tag specifier) is itself enumerated and its OWN members descended (#181). */
function cppMembers(owner: Parser.SyntaxNode, body: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  let pub = owner.type !== 'class_specifier'; // struct/union default public; class default private
  for (const node of body.namedChildren) {
    if (node.type === 'access_specifier') {
      const label = node.text.replace(/[^a-z]/gi, '');
      pub = label === 'public';
      continue;
    }
    if (!pub || node.type !== 'field_declaration' || cppIsStatic(node)) continue;
    const documented = cppDocumented(node);
    // A nested type (#181): the field_declaration wraps a class/struct/union/enum
    // specifier. Enumerate it and descend ITS members — the doc-comment sits above
    // the wrapping field_declaration, so reuse this node's `documented`.
    const nested = node.namedChildren.find((c) => CPP_TAG_SPECIFIERS.has(c.type));
    if (nested !== undefined) {
      const nbody = nested.namedChildren.find(
        (c) => c.type === 'field_declaration_list' || c.type === 'enumerator_list',
      );
      const nname = nested.childForFieldName('name')?.text;
      if (nbody !== undefined && nname !== undefined) {
        out.push({ name: nname, kind: kindOf(nested.type), line: lineOf(nested), documented });
        if (CPP_MEMBER_OWNERS.has(nested.type)) out.push(...cppMembers(nested, nbody));
      }
      continue;
    }
    if (cppIsFunctionDecl(node)) {
      const name = cppDeclaratorName(node.childForFieldName('declarator'));
      if (name !== undefined) out.push({ name, kind: 'method', line: lineOf(node), documented });
      continue;
    }
    for (const id of node.namedChildren.filter((c) => c.type === 'field_identifier')) {
      out.push({ name: id.text, kind: 'field', line: lineOf(node), documented });
    }
  }
  return out;
}

/** One file/namespace-scope node → its Decls (a list, since a class also yields
 * its members), or empty when it is not a public declaration we enumerate. */
function cppDecl(node: Parser.SyntaxNode): Decl[] {
  const documented = cppDocumented(node);
  if (node.type === 'function_definition' || node.type === 'declaration') {
    if (!cppIsFunctionDecl(node) || cppIsStatic(node)) return [];
    const name = cppDeclaratorName(node.childForFieldName('declarator'));
    return name === undefined ? [] : [{ name, kind: 'function', line: lineOf(node), documented }];
  }
  if (node.type === 'type_definition') {
    const name = node.childForFieldName('declarator')?.text;
    return name === undefined ? [] : [{ name, kind: 'typedef', line: lineOf(node), documented }];
  }
  if (CPP_TAG_SPECIFIERS.has(node.type)) {
    const body = node.namedChildren.find(
      (c) => c.type === 'field_declaration_list' || c.type === 'enumerator_list',
    );
    const name = node.childForFieldName('name')?.text;
    if (body === undefined || name === undefined) return []; // bodyless forward decl
    const out: Decl[] = [{ name, kind: kindOf(node.type), line: lineOf(node), documented }];
    if (CPP_MEMBER_OWNERS.has(node.type)) out.push(...cppMembers(node, body));
    return out;
  }
  return [];
}

/** Collect the public Decls reachable from one file/namespace-scope node into
 * `out`. A `namespace_definition` is descended (not emitted); an anonymous
 * namespace (no `name` field) gives internal linkage, so its body is skipped. */
function collectCpp(node: Parser.SyntaxNode, out: Decl[]): void {
  if (node.type === 'namespace_definition') {
    if (node.childForFieldName('name') === null) return; // anonymous → internal linkage
    const body = node.childForFieldName('body');
    if (body !== null) for (const child of body.namedChildren) collectCpp(child, out);
    return;
  }
  out.push(...cppDecl(node));
}

/** C++: non-`static` functions, defined class/struct/union/enum types, `typedef`
 * aliases, and each defined class/struct/union's PUBLIC members — at file scope
 * and inside any named namespace — documented iff a block or `//` line comment
 * sits immediately above (a bodyless forward declaration and an anonymous
 * namespace's contents are not enumerated). */
export function extractCpp(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) collectCpp(node, out);
  return out;
}
