import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * Generates two README blocks from the claims registry, both drift-checked
 * (`--check` in CI fails on staleness) so neither can be hand-typed wrong:
 *  - the "How each claim is enforced" TABLE (`enforcement:*` markers);
 *  - a block of markdown reference-link DEFINITIONS (`claim-links:*` markers, #219)
 *    so every bare `[CLM-NNNN]` tag in the README's prose renders as a link to
 *    `claims/registry/CLM-NNNN.yaml` — no inline edits to the 200+ tags.
 * It also fails if the README cites a `[CLM-NNNN]` that has no registry file (a
 * dangling tag is a doc that lies). Table comparison is whitespace-normalized so
 * prettier's column alignment never reads as drift.
 */
const BEGIN = '<!-- enforcement:begin -->';
const END = '<!-- enforcement:end -->';
const LINKS_BEGIN = '<!-- claim-links:begin -->';
const LINKS_END = '<!-- claim-links:end -->';

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
  if (raw.startsWith('code:')) {
    // `code:<path>#<symbol>[@doc:/regex/]` → link the file, label `path#symbol`.
    const anchor = raw.slice('code:'.length).split('@doc:')[0];
    const file = anchor.split('#')[0];
    return `[\`${anchor}\`](${file})`;
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

/** Splice `body` between the named markers; throws when a marker is absent. */
function splice(readme, begin, end, body) {
  const b = readme.indexOf(begin);
  const e = readme.indexOf(end);
  if (b === -1 || e === -1) throw new Error(`README is missing the ${begin} … ${end} markers`);
  return `${readme.slice(0, b + begin.length)}\n${body}\n${readme.slice(e)}`;
}

/** Splice the enforcement table between its markers in README. */
export function spliceBlock(readme, table) {
  return splice(readme, BEGIN, END, table);
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

/** Markdown reference-link definitions: `[CLM-NNNN]: claims/registry/CLM-NNNN.yaml`. */
export function renderClaimLinks(ids) {
  return ids.map((id) => `[${id}]: claims/registry/${id}.yaml`).join('\n');
}

/** Referenced ids with NO registry file — a dangling tag the README must not carry. */
export function danglingClaimIds(ids, registryDir) {
  return ids.filter((id) => !fs.existsSync(path.join(registryDir, `${id}.yaml`)));
}

/** A markdown table separator row (only pipes, dashes, colons, spaces). */
function isSeparatorRow(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
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
      // Collapse the cell padding prettier adds. Dash-runs are collapsed ONLY
      // on a separator row — doing it everywhere could hide a real `--`→`-`
      // drift inside a content cell (e.g. a path).
      .map((l) => {
        const tightened = l.replace(/\s*\|\s*/g, '|').trim();
        return isSeparatorRow(l) ? tightened.replace(/-{2,}/g, '-') : tightened;
      })
      .filter((l) => l.length > 0)
      .join('\n')
  );
}

export function main(repoRoot, check) {
  const registryDir = path.join(repoRoot, 'claims', 'registry');
  const claims = loadVerifiedClaims(registryDir);
  const readmePath = path.join(repoRoot, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  // Render the enforcement table FIRST, then scan the result for references — so
  // a newly-added claim's own table row is linked in the same pass (single-pass
  // convergence, no chicken-and-egg between the two blocks).
  let next = spliceBlock(readme, renderTable(claims));
  const refs = referencedClaimIds(next);
  // Honesty gate: a README that cites a claim with no registry file is lying.
  const dangling = danglingClaimIds(refs, registryDir);
  if (dangling.length > 0) {
    console.error(`render-claims ✗ README cites unknown claim(s): ${dangling.join(', ')}`);
    return 1;
  }
  // The claim-links block is optional: only rendered when the README carries the
  // markers (so a minimal README without them is left untouched).
  if (readme.includes(LINKS_BEGIN)) {
    next = splice(next, LINKS_BEGIN, LINKS_END, renderClaimLinks(refs));
  }
  if (check) {
    const stale =
      normalizeBlock(readme) !== normalizeBlock(next) ||
      blockBody(readme, LINKS_BEGIN, LINKS_END).trim() !==
        blockBody(next, LINKS_BEGIN, LINKS_END).trim();
    if (stale) {
      console.error('render-claims ✗ README claim blocks are stale — run `pnpm claims:render`');
      return 1;
    }
    console.log(
      `render-claims ✓ claim blocks current (${claims.length} claims, ${refs.length} linked)`,
    );
    return 0;
  }
  fs.writeFileSync(readmePath, next);
  console.log(
    `render-claims ✓ wrote claim blocks (${claims.length} claims, ${refs.length} linked)`,
  );
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
