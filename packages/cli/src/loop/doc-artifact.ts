/**
 * The post-loop DOC ARTIFACT step (#107, CLM-0105). After the canonical loop
 * completes, this mines the doc-comments the deliverable's own code carries —
 * via the faculty-gates `mineExportedSymbols` scanner (the SAME AST machinery
 * the #65 doc-comment gate uses) — and writes a DERIVED `API.generated.md` into
 * the workspace. It is deterministic and model-free (mirrors the repo's own
 * docs-as-derived-artifacts pattern, #51, applied to the loop OUTPUT): the
 * artifact states only what the code's doc-comments say, never invented prose,
 * and marks undocumented exports honestly. Presence, never accuracy.
 *
 * A deliverable with no exported TS/JS symbols writes NOTHING (no empty file).
 */
import fs from 'node:fs';
import path from 'node:path';
import { mineExportedSymbols, type ExportedSymbol, type MinedFile } from '@kernloop/faculty-gates';

/** The generated artifact's filename — unambiguous so it never clobbers a
 * hand-written README/API doc in the deliverable. */
export const DOC_ARTIFACT_NAME = 'API.generated.md';

/** The outcome of the doc-artifact step (counts ride the report + audit). */
export interface DocArtifactResult {
  /** True when an artifact was written (false when there was nothing to mine). */
  readonly written: boolean;
  /** Workspace-relative artifact path, present only when `written`. */
  readonly path?: string;
  /** Total exported symbols mined across the deliverable. */
  readonly symbolCount: number;
  /** How many of them carry a non-empty doc-comment. */
  readonly documentedCount: number;
  /** Covered files the scanner left unparsed at its cumulative-byte budget
   * (#114) — surfaced honestly so a truncated mine never reads as complete. */
  readonly skippedForBudget?: number;
}

/** A short human label for a TS SyntaxKind name (e.g. `FunctionDeclaration`). */
function kindLabel(kind: string): string {
  const trimmed = kind.replace(/(Declaration|Signature|Statement)$/, '');
  return trimmed.toLowerCase();
}

/** True when a symbol carries a non-empty doc-comment. */
function isDocumented(sym: ExportedSymbol): boolean {
  return sym.doc !== null && sym.doc.trim().length > 0;
}

/** The doc-comment text collapsed to a single line for the API summary. */
function docSummary(doc: string): string {
  return doc.replace(/\s+/g, ' ').trim();
}

/** One symbol's bullet line: name + kind + its doc summary, or UNDOCUMENTED. */
function symbolLine(sym: ExportedSymbol): string {
  const head = `- \`${sym.name}\` (${kindLabel(sym.kind)})`;
  return isDocumented(sym)
    ? `${head} — ${docSummary(sym.doc as string)}`
    : `${head} — **UNDOCUMENTED**`;
}

/**
 * Render the mined symbols into a deterministic Markdown API doc — grouped by
 * file, SORTED by path (code-point order, locale-independent) so the artifact
 * is byte-stable regardless of the filesystem's `readdir` walk order; symbols
 * keep their source order within a file. Pure: same input, same bytes.
 */
export function renderApiDoc(mined: readonly MinedFile[]): string {
  const lines: string[] = [
    '# API (generated from doc-comments)',
    '',
    '> Derived deterministically from the deliverable’s exported declarations and',
    '> their doc-comments — no model wrote this. It reflects doc-comment PRESENCE,',
    '> never accuracy; `UNDOCUMENTED` marks an exported symbol with no doc-comment.',
    '',
  ];
  const ordered = [...mined].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  for (const { file, symbols } of ordered) {
    lines.push(`## ${file}`, '');
    for (const sym of symbols) lines.push(symbolLine(sym));
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Mine the deliverable's TS/JS doc-comments and write {@link DOC_ARTIFACT_NAME}
 * into `workspaceDir` (#107, CLM-0105). Returns the counts; writes NOTHING (and reports
 * `written: false`) when the deliverable exposes no TS/JS symbols. Never throws
 * on a write failure path used by callers that treat it as best-effort — the
 * caller decides; here a write error propagates so the loop can surface it.
 */
export function writeDocArtifact(workspaceDir: string): DocArtifactResult {
  const { files: mined, skippedForBudget } = mineExportedSymbols(workspaceDir);
  const symbolCount = mined.reduce((n, f) => n + f.symbols.length, 0);
  const documentedCount = mined.reduce((n, f) => n + f.symbols.filter(isDocumented).length, 0);
  if (symbolCount === 0) {
    return { written: false, symbolCount: 0, documentedCount: 0, skippedForBudget };
  }
  fs.writeFileSync(path.join(workspaceDir, DOC_ARTIFACT_NAME), renderApiDoc(mined), 'utf8');
  return { written: true, path: DOC_ARTIFACT_NAME, symbolCount, documentedCount, skippedForBudget };
}
