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
 * mechanical scan cannot make; only a reviewer/test can. TypeScript/JavaScript
 * is enforced here via the TS compiler API; twelve more languages (Python/Go/
 * Rust/Java/C/PHP/Ruby #108/#122, C++/C#/Kotlin/Swift/Scala #120) are enforced in
 * `treesitter-scan.ts` (in-process WASM grammars). A REMAINING known source
 * language whose grammar is not vendored (Dart, Lua, Elixir, Haskell, …) degrades
 * HONESTLY — one non-blocking `info` finding records the gap rather than
 * silently passing the files. Non-code files are out of scope and skipped.
 * The AST logic mirrors `claims/src/symbols.ts` (the quarry
 * pattern: reimplement against this consumer, not a cross-package import — a
 * runtime faculty must not depend on the private claims tooling package).
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Finding } from '@kernloop/contracts';
import { scanTreeSitterFiles, TREE_SITTER_EXTS } from './treesitter-scan.js';
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, walkFiles } from './fs-walk.js';

/** File extensions this scanner parses with the TS compiler API (covered). */
const COVERED_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/** Known SOURCE languages the scanner cannot yet parse — recorded, not faked.
 * Maps extension → language label for the honest-degradation finding. The
 * tree-sitter-covered languages (Python, Go, Rust, Java, C, PHP, Ruby #108/#122;
 * C++, C#, Kotlin, Swift, Scala #120) are NOT here — they are enforced via
 * {@link scanTreeSitterFiles}. The rest — known languages whose grammar is not
 * vendored — still degrade to one non-blocking `info` finding (recorded, never
 * silently passed) until a grammar + extractor is added. */
const UNCOVERED_LANGS: Record<string, string> = {
  '.dart': 'Dart',
  '.lua': 'Lua',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.hs': 'Haskell',
};

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

/** The result of {@link mineExportedSymbols}: the mined files plus how many
 * covered files were left unparsed once the cumulative {@link MAX_TOTAL_BYTES}
 * budget was reached (recorded, never silent — #114). */
export interface MinedResult {
  /** The scanned files that declare at least one exported symbol. */
  readonly files: MinedFile[];
  /** Count of covered files skipped after the cumulative-byte budget. */
  readonly skippedForBudget: number;
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
 * file is skipped, not read) and, mirroring {@link findUndocumented}, also
 * bounds the many-files case: once the cumulative parsed size would exceed
 * {@link MAX_TOTAL_BYTES} the remaining covered files are skipped and counted,
 * never parsed silently. Returns a {@link MinedResult} — the mined files (those
 * with no exported symbols are omitted) plus `skippedForBudget`, the count left
 * unparsed by that cumulative cap. Presence only, never accuracy; pure read,
 * no process/model.
 */
export function mineExportedSymbols(workspaceDir: string): MinedResult {
  const out: MinedFile[] = [];
  let totalBytes = 0;
  let skipped = 0;
  for (const file of walkFiles(workspaceDir)) {
    if (!COVERED_EXTS.has(path.extname(file).toLowerCase())) continue;
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_BYTES) continue;
    if (totalBytes + size > MAX_TOTAL_BYTES) {
      skipped += 1;
      continue;
    }
    totalBytes += size;
    const symbols = listExportedSymbols(file);
    if (symbols.length > 0) out.push({ file: path.relative(workspaceDir, file), symbols });
  }
  return { files: out, skippedForBudget: skipped };
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
 * Scan a workspace for doc-comment coverage and return the findings (#65, #108;
 * CLM-0104). Every exported TS/JS top-level declaration (TS compiler API) and
 * every public Python/Go/Rust/Java/C/PHP/Ruby declaration (tree-sitter, {@link
 * scanTreeSitterFiles}) without a non-empty leading doc-comment is an `error`
 * finding (driving per-child re-iteration); each REMAINING source language the
 * scanner cannot parse contributes one `info` finding (honest degradation);
 * non-code files are skipped. Presence only — never accuracy. Pure read; never
 * spawns a process or calls a model. Async because the WASM grammars load
 * asynchronously (the gate runner awaits and times out the in-process check).
 *
 * `onlyFiles` (#534, CLM-0189) restricts the scan to those workspace paths:
 * only they are parsed (never merely post-filtered — out-of-scope files are
 * not read), so a child's quality gate judges only what the child wrote and a
 * pre-existing repo-wide doc gap cannot fail it. Each entry is CANONICALIZED
 * against `workspaceDir` (resolve-then-relative), so a relative entry, a
 * `./`-prefixed one, or an ABSOLUTE path inside the workspace all match the
 * walk — an emitted absolute path cannot dodge the scan by failing a string
 * compare. Omitted → the whole-tree scan is byte-identical to before.
 */
export async function scanDocComments(
  workspaceDir: string,
  onlyFiles?: readonly string[],
): Promise<Finding[]> {
  const scope =
    onlyFiles === undefined
      ? undefined
      : new Set(onlyFiles.map((f) => path.relative(workspaceDir, path.resolve(workspaceDir, f))));
  const covered: string[] = [];
  const treeSitter: string[] = [];
  const uncovered = new Map<string, number>();
  for (const file of walkFiles(workspaceDir)) {
    if (scope !== undefined && !scope.has(path.relative(workspaceDir, file))) continue;
    const ext = path.extname(file).toLowerCase();
    if (COVERED_EXTS.has(ext)) {
      covered.push(file);
    } else if (TREE_SITTER_EXTS.has(ext)) {
      treeSitter.push(file);
    } else if (UNCOVERED_LANGS[ext] !== undefined) {
      const lang = UNCOVERED_LANGS[ext];
      uncovered.set(lang, (uncovered.get(lang) ?? 0) + 1);
    }
  }
  return [
    ...findUndocumented(covered, workspaceDir),
    ...(await scanTreeSitterFiles(treeSitter, workspaceDir)),
    ...degradationFindings(uncovered),
  ];
}
