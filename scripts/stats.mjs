import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONTRACT_NAMES } from '../packages/contracts/src/common.ts';
import { KERNEL_TOOL_NAMES } from '../packages/cli/src/tools/index.ts';
import { SHIPPED_TEMPLATE_NAMES } from '../packages/faculty-workforce/src/templates.ts';
import { LANGS } from '../packages/faculty-gates/src/treesitter-langs.ts';
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

/** Derive every canonical count from its authoritative source const/glob. */
export function deriveStats(root) {
  const claims = fs
    .readdirSync(path.join(root, 'claims/registry'))
    .filter((f) => /^CLM-\d+\.yaml$/.test(f)).length;
  return {
    contracts: CONTRACT_NAMES.length, // packages/contracts/src/common.ts
    tools: KERNEL_TOOL_NAMES.length, // packages/cli/src/tools/index.ts
    languages: new Set(Object.values(LANGS).map((l) => l.label)).size, // faculty-gates LANGS
    gatedPackages: GATED_PACKAGES.length, // scripts/docs-coverage.mjs
    templates: SHIPPED_TEMPLATE_NAMES.length, // faculty-workforce SHIPPED_TEMPLATE_NAMES
    claims, // claims/registry/CLM-*.yaml
  };
}

/** The generated README "at a glance" table (digits, drift-checked). */
export function renderBlock(s) {
  return [
    BEGIN,
    '',
    '| Frozen contracts | Kernel MCP tools | Doc-gate languages | Gated packages | Verified claims |',
    '| ---------------- | ---------------- | ------------------ | -------------- | --------------- |',
    `| ${s.contracts} | ${s.tools} | ${s.languages} | ${s.gatedPackages} | ${s.claims} |`,
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
  const s = deriveStats(root);
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
