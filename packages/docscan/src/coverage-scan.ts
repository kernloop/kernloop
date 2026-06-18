/**
 * Diff-coverage anti-rubber-stamp scanner (#226 item 2, EPIC #47 P1) — flags
 * generated code a child WROTE that the test suite never exercises, the
 * rubber-stamp aggregate per-package coverage thresholds miss. Ratified Option A
 * (consensus_vote 6/7): MODEL-FREE, no git, no snapshot — it reads only the files
 * the child wrote ({path, content}) and the workspace's Istanbul/v8
 * `coverage/coverage-final.json` (the `test` check already emits it):
 *  - an EXECUTABLE written source file ABSENT from the report (no test even loads
 *    it) → `error` (the untested-module rubber-stamp the gate exists to stop);
 *  - present with uncovered executable statements → `warn` (advisory — a one-line
 *    edit to a well-tested big file must not error);
 *  - no report at all → ONE `info` (degrade honestly, never a silent pass).
 *
 * The MUST-FIX from the security/architecture review: a `.d.ts`, a test file, or a
 * pure type/re-export module is LEGITIMATELY absent from coverage — erroring on it
 * is a false positive. So a written file is considered only when its extension is
 * executable source AND {@link hasExecutableCode} (a TS-AST check on the content
 * the child wrote) confirms it carries runtime-coverable code. Stricter
 * new-file-only / git-diff-changed-line granularity is deferred (see the issue).
 *
 * @module docscan/coverage-scan
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Finding } from '@kernloop/contracts';

/** Where vitest/istanbul writes the per-file coverage report inside the workspace. */
const COVERAGE_REL = path.join('coverage', 'coverage-final.json');
/** Cap the coverage report read — a large report is bounded, never an OOM. */
const MAX_COVERAGE_BYTES = 64 * 1024 * 1024;
/** Executable source extensions whose coverage we judge (a `.d.ts` is excluded below). */
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/** A file the child wrote (the implement step's emission). */
export interface WrittenFile {
  readonly path: string;
  readonly content: string;
}

/** True for an executable source path we expect tests to cover — NOT a `.d.ts` or a test file. */
function isCoverableSource(rel: string): boolean {
  if (rel.endsWith('.d.ts')) return false;
  if (/(?:^|[./-])(?:test|spec)\.[cm]?[jt]sx?$/.test(rel) || /\.(?:test|spec)\./.test(rel))
    return false;
  return SOURCE_EXTS.has(path.extname(rel));
}

/** Statement kinds that add NO runtime-coverable code (imports, re-exports, types, ambients). */
function isNonCoverable(stmt: ts.Statement): boolean {
  if (
    ts.isImportDeclaration(stmt) ||
    ts.isImportEqualsDeclaration(stmt) ||
    ts.isExportDeclaration(stmt) ||
    ts.isInterfaceDeclaration(stmt) ||
    ts.isTypeAliasDeclaration(stmt)
  )
    return true;
  // A `declare`d ambient (declare const/function/module) emits no runtime code.
  const mods = ts.canHaveModifiers(stmt) ? (ts.getModifiers(stmt) ?? []) : [];
  return mods.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
}

/**
 * True when `content` carries runtime-coverable code (a function/class/enum/value
 * or any executable statement) — false for a pure type / interface / re-export /
 * ambient module that Istanbul would never instrument, so its absence from the
 * coverage report is honest, not a missing test (#226 item 2 review must-fix).
 */
export function hasExecutableCode(content: string, filename = 'f.ts'): boolean {
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true);
  } catch {
    return true; // unparseable → treat as code (fail safe toward judging, not skipping)
  }
  return source.statements.some((stmt) => !isNonCoverable(stmt));
}

/** Load + parse the workspace coverage report, or null when absent / unreadable / too big. */
function loadCoverage(workspaceDir: string): Record<string, { s?: Record<string, number> }> | null {
  const file = path.join(workspaceDir, COVERAGE_REL);
  try {
    if (fs.statSync(file).size > MAX_COVERAGE_BYTES) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
      string,
      { s?: Record<string, number> }
    >;
  } catch {
    return null;
  }
}

/** The coverage entry for `rel` — matched by absolute key OR by path suffix (sandbox-relocated paths). */
function entryFor(
  report: Record<string, { s?: Record<string, number> }>,
  workspaceDir: string,
  rel: string,
): { s?: Record<string, number> } | undefined {
  const abs = path.resolve(workspaceDir, rel);
  if (report[abs] !== undefined) return report[abs];
  const tail = `/${rel.split(path.sep).join('/')}`;
  const key = Object.keys(report).find((k) => k.split(path.sep).join('/').endsWith(tail));
  return key === undefined ? undefined : report[key];
}

/** Count statements with zero hits in a coverage entry's `s` (statement-hit) map. */
function uncoveredStatements(entry: { s?: Record<string, number> }): number {
  return Object.values(entry.s ?? {}).filter((hits) => hits === 0).length;
}

/**
 * Findings for the executable source files a child wrote vs the workspace coverage
 * report (#226 item 2, CLM-0134): an untested written module → `error`, uncovered
 * statements in a covered file → `warn`, no report → one `info`. Reads only
 * `writtenFiles` + `coverage/coverage-final.json`; model-free, no git, never throws.
 */
export function scanWrittenCoverage(
  writtenFiles: readonly WrittenFile[],
  workspaceDir: string,
): Finding[] {
  const coverable = writtenFiles.filter(
    (f) => isCoverableSource(f.path) && hasExecutableCode(f.content, f.path),
  );
  if (coverable.length === 0) return [];
  const report = loadCoverage(workspaceDir);
  if (report === null) {
    return [
      {
        severity: 'info',
        message: `no coverage report at ${COVERAGE_REL} — diff-coverage skipped (the test runner emitted none)`,
        path: COVERAGE_REL,
      },
    ];
  }
  const findings: Finding[] = [];
  for (const file of coverable) {
    const entry = entryFor(report, workspaceDir, file.path);
    if (entry === undefined) {
      findings.push({
        severity: 'error',
        message: `untested module: no test loads ${file.path} — it is absent from the coverage report`,
        path: file.path,
      });
      continue;
    }
    const uncovered = uncoveredStatements(entry);
    if (uncovered > 0)
      findings.push({
        severity: 'warn',
        message: `${file.path}: ${String(uncovered)} uncovered statement(s) in code this change wrote`,
        path: file.path,
      });
  }
  return findings;
}
