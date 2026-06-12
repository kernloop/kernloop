import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { findSymbol, listExportedSymbols } from '../../claims/src/symbols.ts';

/**
 * Resolve a package's PUBLIC API surface — the symbols its `src/index.ts`
 * barrel actually exports — to each symbol's definition (kind, doc, line).
 *
 * Two export forms are followed:
 *  - a LOCAL declaration in the barrel itself (`export const X = …`), read
 *    directly via `listExportedSymbols`;
 *  - a RE-EXPORT (`export { X } from './x.js'`, `export type { Y } from …`),
 *    resolved to its `./x.ts` definition file, where `findSymbol` reads the
 *    real doc-comment. `export * from …` is reported (it widens the surface
 *    opaquely) so callers can decide, but contributes no named symbol here.
 *
 * Pure and single-package: it follows relative re-exports one hop to a file in
 * the same package and never walks the whole module graph. Like the underlying
 * extractor it surfaces a doc's PRESENCE, never proves behavior.
 */

/** A resolved public export: its name, kind, doc text (or null), and origin. */
/** @typedef {{ name: string, kind: string, doc: string|null, file: string, line: number, typeOnly: boolean }} PublicSymbol */

/** Parse a barrel file into the list of its `export … from './x'` clauses + locals. */
function readExportDeclarations(indexPath) {
  const source = fs.readFileSync(indexPath, 'utf8');
  const sf = ts.createSourceFile(indexPath, source, ts.ScriptTarget.Latest, true);
  /** @type {{ names: { name: string, typeOnly: boolean }[], moduleSpec: string }[]} */
  const reExports = [];
  let starReExports = 0;
  sf.forEachChild((node) => {
    if (!ts.isExportDeclaration(node) || node.moduleSpecifier === undefined) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const moduleSpec = node.moduleSpecifier.text;
    if (node.exportClause === undefined) {
      starReExports += 1;
      return;
    }
    if (!ts.isNamedExports(node.exportClause)) return;
    const clauseTypeOnly = node.isTypeOnly;
    const names = node.exportClause.elements.map((el) => ({
      name: el.name.text,
      typeOnly: clauseTypeOnly || el.isTypeOnly,
    }));
    reExports.push({ names, moduleSpec });
  });
  return { reExports, starReExports };
}

/** Resolve a JS-style relative module specifier to its sibling `.ts` source file. */
function resolveModuleFile(fromFile, moduleSpec) {
  const base = path.resolve(path.dirname(fromFile), moduleSpec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The public API surface of one package, as an ordered list of resolved
 * symbols. `repoRoot`-relative `file` paths make the output stable across
 * machines. Throws when a named re-export cannot be located — an unresolved
 * public export is a real defect, never silently dropped.
 */
export function resolvePackageApi(pkgDir, repoRoot) {
  const indexPath = path.join(pkgDir, 'src', 'index.ts');
  if (!fs.existsSync(indexPath)) return { symbols: [], starReExports: 0 };
  /** @type {PublicSymbol[]} */
  const symbols = [];
  const rel = (f) => path.relative(repoRoot, f).split(path.sep).join('/');

  for (const local of listExportedSymbols(indexPath)) {
    symbols.push({
      name: local.name,
      kind: local.kind,
      doc: local.doc,
      file: rel(indexPath),
      line: local.line,
      typeOnly: false,
    });
  }

  const { reExports, starReExports } = readExportDeclarations(indexPath);
  for (const { names, moduleSpec } of reExports) {
    // External re-exports (`@kernloop/contracts`, `node:*`) belong to another
    // package's surface and are gated there — not here. Only follow relative
    // specifiers within this package.
    if (!moduleSpec.startsWith('.')) continue;
    const defFile = resolveModuleFile(indexPath, moduleSpec);
    if (defFile === null) {
      throw new Error(`${rel(indexPath)}: cannot resolve re-export module "${moduleSpec}"`);
    }
    for (const { name, typeOnly } of names) {
      const found = findSymbol(defFile, name);
      if (!found.found) {
        throw new Error(`${rel(indexPath)}: re-exported "${name}" not found in ${rel(defFile)}`);
      }
      symbols.push({
        name,
        kind: found.kind ?? 'Unknown',
        doc: found.doc ?? null,
        file: rel(defFile),
        line: 0,
        typeOnly,
      });
    }
  }
  return { symbols, starReExports };
}
