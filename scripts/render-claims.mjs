import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * Generates the "How each claim is enforced" table in README.md from the
 * registry, so the claim→enforcement mapping is drift-checked, not hand-typed.
 * `--check` (used in CI) regenerates in memory and fails if README's block is
 * stale; default rewrites it. Comparison is whitespace-normalized so
 * prettier's table-column alignment never reads as drift.
 */
const BEGIN = '<!-- enforcement:begin -->';
const END = '<!-- enforcement:end -->';

/** Render one evidence ref as a markdown cell fragment (file links, gate names). */
export function renderEvidence(raw) {
  // Link text is wrapped in a code span so paths like `__tests__` survive
  // prettier's markdown normalization (which would rewrite `__x__` to bold).
  if (raw.startsWith('test:')) {
    const file = raw.slice('test:'.length).split('::')[0];
    return `[\`${file}\`](${file})`;
  }
  if (raw.startsWith('ci:')) return `CI \`${raw.slice('ci:'.length)}\``;
  if (raw.startsWith('eval:')) {
    const p = raw.slice('eval:'.length);
    return `[\`${p}\`](${p})`;
  }
  if (raw.startsWith('doc:')) {
    const p = raw.slice('doc:'.length);
    return `[\`${p}\`](${p})`;
  }
  return raw;
}

/** Load verified claims sorted by id. */
export function loadVerifiedClaims(registryDir) {
  return fs
    .readdirSync(registryDir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => parseYaml(fs.readFileSync(path.join(registryDir, f), 'utf8')))
    .filter((c) => c.status === 'verified')
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Build the markdown table body (rows only — header is fixed). */
export function renderTable(claims) {
  const lines = ['| Claim | Enforced by |', '| --- | --- |'];
  for (const claim of claims) {
    const links = [...new Set((claim.evidence ?? []).map(renderEvidence))].join(', ');
    lines.push(`| [${claim.id}](claims/registry/${claim.id}.yaml) | ${links} |`);
  }
  return lines.join('\n');
}

/** Splice the table between the markers in README. */
export function spliceBlock(readme, table) {
  const begin = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);
  if (begin === -1 || end === -1) {
    throw new Error(`README is missing the ${BEGIN} … ${END} markers`);
  }
  return `${readme.slice(0, begin + BEGIN.length)}\n${table}\n${readme.slice(end)}`;
}

/** Whitespace-normalize table rows so prettier alignment is not drift. */
export function normalizeBlock(text) {
  const begin = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (begin === -1 || end === -1) return '';
  return (
    text
      .slice(begin + BEGIN.length, end)
      .split('\n')
      // Collapse cell padding and separator dash-runs that prettier adds when
      // it aligns table columns, so alignment is never read as content drift.
      .map((l) =>
        l
          .replace(/\s*\|\s*/g, '|')
          .replace(/-{2,}/g, '-')
          .trim(),
      )
      .filter((l) => l.length > 0)
      .join('\n')
  );
}

export function main(repoRoot, check) {
  const claims = loadVerifiedClaims(path.join(repoRoot, 'claims', 'registry'));
  const readmePath = path.join(repoRoot, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  const next = spliceBlock(readme, renderTable(claims));
  if (check) {
    if (normalizeBlock(readme) !== normalizeBlock(next)) {
      console.error('render-claims ✗ README enforcement table is stale — run `pnpm claims:render`');
      return 1;
    }
    console.log(`render-claims ✓ enforcement table current (${claims.length} claims)`);
    return 0;
  }
  fs.writeFileSync(readmePath, next);
  console.log(`render-claims ✓ wrote enforcement table (${claims.length} claims)`);
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
