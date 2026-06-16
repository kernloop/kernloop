import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolvePackageApi } from './lib/public-api.mjs';

/**
 * Doc-coverage gate (#64): every VALUE export on a gated package's public API
 * surface must carry a real, non-placeholder doc-comment. A value export is a
 * function, const, class, or enum — the things that carry behavior and deserve
 * a usage doc. Missing or trivial docs exit 1 with a per-package report.
 *
 * This is a QUALITY gate, not claim evidence: a doc-comment proves a symbol is
 * documented, never that it behaves — tests remain the `verified` bar.
 *
 * As of #72 the gate covers EVERY gated package's full surface — `cli`,
 * `workflows`, and `kernel` included — because the resolver now chases named
 * re-exports through nested barrels and EXPANDS relative `export *` recursively
 * (see scripts/lib/public-api.mjs), so those packages no longer under-report.
 *
 * One scope decision is stated permanently in EXCLUDED below (never a silent
 * weakening): TYPE-ONLY re-exports (`export type { X }`) are excluded by policy —
 * they are `z.infer<>` companions or interface shapes whose documentation lives
 * on the adjacent documented schema/value, so a separate doc would only restate
 * it. (Value exports re-exported as types are vanishingly rare and the kind
 * filter already covers genuine type aliases.)
 */

/**
 * Packages whose public value-export surface is gated for doc coverage. The
 * recursive resolver (#72) lets this cover the nested-barrel / `export *`
 * packages (`cli`, `workflows`, `kernel`) honestly, alongside the faculties.
 */
export const GATED_PACKAGES = [
  'contracts',
  'kernel',
  'cli',
  'workflows',
  'faculty-compiler',
  'faculty-gates',
  'faculty-memory',
  'faculty-observer',
  'faculty-scrum',
  'faculty-toolsmith',
  'faculty-workforce',
  'tracker',
];

/**
 * Coverage scope EXCLUDED by deliberate policy (not deferral), each with a
 * recorded reason so the exclusion is auditable rather than silent.
 */
export const EXCLUDED = [
  {
    what: 'type-only exports (type aliases, interfaces, z.infer companions)',
    why: 'excluded by KIND — they declare no runtime VALUE to document (a value re-exported via `export type` is still gated, #215)',
  },
];

/** Syntax kinds that carry runtime behavior — the value exports we require docs on. */
const VALUE_KINDS = new Set([
  'FunctionDeclaration',
  'VariableDeclaration',
  'ClassDeclaration',
  'EnumDeclaration',
]);

/**
 * Is this doc a real doc, or a trivial placeholder? A placeholder is empty,
 * or merely restates the symbol name (case/spacing/`Schema` suffix stripped),
 * or is a bare TODO. Cheap, lexical, deliberately conservative — it rejects the
 * obvious non-docs without pretending to judge prose quality.
 */
export function isTrivialDoc(doc, name) {
  if (doc === null) return true;
  const norm = doc
    .trim()
    .toLowerCase()
    .replace(/[.\s]+/g, ' ')
    .trim();
  if (norm.length === 0) return true;
  if (/^(todo|fixme|tbd|xxx)\b/.test(norm)) return true;
  const bareName = name.toLowerCase().replace(/schema$/, '');
  const bareDoc = norm.replace(/\bschema\b/g, '').replace(/[^a-z0-9]/g, '');
  return bareDoc === name.toLowerCase() || bareDoc === bareName;
}

/** Value exports of a gated package that lack a real doc-comment. The exclusion
 * is by KIND, not the type-only flag (#215): a VALUE re-exported via `export type`
 * still declares a runtime value and is gated; type aliases/interfaces are not. */
export function gapsForPackage(pkgDir, repoRoot) {
  const { symbols } = resolvePackageApi(pkgDir, repoRoot);
  return symbols
    .filter((s) => VALUE_KINDS.has(s.kind))
    .filter((s) => isTrivialDoc(s.doc, s.name))
    .map((s) => ({ name: s.name, kind: s.kind, file: s.file }));
}

/** Run the gate over every gated package; returns per-package gap lists + a count. */
export function runCoverage(repoRoot, packages = GATED_PACKAGES) {
  const report = packages.map((pkg) => ({
    pkg,
    gaps: gapsForPackage(path.join(repoRoot, 'packages', pkg), repoRoot),
  }));
  const total = report.reduce((n, r) => n + r.gaps.length, 0);
  return { report, total };
}

export function main(repoRoot) {
  const { report, total } = runCoverage(repoRoot);
  for (const { pkg, gaps } of report) {
    if (gaps.length === 0) {
      console.log(`docs:coverage ✓ ${pkg} — all value exports documented`);
    } else {
      console.error(`docs:coverage ✗ ${pkg} — ${gaps.length} undocumented value export(s):`);
      for (const g of gaps) console.error(`    ${g.name} (${g.kind}) @ ${g.file}`);
    }
  }
  console.log('docs:coverage — excluded by policy (recorded, not silent):');
  for (const d of EXCLUDED) console.log(`    • ${d.what} — ${d.why}`);
  if (total > 0) {
    console.error(`docs:coverage ✗ ${total} undocumented value export(s) across gated packages`);
    return 1;
  }
  console.log(`docs:coverage ✓ ${GATED_PACKAGES.length} packages, every value export documented`);
  return 0;
}

/* v8 ignore start -- CLI entry guard; logic above is covered directly */
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(main(repoRoot));
}
/* v8 ignore stop */
