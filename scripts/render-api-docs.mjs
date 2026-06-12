import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolvePackageApi } from './lib/public-api.mjs';
import { GATED_PACKAGES } from './docs-coverage.mjs';

/**
 * Generates `docs/API.md`'s public-API reference DIRECTLY from the JSDoc that
 * already lives on each gated package's exported symbols — the doc is DERIVED,
 * never hand-written, so it cannot drift from or lie about the code. Per export
 * it mines only STRUCTURE: the symbol name, its kind, the FIRST sentence of its
 * existing JSDoc, and any `[CLM-]`/`spec §` references the comment already
 * carries. No new capability prose is synthesized — there is nothing here to rot.
 *
 * `--check` (CI) regenerates the block in memory and fails if the committed
 * `docs/API.md` drifted; default rewrites it. Comparison reuses render-claims'
 * whitespace-normalized compare so prettier's table alignment is never drift.
 *
 * Honesty: this is DERIVED documentation, not claim evidence. A mined sentence
 * proves a symbol is documented, never that it behaves — tests stay the bar.
 */
const BEGIN = '<!-- api:begin -->';
const END = '<!-- api:end -->';

/** Collapse a JSDoc body to its first sentence, single-spaced, table-cell-safe. */
export function firstSentence(doc) {
  if (doc === null) return '';
  const flat = doc.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return '';
  // First sentence: up to the first period that ends a word (not a decimal or
  // an abbreviation like `e.g.`). Fall back to the whole flattened comment.
  const m = flat.match(/^.*?[.!?](?=\s|$)/);
  const sentence = (m ? m[0] : flat).replace(/\|/g, '\\|');
  return sentence;
}

/** Extract the `[CLM-NNNN]` and `spec §N(.N)` references present in a doc-comment. */
export function mineRefs(doc) {
  if (doc === null) return [];
  const refs = new Set();
  for (const m of doc.matchAll(/\[CLM-\d{4}\]/g)) refs.add(m[0]);
  for (const m of doc.matchAll(/spec §\d+(?:\.\d+)*/g)) refs.add(m[0]);
  return [...refs];
}

/** One markdown table row per exported symbol: `package | symbol | kind | summary | refs`. */
export function renderRow(pkg, sym) {
  const refs = mineRefs(sym.doc).join(' ').replace(/\|/g, '\\|');
  const kind = sym.kind.replace(/Declaration$/, '');
  return `| \`${pkg}\` | \`${sym.name}\` | ${kind} | ${firstSentence(sym.doc)} | ${refs} |`;
}

/** Build the full API table (header + one row per public symbol of each gated package). */
export function renderApiTable(repoRoot, packages = GATED_PACKAGES) {
  const lines = [
    '| Package | Symbol | Kind | Summary (mined from JSDoc) | Refs |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const pkg of packages) {
    const { symbols } = resolvePackageApi(path.join(repoRoot, 'packages', pkg), repoRoot);
    for (const sym of symbols) lines.push(renderRow(pkg, sym));
  }
  return lines.join('\n');
}

/** A markdown table separator row (only pipes, dashes, colons, spaces). */
function isSeparatorRow(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}

/** Whitespace-normalize the api block so prettier column alignment is not drift. */
export function normalizeBlock(text) {
  const begin = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (begin === -1 || end === -1) return '';
  return text
    .slice(begin + BEGIN.length, end)
    .split('\n')
    .map((l) => {
      const tightened = l.replace(/\s*\|\s*/g, '|').trim();
      return isSeparatorRow(l) ? tightened.replace(/-{2,}/g, '-') : tightened;
    })
    .filter((l) => l.length > 0)
    .join('\n');
}

/** Splice the table between the api markers, creating the page body if absent. */
export function spliceBlock(doc, table) {
  const begin = doc.indexOf(BEGIN);
  const end = doc.indexOf(END);
  if (begin === -1 || end === -1) {
    throw new Error(`docs/API.md is missing the ${BEGIN} … ${END} markers`);
  }
  return `${doc.slice(0, begin + BEGIN.length)}\n${table}\n${doc.slice(end)}`;
}

/** The page scaffold written once when docs/API.md does not yet exist. */
function scaffold() {
  return [
    '# Public API (derived)',
    '',
    'This reference is **generated** from the JSDoc on each gated package’s',
    'exported symbols by `pnpm docs:render` and drift-checked in CI — it is never',
    'hand-edited. Each summary is the first sentence of the symbol’s existing',
    'doc-comment; staleness is a red build. It states structure, not capability:',
    'a documented symbol is not a verified one — see [`README.md`](../README.md)',
    'and [`claims/`](../claims/) for claim-backed behavior.',
    '',
    BEGIN,
    END,
    '',
  ].join('\n');
}

export function main(repoRoot, check) {
  const apiPath = path.join(repoRoot, 'docs', 'API.md');
  const existing = fs.existsSync(apiPath) ? fs.readFileSync(apiPath, 'utf8') : scaffold();
  const next = spliceBlock(existing, renderApiTable(repoRoot));
  if (check) {
    if (!fs.existsSync(apiPath) || normalizeBlock(existing) !== normalizeBlock(next)) {
      console.error('render-api-docs ✗ docs/API.md is stale — run `pnpm docs:render`');
      return 1;
    }
    console.log('render-api-docs ✓ docs/API.md current');
    return 0;
  }
  fs.writeFileSync(apiPath, next);
  console.log('render-api-docs ✓ wrote docs/API.md');
  return 0;
}

/* v8 ignore start -- CLI entry */
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(main(repoRoot, process.argv.includes('--check')));
}
/* v8 ignore stop */
