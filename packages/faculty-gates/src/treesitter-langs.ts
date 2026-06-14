/**
 * The per-language declaration extractors behind the multi-language doc-comment
 * gate (Python/Go/Rust #108; Java/C/PHP/Ruby #122; C++/C#/Kotlin/Swift/Scala
 * #120; CLM-0104). This file holds the original seven; the five large-grammar
 * languages live in sibling `treesitter-<lang>.ts` files and are merged into
 * {@link LANGS} here. Each extractor enumerates a source file's PUBLIC
 * declarations and whether each carries an adjacent doc-comment — presence,
 * NEVER accuracy (the prime directive). "Public" is each language's OWN
 * visibility rule, and "documented" is its OWN doc convention:
 *
 *  - Python  — module-level `def`/`class` not starting `_`; docstring as the
 *              body's first statement.
 *  - Go      — top-level func/type/const/var with an uppercase-initial name; a
 *              comment on the line immediately above.
 *  - Rust    — items carrying a `pub` visibility modifier; a `///` outer-doc,
 *              block-doc, or `//` comment immediately above.
 *  - Java    — top-level types declared `public` PLUS each type's public methods
 *              and fields (#121); a Javadoc block or `//` above.
 *  - C       — non-`static` functions (definitions + header prototypes),
 *              `typedef` aliases, and struct/union/enum DEFINITIONS (a bodyless
 *              forward declaration is skipped); a comment above.
 *  - PHP     — top-level functions/classes/interfaces/traits/enums (all public)
 *              PLUS each class/interface/trait's public methods (default
 *              visibility is public; #121); a PHPDoc block, `//`, or `#` above.
 *  - Ruby    — top-level `def`/`def self.x`/`class`/`module` (public by
 *              default) PLUS each class/module's public instance methods,
 *              tracking the stateful `private`/`protected` directives (#150);
 *              a `#` comment above.
 *
 * The five #120 languages (own files): C++ (C-like + named-namespace descent +
 * class/struct access tracking), C# (`public` only, namespace descent, members),
 * Kotlin + Scala (public-by-default, members), Swift (`public`/`open` only).
 *
 * SCOPE. Python/Go/Rust/C enumerate the TOP LEVEL; Java/PHP/C#/C++/Kotlin/Scala/
 * Swift/Ruby ALSO descend one level into a type's PUBLIC members (#121/#120/#150);
 * C#/C++ descend named namespaces. Still deferred (#150): Ruby's arg-form
 * visibility (`private :x`) and brace-`namespace` member bodies.
 *
 * Pure AST logic over `web-tree-sitter` nodes — no I/O, no model. The grammar
 * loading, byte budgets, and walk live in treesitter-scan.ts.
 */
import type Parser from 'web-tree-sitter';
import {
  isAdjacentComment,
  kindOf,
  lineOf,
  type Decl,
  type LangSpec,
} from './treesitter-shared.js';
import { extractRuby } from './treesitter-ruby.js';
import { extractCSharp } from './treesitter-csharp.js';
import { extractScala } from './treesitter-scala.js';
import { extractKotlin } from './treesitter-kotlin.js';
import { extractCpp } from './treesitter-cpp.js';
import { extractSwift } from './treesitter-swift.js';

export type { Decl, LangSpec } from './treesitter-shared.js';

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

/** True iff a Java node's `modifiers` child declares `public`. */
function javaIsPublic(node: Parser.SyntaxNode): boolean {
  const mods = node.namedChildren.find((c) => c.type === 'modifiers');
  return /\bpublic\b/.test(mods?.text ?? '');
}

/** Whether a Java member carries a `//`-line or Javadoc-`block_comment` above it. */
function javaDocumented(node: Parser.SyntaxNode): boolean {
  return isAdjacentComment(node.previousNamedSibling, node.startPosition.row, [
    'line_comment',
    'block_comment',
  ]);
}

/** Public methods + fields inside an enumerated type's `body` (#121). Covers
 * class/interface bodies; enum/record members nest under an inner declarations
 * node and are not yet descended (honestly deferred). A `field_declaration` may
 * declare several names — each public variable is its own undocumented surface. */
function javaMembers(typeNode: Parser.SyntaxNode): Decl[] {
  const body = typeNode.childForFieldName('body');
  if (body === null) return [];
  const out: Decl[] = [];
  for (const node of body.namedChildren) {
    if (!javaIsPublic(node)) continue;
    if (node.type === 'method_declaration') {
      const name = node.childForFieldName('name')?.text;
      if (name !== undefined)
        out.push({ name, kind: 'method', line: lineOf(node), documented: javaDocumented(node) });
    } else if (node.type === 'field_declaration') {
      for (const d of node.namedChildren.filter((c) => c.type === 'variable_declarator')) {
        const name = d.childForFieldName('name')?.text;
        if (name !== undefined)
          out.push({ name, kind: 'field', line: lineOf(node), documented: javaDocumented(node) });
      }
    }
  }
  return out;
}

/** Java: top-level types declared `public` (a non-public top-level type is
 * package-private, not public API), documented iff a `//` or Javadoc block
 * comment sits immediately above (Javadoc parses as a `block_comment`), PLUS
 * each type's public methods and fields (#121). */
function extractJava(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) {
    if (!JAVA_TYPES.has(node.type)) continue;
    if (!javaIsPublic(node)) continue;
    const name = node.childForFieldName('name')?.text;
    if (name === undefined) continue;
    out.push({
      name,
      kind: kindOf(node.type),
      line: lineOf(node),
      documented: javaDocumented(node),
    });
    out.push(...javaMembers(node));
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

/** Public methods inside a PHP class/interface/trait body (#121). A method with
 * NO `visibility_modifier` is public (PHP's default); `private`/`protected` are
 * skipped — flagging them would demand docs on non-public surface. */
function phpMembers(classNode: Parser.SyntaxNode): Decl[] {
  const body = classNode.namedChildren.find((c) => c.type === 'declaration_list');
  if (body === undefined) return [];
  const out: Decl[] = [];
  for (const node of body.namedChildren) {
    if (node.type !== 'method_declaration') continue;
    const vis = node.namedChildren.find((c) => c.type === 'visibility_modifier')?.text;
    if (vis !== undefined && vis !== 'public') continue;
    const name = node.childForFieldName('name')?.text;
    if (name === undefined) continue;
    const documented = isAdjacentComment(node.previousNamedSibling, node.startPosition.row, [
      'comment',
    ]);
    out.push({ name, kind: 'method', line: lineOf(node), documented });
  }
  return out;
}

/** The PHP container declarations whose public methods are also enumerated. */
const PHP_CONTAINERS = new Set(['class_declaration', 'interface_declaration', 'trait_declaration']);

/** Recurse one PHP node: descend a BRACED `namespace Foo { … }` body into the
 * decls (and their public methods) it nests (#170), else enumerate a top-level
 * function/class/interface/trait/enum + its public methods. A file-scoped
 * `namespace Foo;` carries no body — its decls are root siblings already walked
 * here — and PHP namespaces are always named, so there is no anonymous form to
 * skip. Documented iff a PHPDoc block, `//`, or `#` comment sits immediately
 * above the decl (inside the namespace body when nested). */
function collectPhp(node: Parser.SyntaxNode, out: Decl[]): void {
  if (node.type === 'namespace_definition') {
    const body = node.childForFieldName('body');
    if (body !== null) for (const child of body.namedChildren) collectPhp(child, out);
    return;
  }
  if (!PHP_DECLS.has(node.type)) return;
  const name = node.childForFieldName('name')?.text;
  if (name === undefined) return;
  const documented = isAdjacentComment(node.previousNamedSibling, node.startPosition.row, [
    'comment',
  ]);
  out.push({ name, kind: kindOf(node.type), line: lineOf(node), documented });
  if (PHP_CONTAINERS.has(node.type)) out.push(...phpMembers(node));
}

/** PHP: top-level functions/classes/interfaces/traits/enums (public at file
 * scope), documented iff a PHPDoc block, `//`, or `#` comment sits above, PLUS
 * each class/interface/trait's public methods (#121) — descending braced
 * `namespace` blocks so a namespaced type's members are reached too (#170). */
function extractPhp(root: Parser.SyntaxNode): Decl[] {
  const out: Decl[] = [];
  for (const node of root.namedChildren) collectPhp(node, out);
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
  '.cs': { label: 'C#', wasm: 'tree-sitter-c_sharp.wasm', extract: extractCSharp },
  '.scala': { label: 'Scala', wasm: 'tree-sitter-scala.wasm', extract: extractScala },
  '.sc': { label: 'Scala', wasm: 'tree-sitter-scala.wasm', extract: extractScala },
  '.kt': { label: 'Kotlin', wasm: 'tree-sitter-kotlin.wasm', extract: extractKotlin },
  '.kts': { label: 'Kotlin', wasm: 'tree-sitter-kotlin.wasm', extract: extractKotlin },
  '.cpp': { label: 'C++', wasm: 'tree-sitter-cpp.wasm', extract: extractCpp },
  '.cc': { label: 'C++', wasm: 'tree-sitter-cpp.wasm', extract: extractCpp },
  '.cxx': { label: 'C++', wasm: 'tree-sitter-cpp.wasm', extract: extractCpp },
  '.hpp': { label: 'C++', wasm: 'tree-sitter-cpp.wasm', extract: extractCpp },
  '.hh': { label: 'C++', wasm: 'tree-sitter-cpp.wasm', extract: extractCpp },
  '.swift': { label: 'Swift', wasm: 'tree-sitter-swift.wasm', extract: extractSwift },
};
