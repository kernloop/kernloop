import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GATED_PACKAGES } from './docs-coverage.mjs';

/**
 * Single source of truth for kernloop's drift-prone COUNTS (#189, CLM-0113).
 * Every number is DERIVED from the canonical code const that defines it — never hand-typed —
 * so documentation cannot silently disagree with reality. `pnpm stats` injects
 * the at-a-glance block in README.md; `pnpm stats:check` (CI) fails if that block
 * is stale OR if any WATCHED prose count (in the charter / spec / claim
 * statements) diverges from the derived value. Protected/canonical files are
 * CHECKED, never machine-rewritten.
 */
export const BEGIN = '<!-- stats:begin -->';
export const END = '<!-- stats:end -->';

/** The repo root (fixed), so the canonical sources are read from THIS checkout
 * regardless of any caller-supplied root used for the README/watched files. */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Count the string entries in an `export const NAME = [ … ]` tuple, by READING
 * the source (never importing it — these files transitively import other
 * workspace packages whose dist may be unbuilt in the fast CI job). The consts
 * are flat string lists, so the first `]` after the opener closes the array. */
function countConstArray(relFile, name) {
  const src = fs.readFileSync(path.join(REPO, relFile), 'utf8');
  const at = src.indexOf(`${name} = [`);
  if (at === -1) throw new Error(`${name} not found in ${relFile} — stats source moved`);
  const open = src.indexOf('[', at);
  const body = src.slice(open + 1, src.indexOf(']', open));
  return (body.match(/['"][^'"]+['"]/g) ?? []).length;
}

/** Count files in a repo dir matching a predicate. */
function countDir(relDir, pred) {
  return fs.readdirSync(path.join(REPO, relDir)).filter(pred).length;
}

/**
 * The source files whose named `export const [...]` tuple stats COUNTS, each
 * paired with the const name and the stat key it feeds. Declared once so
 * BOTH {@link deriveStats} (which parses them) and {@link STATS_INPUTS} (which
 * lists them as drift inputs) read the same source — a new counted const is
 * added HERE and both follow.
 */
const CONST_SOURCES = [
  { key: 'contracts', file: 'packages/contracts/src/common.ts', name: 'CONTRACT_NAMES' },
  { key: 'tools', file: 'packages/cli/src/tools/index.ts', name: 'KERNEL_TOOL_NAMES' },
  {
    key: 'templates',
    file: 'packages/faculty-workforce/src/templates.ts',
    name: 'SHIPPED_TEMPLATE_NAMES',
  },
];

/** Directories whose FILE COUNT is a derived stat, each with its match predicate + stat key. */
const DIR_SOURCES = [
  { key: 'languages', dir: 'packages/docscan/grammars', pred: (f) => f.endsWith('.wasm') },
  { key: 'claims', dir: 'claims/registry', pred: (f) => /^CLM-\d+\.yaml$/.test(f) },
];

/** Derive every canonical count from its authoritative source — parsed from the
 * defining const or counted on disk, never hand-typed. Key order (contracts,
 * tools, templates, languages, gatedPackages, claims) is preserved for the
 * README table + summary line. */
export function deriveStats() {
  const s = {};
  for (const c of CONST_SOURCES) s[c.key] = countConstArray(c.file, c.name);
  const [languages, claims] = DIR_SOURCES.map((d) => countDir(d.dir, d.pred));
  s.languages = languages;
  s.gatedPackages = GATED_PACKAGES.length; // scripts/docs-coverage.mjs (a plain .mjs const)
  s.claims = claims;
  return s;
}

/** The "at a glance" table column headers — widths drive value-cell padding. */
const STAT_HEADERS = [
  'Frozen contracts',
  'Kernel MCP tools',
  'Doc-gate languages',
  'Gated packages',
  'Verified claims',
];

/** One `| a | b | … |` markdown row, each cell right-padded to its header width. */
const statRow = (cells) =>
  `| ${cells.map((c, i) => String(c).padEnd(STAT_HEADERS[i].length)).join(' | ')} |`;

/**
 * The generated README "at a glance" table (digits, drift-checked). Value cells
 * are column-ALIGNED to the header widths — the same form `claims:render` writes,
 * so the two generators agree and CI's exact-match `render-claims --check` stays
 * green after a `pnpm stats` run (#400).
 */
export function renderBlock(s) {
  return [
    BEGIN,
    '',
    statRow(STAT_HEADERS),
    `| ${STAT_HEADERS.map((h) => '-'.repeat(h.length)).join(' | ')} |`,
    statRow([s.contracts, s.tools, s.languages, s.gatedPackages, s.claims]),
    '',
    END,
  ].join('\n');
}

/** English number words this gate understands in prose (extend as needed). */
export const WORDS = {
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
};
export const toInt = (tok) => (/^\d+$/.test(tok) ? Number(tok) : WORDS[tok.toLowerCase()]);

/**
 * Prose counts to keep honest WITHOUT rewriting the (often protected) file. Each
 * regex must capture the count token (a digit or an English word); the captured
 * value must equal the derived `key`. Add a row whenever a doc cites a derived
 * count.
 */
export const WATCHED = [
  {
    file: 'claims/registry/CLM-0091.yaml',
    re: /(\w+) packages\s+are gated/i,
    key: 'gatedPackages',
  },
  { file: 'claims/registry/CLM-0104.yaml', re: /(\w+) tree-sitter languages/i, key: 'languages' },
  { file: 'AGENTS.md', re: /beyond the kernel (\w+)\b/i, key: 'tools' },
  { file: 'README.md', re: /exactly the kernel (\w+)\b/i, key: 'tools' },
  { file: 'README.md', re: /frozen at exactly (\w+) types/i, key: 'contracts' },
];

/**
 * Every repo path whose change can move a derived stat: the const-source and
 * `GATED_PACKAGES`-defining FILES stats parses, the {@link WATCHED} prose files
 * it cross-checks, and the DIRECTORIES whose file count is itself a stat.
 * DERIVED from the same {@link CONST_SOURCES} / {@link DIR_SOURCES} /
 * {@link WATCHED} `deriveStats`/`checkWatched` already read (never a hand-kept
 * parallel list), and EXPORTED as the single source the #564 child-gate drift
 * classifier (`driftChecksFor` in `@kernloop/faculty-gates`) mirrors under a
 * lockstep test — so a new stats input can never silently escape the child
 * gate's stats-drift check. `files` are exact repo-relative paths; `dirs` are
 * directory roots (any file within counts).
 */
export const STATS_INPUTS = {
  files: [
    ...new Set([
      ...CONST_SOURCES.map((c) => c.file),
      'scripts/docs-coverage.mjs', // GATED_PACKAGES.length is derived from here
      ...WATCHED.map((w) => w.file),
    ]),
  ],
  dirs: DIR_SOURCES.map((d) => d.dir),
};

/** Validate every WATCHED prose count against the derived value; returns errors. */
export function checkWatched(root, s) {
  const errors = [];
  for (const w of WATCHED) {
    const abs = path.join(root, w.file);
    if (!fs.existsSync(abs)) continue;
    const m = w.re.exec(fs.readFileSync(abs, 'utf8'));
    if (m === null) {
      errors.push(`${w.file}: WATCHED phrase ${String(w.re)} not found (key ${w.key})`);
    } else if (toInt(m[1]) !== s[w.key]) {
      errors.push(`${w.file}: "${m[0].trim()}" says ${m[1]} but derived ${w.key}=${s[w.key]}`);
    }
  }
  return errors;
}

/** Apply the stats block to README text. Returns the next text + any error;
 * pure (no I/O), so the inject/check/stale/missing branches are unit-testable. */
export function applyBlock(readme, block, check) {
  if (!readme.includes(BEGIN) || !readme.includes(END)) {
    return { text: readme, error: `missing the ${BEGIN} / ${END} stats block` };
  }
  const next = readme.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), block);
  if (check) {
    const stale = next.replace(/\s+/g, ' ') !== readme.replace(/\s+/g, ' ');
    return { text: readme, error: stale ? 'stats block is stale — run `pnpm stats`' : null };
  }
  return { text: next, error: null };
}

/** Render-or-check the whole stats surface. Returns derived stats + errors;
 * writes README only in render mode. */
export function runStats(root, check) {
  const s = deriveStats();
  const readmePath = path.join(root, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  const { text, error } = applyBlock(readme, renderBlock(s), check);
  const errors = error ? [`README.md: ${error}`] : [];
  if (!check && text !== readme) fs.writeFileSync(readmePath, text);
  if (check) errors.push(...checkWatched(root, s));
  return { stats: s, errors };
}

/** Turn a {@link runStats} result into CLI output + an exit code (0 ok, 1 drift). */
export function reportStats(result, check, out, err) {
  if (result.errors.length > 0) {
    for (const e of result.errors) err(`stats ✗ ${e}`);
    return 1;
  }
  const summary = Object.entries(result.stats)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  out(`stats ✓ ${check ? 'no drift' : 'rendered'} (${summary})`);
  return 0;
}

/* v8 ignore start -- CLI entry guard; logic above is covered directly */
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const check = process.argv.includes('--check');
  process.exit(reportStats(runStats(root, check), check, console.log, console.error));
}
/* v8 ignore stop */
