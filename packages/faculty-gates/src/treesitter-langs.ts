/**
 * The per-language declaration extractors behind the multi-language doc-comment
 * gate (Python/Go/Rust #108; Java/C/PHP/Ruby #122; CLM-0104). Each extractor
 * enumerates a source file's PUBLIC
 * top-level declarations and whether each carries an adjacent doc-comment —
 * presence, NEVER accuracy (the prime directive). "Public" is each language's
 * OWN visibility rule, and "documented" is its OWN doc convention:
 *
 *  - Python  — module-level `def`/`class` not starting `_`; docstring as the
 *              body's first statement.
 *  - Go      — top-level func/type/const/var with an uppercase-initial name; a
 *              comment on the line immediately above.
 *  - Rust    — items carrying a `pub` visibility modifier; a `///` outer-doc,
 *              block-doc, or `//` comment immediately above.
 *  - Java    — top-level types declared `public`; a Javadoc block or `//` above.
 *  - C       — non-`static` functions (definitions + header prototypes),
 *              `typedef` aliases, and struct/union/enum DEFINITIONS (a bodyless
 *              forward declaration is skipped); a comment above.
 *  - PHP     — top-level functions/classes/interfaces/traits/enums (all public);
 *              a PHPDoc block, `//`, or `#` comment above.
 *  - Ruby    — top-level `def`/`def self.x`/`class`/`module` (public by
 *              default); a `#` comment above.
 *
 * SCOPE — TOP-LEVEL ONLY. Each extractor enumerates a file's TOP-LEVEL
 * declarations; NESTED members (Java methods/fields, Ruby instance methods, PHP
 * class methods, brace-`namespace` bodies) are NOT yet enumerated — that
 * member-level descent is honestly deferred (#121). For Python/Go/Rust/C the
 * top level IS most of the public surface; for Java/Ruby the top-level type is
 * the documented entry point and its members await #121.
 *
 * Pure AST logic over `web-tree-sitter` nodes — no I/O, no model. The grammar
 * loading, byte budgets, and walk live in treesitter-scan.ts.
 */
import type Parser from 'web-tree-sitter';

/** One public top-level declaration and whether it carries a doc-comment. */
export interface Decl {
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  readonly documented: boolean;
}

/** A language the tree-sitter path covers: its display label, grammar filename,
 * and the extractor that enumerates its public declarations. */
export interface LangSpec {
  readonly label: string;
  readonly wasm: string;
  readonly extract: (root: Parser.SyntaxNode) => Decl[];
}

/** True for a comment node adjacent to (on the line above, no blank-line gap)
 * the declaration at `declRow` — the "doc comment immediately above" convention. */
function isAdjacentComment(
  prev: Parser.SyntaxNode | null,
  declRow: number,
  types: readonly string[],
): boolean {
  return prev !== null && types.includes(prev.type) && declRow - prev.endPosition.row <= 1;
}

/** The 1-based source line of a node (tree-sitter rows are 0-based). */
function lineOf(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}

/** A short kind label from a node type (strip the grammar's decl/def suffix). */
function kindOf(type: string): string {
  return type.replace(/_(declaration|definition|specifier|item|spec)$/, '');
}

/** Python: module-level `def`/`class` whose name is public (no leading `_`),
 * documented iff the body's first statement is a string expression (docstring). */
function extractPython(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    if (node.type !== 'function_definition' && node.type !== 'class_definition') continue;
    const name = node.childForFieldName('name')?.text;
    if (name === undefined || name.startsWith('_')) continue;
    const first = node.childForFieldName('body')?.firstNamedChild;
    const documented =
      first?.type === 'expression_statement' && first.firstNamedChild?.type === 'string';
    const kind = node.type === 'class_definition' ? 'class' : 'function';
    out.push({ name, kind, line: lineOf(node), documented });
  }
  return out;
}

/** True when a Go identifier is EXPORTED — its first character is an uppercase
 * letter (the Go spec's visibility rule), Unicode-aware. */
function isGoExported(name: string): boolean {
  return /^\p{Lu}/u.test(name);
}

/** One Go spec node (type_spec/const_spec/var_spec) → a Decl, doc taken from the
 * enclosing declaration's preceding comment (the whole decl shares one doc). */
function goSpecDecl(spec: Parser.SyntaxNode, kind: string, documented: boolean): Decl | null {
  const name = spec.childForFieldName('name')?.text;
  if (name === undefined || !isGoExported(name)) return null;
  return { name, kind, line: lineOf(spec), documented };
}

/** Go: top-level funcs/methods (named directly) and type/const/var declarations
 * (which wrap one or more specs); exported iff the name is uppercase-initial,
 * documented iff a comment sits on the line immediately above the declaration. */
function extractGo(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    const documented = isAdjacentComment(node.previousNamedSibling, node.startPosition.row, [
      'comment',
    ]);
    if (node.type === 'function_declaration' || node.type === 'method_declaration') {
      const name = node.childForFieldName('name')?.text;
      if (name !== undefined && isGoExported(name)) {
        out.push({ name, kind: 'function', line: lineOf(node), documented });
      }
    } else if (
      node.type === 'type_declaration' ||
      node.type === 'const_declaration' ||
      node.type === 'var_declaration'
    ) {
      const kind = node.type.replace('_declaration', '');
      for (const spec of node.namedChildren) {
        const decl = goSpecDecl(spec, kind, documented);
        if (decl !== null) out.push(decl);
      }
    }
  }
  return out;
}

/** The Rust top-level item types the gate enumerates. */
const RUST_ITEMS = new Set([
  'function_item',
  'struct_item',
  'enum_item',
  'trait_item',
  'mod_item',
  'const_item',
  'static_item',
  'type_item',
  'union_item',
  'macro_definition',
]);

/** Rust: top-level items carrying a `pub` visibility modifier, documented iff a
 * line or block comment (incl. `///` outer-doc and block-doc comments) sits
 * immediately above. */
function extractRust(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    if (!RUST_ITEMS.has(node.type)) continue;
    if (!node.namedChildren.some((c) => c.type === 'visibility_modifier')) continue;
    const name = node.childForFieldName('name')?.text;
    if (name === undefined) continue;
    const documented = isAdjacentComment(node.previousNamedSibling, node.startPosition.row, [
      'line_comment',
      'block_comment',
    ]);
    out.push({
      name,
      kind: node.type.replace('_item', '').replace('_definition', ''),
      line: lineOf(node),
      documented,
    });
  }
  return out;
}

/** The Java top-level type declarations the gate enumerates. */
const JAVA_TYPES = new Set([
  'class_declaration',
  'interface_declaration',
  'enum_declaration',
  'record_declaration',
  'annotation_type_declaration',
]);

/** Java: top-level types declared `public` (a non-public top-level type is
 * package-private, not public API), documented iff a `//` or Javadoc block
 * comment sits immediately above (Javadoc parses as a `block_comment`). */
function extractJava(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    if (!JAVA_TYPES.has(node.type)) continue;
    const mods = node.namedChildren.find((c) => c.type === 'modifiers');
    if (!/\bpublic\b/.test(mods?.text ?? '')) continue;
    const name = node.childForFieldName('name')?.text;
    if (name === undefined) continue;
    const documented = isAdjacentComment(node.previousNamedSibling, node.startPosition.row, [
      'line_comment',
      'block_comment',
    ]);
    out.push({ name, kind: kindOf(node.type), line: lineOf(node), documented });
  }
  return out;
}

/** Descend a C declarator chain (pointer/array wrappers) from `start` to the
 * innermost identifier — a function/variable name — or undefined. */
function cDeclaratorName(start: Parser.SyntaxNode | null): string | undefined {
  let d = start;
  while (d !== null && d.type !== 'identifier') {
    const next = d.childForFieldName('declarator');
    if (next === null) break;
    d = next;
  }
  return d?.type === 'identifier' ? d.text : undefined;
}

/** True when a node's declarator chain is (or wraps) a `function_declarator` —
 * i.e. it declares a function (a prototype/definition), not a variable. */
function isCFunctionDecl(node: Parser.SyntaxNode): boolean {
  let d = node.childForFieldName('declarator');
  while (d !== null) {
    if (d.type === 'function_declarator') return true;
    d = d.childForFieldName('declarator');
  }
  return false;
}

/** True when a C node carries the `static` storage class (internal linkage). */
function isCStatic(node: Parser.SyntaxNode): boolean {
  return node.namedChildren.some(
    (c) => c.type === 'storage_class_specifier' && c.text === 'static',
  );
}

/** The C type specifiers that name a tag (struct/union/enum). */
const C_TAG_SPECIFIERS = new Set(['struct_specifier', 'union_specifier', 'enum_specifier']);

/** One C top-level node → a Decl, or null when it is not a public declaration we
 * enumerate. Covers: non-`static` function definitions AND prototypes (the
 * header surface); `typedef` aliases; and struct/union/enum DEFINITIONS (a
 * bodyless forward declaration like `struct X;` is skipped — it is not the
 * documentable definition, and flagging it would be a false positive). */
function cDecl(node: Parser.SyntaxNode, documented: boolean): Decl | null {
  if (node.type === 'function_definition' || node.type === 'declaration') {
    if (!isCFunctionDecl(node) || isCStatic(node)) return null;
    const name = cDeclaratorName(node.childForFieldName('declarator'));
    return name === undefined ? null : { name, kind: 'function', line: lineOf(node), documented };
  }
  if (node.type === 'type_definition') {
    // The alias name is the type_definition's direct `type_identifier` child
    // (the inner struct tag, if any, is nested under the struct_specifier).
    const name = node.namedChildren.find((c) => c.type === 'type_identifier')?.text;
    return name === undefined ? null : { name, kind: 'typedef', line: lineOf(node), documented };
  }
  if (C_TAG_SPECIFIERS.has(node.type)) {
    const hasBody = node.namedChildren.some(
      (c) => c.type === 'field_declaration_list' || c.type === 'enumerator_list',
    );
    const name = node.childForFieldName('name')?.text;
    if (!hasBody || name === undefined) return null;
    return { name, kind: kindOf(node.type), line: lineOf(node), documented };
  }
  return null;
}

/** C: non-`static` functions (definitions + header prototypes), `typedef`
 * aliases, and named struct/union/enum DEFINITIONS, documented iff a comment
 * sits immediately above (a bodyless forward declaration is not enumerated). */
function extractC(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    const documented = isAdjacentComment(node.previousNamedSibling, node.startPosition.row, [
      'comment',
    ]);
    const decl = cDecl(node, documented);
    if (decl !== null) out.push(decl);
  }
  return out;
}

/** The PHP top-level declarations the gate enumerates (all public at file scope). */
const PHP_DECLS = new Set([
  'function_definition',
  'class_declaration',
  'interface_declaration',
  'trait_declaration',
  'enum_declaration',
]);

/** PHP: top-level functions/classes/interfaces/traits/enums (public at file
 * scope), documented iff a PHPDoc block, `//`, or `#` comment sits above. */
function extractPhp(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    if (!PHP_DECLS.has(node.type)) continue;
    const name = node.childForFieldName('name')?.text;
    if (name === undefined) continue;
    const documented = isAdjacentComment(node.previousNamedSibling, node.startPosition.row, [
      'comment',
    ]);
    out.push({ name, kind: kindOf(node.type), line: lineOf(node), documented });
  }
  return out;
}

/** The Ruby top-level declarations the gate enumerates (`singleton_method` is
 * `def self.x`). NESTED instance methods are NOT enumerated — that is member
 * level, honestly deferred (see CLM-0104's top-level boundary). */
const RUBY_DECLS = new Set(['method', 'singleton_method', 'class', 'module']);

/** Ruby: top-level `def`/`def self.x`/`class`/`module` (public by default at
 * file scope), documented iff a `#` comment sits immediately above. */
function extractRuby(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    if (!RUBY_DECLS.has(node.type)) continue;
    const name = node.childForFieldName('name')?.text;
    if (name === undefined) continue;
    const documented = isAdjacentComment(node.previousNamedSibling, node.startPosition.row, [
      'comment',
    ]);
    out.push({ name, kind: node.type, line: lineOf(node), documented });
  }
  return out;
}

/** Extension → language spec for every tree-sitter-covered source language —
 * the binding the doc-comment gate enumerates against [CLM-0104]. */
export const LANGS: Record<string, LangSpec> = {
  '.py': { label: 'Python', wasm: 'tree-sitter-python.wasm', extract: extractPython },
  '.go': { label: 'Go', wasm: 'tree-sitter-go.wasm', extract: extractGo },
  '.rs': { label: 'Rust', wasm: 'tree-sitter-rust.wasm', extract: extractRust },
  '.java': { label: 'Java', wasm: 'tree-sitter-java.wasm', extract: extractJava },
  '.c': { label: 'C', wasm: 'tree-sitter-c.wasm', extract: extractC },
  '.h': { label: 'C', wasm: 'tree-sitter-c.wasm', extract: extractC },
  '.php': { label: 'PHP', wasm: 'tree-sitter-php.wasm', extract: extractPhp },
  '.rb': { label: 'Ruby', wasm: 'tree-sitter-ruby.wasm', extract: extractRuby },
};
