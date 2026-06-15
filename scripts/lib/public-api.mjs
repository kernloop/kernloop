import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { listExportedSymbols } from '../../claims/src/symbols.ts';

/**
 * Resolve a package's PUBLIC API surface — the symbols its `src/index.ts`
 * barrel actually exports — to each symbol's definition (kind, doc, line).
 *
 * Three export forms are followed, RECURSIVELY within the package (#72):
 *  - a LOCAL declaration in a barrel (`export const X = …`), read directly;
 *  - a NAMED re-export (`export { X } from './x.js'`), resolved to the symbol's
 *    real definition — even when `./x.ts` is itself a NESTED barrel that
 *    re-exports `X` from a deeper file (the resolver chases every hop until it
 *    reaches the declaration that carries the doc-comment);
 *  - a relative `export * from './x.js'`, EXPANDED into every named symbol on
 *    `./x.ts`'s own surface (again recursively, so a star through a nested
 *    barrel contributes the deep declarations, not an opaque count).
 *
 * Only an EXTERNAL `export *` (e.g. `export * from '@kernloop/contracts'`) stays
 * opaque — its surface is gated in the owning package — and is returned as a
 * `starReExports` count so callers can see the surface was widened, not hidden.
 * Cross-package NAMED re-exports are likewise skipped (gated where they live).
 *
 * Pure and single-package: it follows only relative specifiers, memoizes each
 * file's surface, and breaks any re-export cycle. Like the underlying extractor
 * it surfaces a doc's PRESENCE, never proves behavior.
 */

/** A resolved public export: its name, kind, doc text (or null), and origin. */
/** @typedef {{ name: string, kind: string, doc: string|null, file: string, line: number, typeOnly: boolean }} PublicSymbol */

/** Parse a barrel file into its `export … from './x'` clauses (named + star). */
function readExportDeclarations(indexPath) {
  const source = fs.readFileSync(indexPath, 'utf8');
  const sf = ts.createSourceFile(indexPath, source, ts.ScriptTarget.Latest, true);
  /** @type {{ names: { name: string, typeOnly: boolean }[], moduleSpec: string }[]} */
  const reExports = [];
  /** @type {string[]} */
  const starModuleSpecs = [];
  sf.forEachChild((node) => {
    if (!ts.isExportDeclaration(node) || node.moduleSpecifier === undefined) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const moduleSpec = node.moduleSpecifier.text;
    if (node.exportClause === undefined) {
      starModuleSpecs.push(moduleSpec);
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
  return { reExports, starModuleSpecs };
}

/** Resolve a JS-style relative module specifier to its sibling `.ts` source file. */
function resolveModuleFile(fromFile, moduleSpec) {
  const base = path.resolve(path.dirname(fromFile), moduleSpec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolve a relative module specifier to its file, or throw with context. */
function requireModuleFile(ctx, file, moduleSpec) {
  const defFile = resolveModuleFile(file, moduleSpec);
  if (defFile === null) {
    throw new Error(`${ctx.rel(file)}: cannot resolve re-export module "${moduleSpec}"`);
  }
  return defFile;
}

/** Resolve each `export { name } from './def'` clause to the def's real symbol. */
function pushNamedReExports(ctx, file, reExports, push) {
  for (const { names, moduleSpec } of reExports) {
    // External re-exports belong to another package's surface and are gated
    // there — not here. Only follow relative specifiers within this package.
    if (!moduleSpec.startsWith('.')) continue;
    const defFile = requireModuleFile(ctx, file, moduleSpec);
    const byName = new Map(surfaceOf(ctx, defFile).map((s) => [s.name, s]));
    for (const { name, typeOnly } of names) {
      const found = byName.get(name);
      if (found === undefined) {
        throw new Error(`${ctx.rel(file)}: re-exported "${name}" not found in ${ctx.rel(defFile)}`);
      }
      push({ ...found, typeOnly: typeOnly || found.typeOnly });
    }
  }
}

/** Expand each `export *`: relative ones into their named surface; external counted. */
function pushStarReExports(ctx, file, starModuleSpecs, push) {
  for (const moduleSpec of starModuleSpecs) {
    if (!moduleSpec.startsWith('.')) {
      ctx.stars.count += 1; // external star — opaque, surface owned elsewhere
      continue;
    }
    for (const sym of surfaceOf(ctx, requireModuleFile(ctx, file, moduleSpec))) push(sym);
  }
}

/**
 * The complete export surface of ONE module file, recursively: its own local
 * declarations, every named re-export resolved to its real definition, and
 * every relative `export *` expanded. Memoized per file (`ctx.cache`); a file
 * re-entered through a cycle yields nothing (the cycle is broken, not looped).
 * `ctx.stars.count` accumulates EXTERNAL `export *` clauses reached — surfaces
 * widened opaquely that belong to another package.
 *
 * @param {{ rel: (f: string) => string, cache: Map<string, PublicSymbol[]>, inProgress: Set<string>, stars: { count: number } }} ctx
 * @param {string} file absolute path to the module's `.ts` source
 * @returns {PublicSymbol[]}
 */
function surfaceOf(ctx, file) {
  const cached = ctx.cache.get(file);
  if (cached !== undefined) return cached;
  if (ctx.inProgress.has(file)) return [];
  ctx.inProgress.add(file);

  /** @type {PublicSymbol[]} */
  const out = [];
  const seenNames = new Set();
  /** Add a symbol unless its name was already bound (explicit shadows star). */
  const push = (sym) => {
    if (seenNames.has(sym.name)) return;
    seenNames.add(sym.name);
    out.push(sym);
  };

  for (const local of listExportedSymbols(file)) {
    push({ ...local, file: ctx.rel(file), typeOnly: false });
  }
  const { reExports, starModuleSpecs } = readExportDeclarations(file);
  pushNamedReExports(ctx, file, reExports, push);
  pushStarReExports(ctx, file, starModuleSpecs, push);

  ctx.inProgress.delete(file);
  ctx.cache.set(file, out);
  return out;
}

/**
 * The public API surface of one package, as an ordered list of resolved
 * symbols. `repoRoot`-relative `file` paths make the output stable across
 * machines. Throws when a named re-export cannot be located — an unresolved
 * public export is a real defect, never silently dropped. `starReExports` is
 * the count of EXTERNAL `export *` clauses reached anywhere in the package's
 * barrel graph (opaque surface owned by another package).
 */
export function resolvePackageApi(pkgDir, repoRoot) {
  const indexPath = path.join(pkgDir, 'src', 'index.ts');
  if (!fs.existsSync(indexPath)) return { symbols: [], starReExports: 0 };
  const rel = (f) => path.relative(repoRoot, f).split(path.sep).join('/');
  const ctx = { rel, cache: new Map(), inProgress: new Set(), stars: { count: 0 } };
  const symbols = surfaceOf(ctx, indexPath);
  return { symbols, starReExports: ctx.stars.count };
}
