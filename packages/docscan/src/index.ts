/**
 * @kernloop/docscan — in-process STATIC SOURCE ANALYSIS for the quality gate
 * (spec §5.3). Extracted from faculty-gates (#255): a check-providing library,
 * not a gate. Two model-free scanners over a (possibly untrusted) workspace,
 * sharing one no-symlink-follow walk + byte budgets ({@link module:docscan/fs-walk}):
 *  - DOC-COMMENT coverage (CLM-0104): gates undocumented exported symbols across
 *    languages (TypeScript via the `typescript` compiler API; Python/Go/Rust/…
 *    via vendored tree-sitter WASM grammars) + the symbol-mining the documenter
 *    uses to derive a deliverable's API docs.
 *  - SECURITY smells (#277): a curated, high-confidence, advisory signal over
 *    generated code (dynamic eval/Function, shell-command injection, known-format
 *    hardcoded secrets) — see {@link scanSecuritySmells}.
 */
export {
  scanDocComments,
  listExportedSymbols,
  mineExportedSymbols,
  type ExportedSymbol,
  type MinedFile,
  type MinedResult,
} from './doc-scan.js';
export { scanSecuritySmells } from './security-scan.js';
export { scanWrittenCoverage, hasExecutableCode, type WrittenFile } from './coverage-scan.js';
