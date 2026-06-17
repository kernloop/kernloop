/**
 * Java doc-comment extractor (#122 top-level; #121 members; #181 member-of-member).
 * Top-level types declared `public` are enumerated (a non-public top-level type
 * is package-private, not public API), each with its public methods + fields, and
 * a nested public type is itself enumerated and its OWN members descended
 * recursively. "Documented" is a `//` line or Javadoc `block_comment` on the line
 * immediately above. Split from treesitter-langs.ts to keep that catch-all under
 * its per-file LOC budget; mirrors the per-language extractor files.
 *
 * Pure AST logic over `web-tree-sitter` nodes — no I/O, no model.
 */
import type Parser from 'web-tree-sitter';
import { isAdjacentComment, kindOf, lineOf, type Decl } from './treesitter-shared.js';

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

/** Public methods + fields inside an enumerated type's `body` (#121), plus each
 * nested public type and ITS members descended recursively (#181). A
 * `field_declaration` may declare several names — each public variable is its own
 * undocumented surface. (Enum/record members under an inner declarations node are
 * a distinct deferral.) */
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
    } else if (JAVA_TYPES.has(node.type)) {
      const name = node.childForFieldName('name')?.text;
      if (name !== undefined) {
        out.push({
          name,
          kind: kindOf(node.type),
          line: lineOf(node),
          documented: javaDocumented(node),
        });
        out.push(...javaMembers(node)); // a nested type (#181)
      }
    }
  }
  return out;
}

/** Java: top-level types declared `public` (a non-public top-level type is
 * package-private, not public API), documented iff a `//` or Javadoc block
 * comment sits immediately above (Javadoc parses as a `block_comment`), PLUS
 * each type's public methods and fields (#121) and any nested type (#181). */
export function extractJava(root: Parser.SyntaxNode): Decl[] {
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
