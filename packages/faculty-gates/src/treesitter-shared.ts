/**
 * Shared types + node helpers for the multi-language doc-comment extractors
 * (CLM-0104). Lives in its own module so each per-language extractor file can
 * import these without a cycle through the {@link LANGS} registry. Pure AST
 * helpers over `web-tree-sitter` nodes — no I/O, no model.
 */
import type Parser from 'web-tree-sitter';

/** One public declaration and whether it carries a doc-comment (presence only). */
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
export function isAdjacentComment(
  prev: Parser.SyntaxNode | null,
  declRow: number,
  types: readonly string[],
): boolean {
  return prev !== null && types.includes(prev.type) && declRow - prev.endPosition.row <= 1;
}

/** The 1-based source line of a node (tree-sitter rows are 0-based). */
export function lineOf(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}

/** A short kind label from a node type (strip the grammar's decl/def suffix). */
export function kindOf(type: string): string {
  return type.replace(/_(declaration|definition|specifier|item|spec)$/, '');
}
