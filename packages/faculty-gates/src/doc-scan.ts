/**
 * The in-process doc-comment scanner for the quality gate (#65; CLM-0104).
 * Unlike the subprocess checks (which run the workspace's own pnpm scripts),
 * this check parses generated source IN-PROCESS via the `typescript` compiler
 * API and flags every EXPORTED top-level declaration that carries no leading
 * doc-comment. A documented public surface is a quality bar on the code the
 * canonical loop PRODUCES; an undocumented export is an `error` finding so the
 * per-child iteration loop (#48) re-runs the coder until the docs are present.
 *
 * SCOPE, stated honestly (the prime directive): this proves a doc-comment is
 * PRESENT and non-empty — never that it is ACCURATE. Accuracy is a judgment a
 * mechanical scan cannot make; only a reviewer/test can. And it covers only
 * TypeScript/JavaScript: a known source language it cannot yet parse (Python,
 * Go, Rust, …) degrades HONESTLY — one non-blocking `info` finding records the
 * gap rather than silently passing the files. Non-code files are out of scope
 * and skipped. The AST logic mirrors `claims/src/symbols.ts` (the quarry
 * pattern: reimplement against this consumer, not a cross-package import — a
 * runtime faculty must not depend on the private claims tooling package).
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Finding } from '@kernloop/contracts';

/** File extensions this scanner parses with the TS compiler API (covered). */
const COVERED_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/** Known SOURCE languages the scanner cannot yet parse — recorded, not faked.
 * Maps extension → language label for the honest-degradation finding. */
const UNCOVERED_LANGS: Record<string, string> = {
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cs': 'C#',
  '.php': 'PHP',
  '.scala': 'Scala',
};

/** Directories never walked: build output, deps, VCS, coverage artifacts
 * (incl. other-language build dirs, so their compiled sources never inflate
 * the degradation counts). */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '.turbo',
  'target',
  'vendor',
  'out',
  '.next',
]);

/** Largest single file the scanner will parse; a larger one is recorded and
 * skipped, never read — `ts.createSourceFile` cost is superlinear, and this
 * runs IN-PROCESS on model-generated content, so an unbounded parse could
 * block or OOM the whole loop (the runner's timeout cannot interrupt
 * synchronous work). */
const MAX_FILE_BYTES = 1_000_000;
/** Total bytes the scan will parse before truncating (recorded, not silent),
 * bounding the many-files case the per-file cap alone would not. */
const MAX_TOTAL_BYTES = 32_000_000;

/** Recursively collect file paths under `dir`, skipping {@link SKIP_DIRS}.
 * Uses `Dirent.isDirectory`/`isFile`, which report the lstat type and do NOT
 * follow symlinks — so a symlink (to `/etc`, a loop, anywhere) is neither
 * recursed into nor read. Do not switch to `statSync` here: that follows
 * symlinks and would reintroduce a filesystem-escape on untrusted workspaces. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** One exported, named top-level declaration with its doc-comment presence. */
export interface ExportedSymbol {
  readonly name: string;
  readonly kind: string;
  readonly doc: string | null;
  readonly line: number;
}

/** One scanned source file and the exported symbols it declares (#107). */
export interface MinedFile {
  /** Workspace-relative path of the file. */
  readonly file: string;
  /** Its exported top-level declarations, in source order. */
  readonly symbols: readonly ExportedSymbol[];
}

/** The name a top-level declaration binds, or undefined if it is not one we
 * enumerate (functions, classes, interfaces, type aliases, enums, and
 * `const`/`let` variable declarations with an identifier name). */
function declaredName(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name !== undefined && ts.isIdentifier(node.name) ? node.name.text : undefined;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return undefined;
}

/** True when a declaration (or its host variable statement) is `export`ed. */
function hasExportModifier(node: ts.Node): boolean {
  const host =
    ts.isVariableDeclaration(node) && node.parent?.parent !== undefined ? node.parent.parent : node;
  if (!ts.canHaveModifiers(host)) return false;
  return (ts.getModifiers(host) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Leading doc-comment text of a declaration (JSDoc block or leading comment
 * range), or undefined when it carries none. The variable-declaration case
 * lifts to the enclosing `VariableStatement`, where the JSDoc attaches. */
function leadingDoc(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const host =
    ts.isVariableDeclaration(node) && node.parent?.parent !== undefined ? node.parent.parent : node;
  const jsDocText = ts
    .getJSDocCommentsAndTags(host)
    .map((d) => (typeof d.comment === 'string' ? d.comment : ts.getTextOfJSDocComment(d.comment)))
    .filter((c): c is string => c !== undefined && c.length > 0)
    .join('\n');
  if (jsDocText.length > 0) return jsDocText;
  const full = sourceFile.getFullText();
  const ranges = ts.getLeadingCommentRanges(full, host.getFullStart()) ?? [];
  const text = ranges
    .map((r) => full.slice(r.pos, r.end))
    .join('\n')
    .trim();
  return text.length > 0 ? text : undefined;
}

/** Direct top-level declarations of a source file (variable statements expand
 * to their individual declarations, where the export/JSDoc live). */
function topLevelDeclarations(sourceFile: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = [];
  sourceFile.forEachChild((node) => {
    if (ts.isVariableStatement(node)) {
      out.push(...node.declarationList.declarations);
    } else if (declaredName(node) !== undefined) {
      out.push(node);
    }
  });
  return out;
}

/** Enumerate the EXPORTED, named top-level declarations of one source file and
 * each one's doc-comment presence. Pure: reads and parses the file once. */
export function listExportedSymbols(filePath: string): ExportedSymbol[] {
  let source: string;
  try {
    source = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const out: ExportedSymbol[] = [];
  for (const decl of topLevelDeclarations(sourceFile)) {
    const name = declaredName(decl);
    if (name === undefined || !hasExportModifier(decl)) continue;
    const doc = leadingDoc(decl, sourceFile);
    const line = sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile)).line + 1;
    out.push({ name, kind: ts.SyntaxKind[decl.kind] as string, doc: doc ?? null, line });
  }
  return out;
}

/**
 * Mine every covered TS/JS file under `workspaceDir` for its exported symbols
 * and each one's doc-comment presence — the data behind a derived API-doc
 * artifact (#107, CLM-0105). Reuses the same bounded walk as the gate (skips
 * build dirs; never parses a file over {@link MAX_FILE_BYTES} — an oversized
 * file is skipped, not read). Files with no exported symbols are omitted.
 * Presence only, never accuracy; pure read, no process/model.
 */
export function mineExportedSymbols(workspaceDir: string): MinedFile[] {
  const out: MinedFile[] = [];
  for (const file of walkFiles(workspaceDir)) {
    if (!COVERED_EXTS.has(path.extname(file).toLowerCase())) continue;
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_BYTES) continue;
    const symbols = listExportedSymbols(file);
    if (symbols.length > 0) out.push({ file: path.relative(workspaceDir, file), symbols });
  }
  return out;
}

/** A doc-comment's text with comment syntax (block/JSDoc markers and line
 * slashes) stripped, so an empty doc shell or a bare `//` reads as
 * undocumented rather than counting as a present doc-comment. */
function strippedDocText(doc: string): string {
  const stripped = doc
    .replace(/\/\*+/g, ' ')
    .replace(/\*+\//g, ' ')
    .replace(/^\s*\*+/gm, ' ')
    .replace(/^\s*\/\//gm, ' ')
    .trim();
  // A residue of only comment delimiters/whitespace (e.g. the lone `/` left by
  // an empty `/***/` shell) is not a doc-comment.
  return /^[/*\s]*$/.test(stripped) ? '' : stripped;
}

/** One undocumented-export `error` finding, or null when `sym` is documented. */
function undocumentedFinding(sym: ExportedSymbol, rel: string): Finding | null {
  if (sym.doc !== null && strippedDocText(sym.doc).length > 0) return null;
  return {
    severity: 'error',
    message: `exported ${sym.kind} "${sym.name}" (${rel}:${String(sym.line)}) has no doc-comment`,
    path: rel,
  };
}

/** Findings for the covered TS/JS files: one `error` per undocumented export.
 * Bounds its own work (per-file and cumulative byte budgets) so untrusted,
 * model-generated source cannot hang or OOM the in-process scan; an oversized
 * or budget-exceeding file is recorded as a non-blocking `info`, never parsed
 * silently and never an unbounded read. */
function findUndocumented(files: readonly string[], rootDir: string): Finding[] {
  const findings: Finding[] = [];
  let totalBytes = 0;
  let truncated = 0;
  for (const file of files) {
    const rel = path.relative(rootDir, file);
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_BYTES) {
      findings.push({
        severity: 'info',
        message: `${rel} skipped: ${String(size)} bytes exceeds the ${String(MAX_FILE_BYTES)}-byte per-file doc-scan limit`,
        path: rel,
      });
      continue;
    }
    if (totalBytes + size > MAX_TOTAL_BYTES) {
      truncated += 1;
      continue;
    }
    totalBytes += size;
    for (const sym of listExportedSymbols(file)) {
      const finding = undocumentedFinding(sym, rel);
      if (finding !== null) findings.push(finding);
    }
  }
  if (truncated > 0) {
    findings.push({
      severity: 'info',
      message: `doc-comment scan truncated: ${String(truncated)} file(s) not scanned after the ${String(MAX_TOTAL_BYTES)}-byte total budget`,
    });
  }
  return findings;
}

/** One non-blocking `info` finding per known source language the scanner does
 * not yet cover — the honest record of a coverage gap, never a silent pass. */
function degradationFindings(byLang: ReadonlyMap<string, number>): Finding[] {
  const findings: Finding[] = [];
  for (const [lang, count] of byLang) {
    findings.push({
      severity: 'info',
      message: `doc-comment check does not yet cover ${lang} (${String(count)} file(s)); coverage recorded, not enforced`,
    });
  }
  return findings;
}

/**
 * Scan a workspace for doc-comment coverage and return the findings (#65,
 * CLM-0104). Every exported TS/JS top-level declaration without a non-empty
 * leading doc-comment is an `error` finding (driving per-child re-iteration);
 * each known source language the scanner cannot parse contributes one `info`
 * finding (honest degradation); non-code files are skipped. Presence only —
 * never accuracy. Pure read; never spawns a process or calls a model.
 */
export function scanDocComments(workspaceDir: string): Finding[] {
  const covered: string[] = [];
  const uncovered = new Map<string, number>();
  for (const file of walkFiles(workspaceDir)) {
    const ext = path.extname(file).toLowerCase();
    if (COVERED_EXTS.has(ext)) {
      covered.push(file);
    } else if (UNCOVERED_LANGS[ext] !== undefined) {
      const lang = UNCOVERED_LANGS[ext];
      uncovered.set(lang, (uncovered.get(lang) ?? 0) + 1);
    }
  }
  return [...findUndocumented(covered, workspaceDir), ...degradationFindings(uncovered)];
}
