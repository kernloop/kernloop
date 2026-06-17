/**
 * @kernloop/docscan — the doc-comment scanner (spec §5.3, CLM-0104). Extracted
 * from faculty-gates (#255): a check-providing library, not a gate. Exposes the
 * in-process scanner that gates undocumented exported symbols across languages
 * (TypeScript via the `typescript` compiler API; Python/Go/Rust/Ruby/Java/…
 * via vendored tree-sitter WASM grammars) plus the symbol-mining used by the
 * documenter to derive a deliverable's API docs.
 */
export {
  scanDocComments,
  listExportedSymbols,
  mineExportedSymbols,
  type ExportedSymbol,
  type MinedFile,
  type MinedResult,
} from './doc-scan.js';
