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

/** Directories never walked: build output, deps, VCS, coverage artifacts. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.turbo']);

/** Recursively collect file paths under `dir`, skipping {@link SKIP_DIRS}. */
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
interface ExportedSymbol {
  readonly name: string;
  readonly kind: string;
  readonly doc: string | null;
  readonly line: number;
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

/** A doc-comment's text with comment syntax (block/JSDoc markers and line
 * slashes) stripped, so an empty doc shell or a bare `//` reads as
 * undocumented rather than counting as a present doc-comment. */
function strippedDocText(doc: string): string {
  return doc
    .replace(/\/\*+/g, ' ')
    .replace(/\*+\//g, ' ')
    .replace(/^\s*\*+/gm, ' ')
    .replace(/^\s*\/\//gm, ' ')
    .trim();
}

/** Findings for the covered TS/JS files: one `error` per undocumented export. */
function findUndocumented(files: readonly string[], rootDir: string): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const rel = path.relative(rootDir, file);
    for (const sym of listExportedSymbols(file)) {
      if (sym.doc !== null && strippedDocText(sym.doc).length > 0) continue;
      findings.push({
        severity: 'error',
        message: `exported ${sym.kind} "${sym.name}" (${rel}:${String(sym.line)}) has no doc-comment`,
        path: rel,
      });
    }
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
