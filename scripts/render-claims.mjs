import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import prettier from 'prettier';

/**
 * Generates the README's claim-machinery outputs from the claims registry, all
 * drift-checked (`--check` in CI fails on staleness) so none can be hand-typed
 * wrong:
 *  - a block of markdown reference-link DEFINITIONS (`claim-links:*` markers, #219)
 *    so every bare `[CLM-NNNN]` tag in the README's prose renders as a link to
 *    `docs/CLAIMS.md#clm-nnnn` — no inline edits to the 200+ tags;
 *  - `docs/CLAIMS.md`, the exhaustive per-claim catalog (status + statement +
 *    evidence + a link back to the YAML source).
 * It also fails if the README cites a `[CLM-NNNN]` that has no registry file (a
 * dangling tag is a doc that lies).
 *
 * The rewritten README is run through prettier (the repo's own resolved config,
 * by filepath) BEFORE it is written or compared (#269), so `claims:render` output
 * is byte-identical to what `prettier --write` would produce — the render→
 * format:write two-step is gone, and `claims:render --check` can never disagree
 * with `prettier --check`. (docs/CLAIMS.md is prettier-ignored, so it is compared
 * exactly, not formatted.)
 */
const LINKS_BEGIN = '<!-- claim-links:begin -->';
const LINKS_END = '<!-- claim-links:end -->';

/** Format generated markdown with the repo's own prettier config (matched by filepath). */
async function formatMarkdown(content, filepath) {
  const config = (await prettier.resolveConfig(filepath)) ?? {};
  return prettier.format(content, { ...config, filepath });
}

/**
 * Render one evidence ref as a markdown fragment (file links, gate names).
 * `prefix` is prepended to every repo-root-relative href — '' for the README
 * (at the root), '../' for docs/CLAIMS.md (one level deep).
 */
export function renderEvidence(raw, prefix = '') {
  // Link text is wrapped in a code span so paths like `__tests__` survive
  // prettier's markdown normalization (which would rewrite `__x__` to bold).
  if (raw.startsWith('test:')) {
    const file = raw.slice('test:'.length).split('::')[0];
    return `[\`${file}\`](${prefix}${file})`;
  }
  if (raw.startsWith('ci:')) return `CI \`${raw.slice('ci:'.length)}\``;
  if (raw.startsWith('eval:')) {
    const p = raw.slice('eval:'.length);
    return `[\`${p}\`](${prefix}${p})`;
  }
  if (raw.startsWith('doc:')) {
    const p = raw.slice('doc:'.length);
    return `[\`${p}\`](${prefix}${p})`;
  }
  if (raw.startsWith('code:')) {
    // `code:<path>#<symbol>[@doc:/regex/]` → link the file, label `path#symbol`.
    const anchor = raw.slice('code:'.length).split('@doc:')[0];
    const file = anchor.split('#')[0];
    return `[\`${anchor}\`](${prefix}${file})`;
  }
  return raw;
}

/** Parse every claim in the registry, sorted by id (no status filter). */
export function loadAllClaims(registryDir) {
  return fs
    .readdirSync(registryDir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => parseYaml(fs.readFileSync(path.join(registryDir, f), 'utf8')))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The DERIVED human-readable claims catalog (docs/CLAIMS.md, #219): one anchored
 * `## CLM-NNNN` section per claim — its status, a link to the YAML source, its
 * statement, and its evidence. The README's `[CLM-NNNN]` tags link to the
 * `#clm-nnnn` anchors here, which in turn link to the registry. Paths use the
 * `../` prefix because this file lives in docs/.
 */
export function renderCatalog(claims) {
  const out = [
    '# Claims catalog',
    '',
    '> DERIVED from `claims/registry/` by `pnpm claims:render` — every `[CLM-xxxx]` tag in',
    '> the README links to a section here. Do not edit by hand; it is drift-checked in CI.',
    '',
  ];
  for (const c of claims) {
    const evidence = (c.evidence ?? []).map((e) => `- ${renderEvidence(e, '../')}`);
    out.push(
      `## ${c.id}`,
      '',
      `**Status:** ${c.status} — **source:** [\`${c.id}.yaml\`](../claims/registry/${c.id}.yaml)`,
      '',
      (c.statement ?? '').trim(),
      '',
      ...(evidence.length > 0 ? ['**Enforced by:**', '', ...evidence, ''] : []),
    );
  }
  return `${out.join('\n').trim()}\n`;
}

/** Splice `body` between the named markers; throws when a marker is absent. */
function splice(readme, begin, end, body) {
  const b = readme.indexOf(begin);
  const e = readme.indexOf(end);
  if (b === -1 || e === -1) throw new Error(`README is missing the ${begin} … ${end} markers`);
  return `${readme.slice(0, b + begin.length)}\n${body}\n${readme.slice(e)}`;
}

/** The content between `begin`/`end`, or '' when the block is absent. */
function blockBody(text, begin, end) {
  const b = text.indexOf(begin);
  const e = text.indexOf(end);
  return b === -1 || e === -1 ? '' : text.slice(b + begin.length, e);
}

/** Every distinct `CLM-NNNN` the README cites OUTSIDE the generated link block. */
export function referencedClaimIds(readme) {
  const prose = readme.replace(blockBody(readme, LINKS_BEGIN, LINKS_END), '');
  const ids = new Set();
  for (const m of prose.matchAll(/\[CLM-(\d+)\]/g)) ids.add(`CLM-${m[1]}`);
  return [...ids].sort();
}

/** Markdown reference-link definitions pointing at the catalog anchor (#219). */
export function renderClaimLinks(ids) {
  return ids.map((id) => `[${id}]: docs/CLAIMS.md#${id.toLowerCase()}`).join('\n');
}

/** Referenced ids with NO registry file — a dangling tag the README must not carry. */
export function danglingClaimIds(ids, registryDir) {
  return ids.filter((id) => !fs.existsSync(path.join(registryDir, `${id}.yaml`)));
}

export async function main(repoRoot, check) {
  const registryDir = path.join(repoRoot, 'claims', 'registry');
  const allClaims = loadAllClaims(registryDir);
  const readmePath = path.join(repoRoot, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  // Scan the README prose directly for the `[CLM-NNNN]` tags it cites.
  const refs = referencedClaimIds(readme);
  // Honesty gate: a README that cites a claim with no registry file is lying.
  const dangling = danglingClaimIds(refs, registryDir);
  if (dangling.length > 0) {
    console.error(`render-claims ✗ README cites unknown claim(s): ${dangling.join(', ')}`);
    return 1;
  }
  // The claim-links block is optional: only rendered when the README carries the
  // markers (so a minimal README without them is left untouched).
  let next = readme;
  if (readme.includes(LINKS_BEGIN)) {
    next = splice(next, LINKS_BEGIN, LINKS_END, renderClaimLinks(refs));
  }
  // Prettier-clean the render output (#269) so it is byte-identical to what
  // `prettier --write` would produce — no follow-up format:write needed.
  const formattedReadme = await formatMarkdown(next, readmePath);
  const catalogPath = path.join(repoRoot, 'docs', 'CLAIMS.md');
  return emit(check, {
    readme,
    readmePath,
    formattedReadme,
    catalogPath,
    catalog: renderCatalog(allClaims),
    summary: `${allClaims.length} claims, ${refs.length} linked`,
  });
}

/**
 * Drift-check (or write) the rendered README + catalog. Check is a full-file
 * compare against the prettier-formatted render output, so it is stale iff the
 * links changed OR the README on disk is not prettier-clean (#269) — `pnpm
 * claims:render` fixes either. The catalog (prettier-ignored) is compared exactly.
 */
function emit(check, { readme, readmePath, formattedReadme, catalogPath, catalog, summary }) {
  if (check) {
    const catalogStale =
      !fs.existsSync(catalogPath) || fs.readFileSync(catalogPath, 'utf8') !== catalog;
    if (readme !== formattedReadme || catalogStale) {
      console.error(
        'render-claims ✗ README claim links or docs/CLAIMS.md stale — `pnpm claims:render`',
      );
      return 1;
    }
    console.log(`render-claims ✓ claim links + catalog current (${summary})`);
    return 0;
  }
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  fs.writeFileSync(catalogPath, catalog);
  fs.writeFileSync(readmePath, formattedReadme);
  console.log(`render-claims ✓ wrote claim links + catalog (${summary})`);
  return 0;
}

/* v8 ignore start -- CLI entry */
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(await main(repoRoot, process.argv.includes('--check')));
}
/* v8 ignore stop */
