import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * LOC budgets are acceptance criteria, not aspirations (spec §2):
 * kernel ≤5,000 · contracts ≤800 · each faculty ≤4,000. Counted over
 * non-blank lines of TypeScript source, excluding tests and generated output.
 */
export const BUDGETS = [
  { pattern: /^contracts$/, budget: 800 },
  { pattern: /^kernel$/, budget: 5000 },
  { pattern: /^faculty-/, budget: 4000 },
];

function isSourceFile(file) {
  return (
    (file.endsWith('.ts') || file.endsWith('.mts')) &&
    !file.endsWith('.test.ts') &&
    !file.endsWith('.d.ts')
  );
}

export function countLoc(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }
      total += countLoc(full);
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      total += lines.filter((l) => l.trim().length > 0).length;
    }
  }
  return total;
}

export function checkBudgets(repoRoot) {
  const packagesDir = path.join(repoRoot, 'packages');
  const results = [];
  if (!fs.existsSync(packagesDir)) return results;
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rule = BUDGETS.find((b) => b.pattern.test(entry.name));
    if (!rule) continue;
    const loc = countLoc(path.join(packagesDir, entry.name));
    results.push({ pkg: entry.name, loc, budget: rule.budget, ok: loc <= rule.budget });
  }
  return results;
}

export function main(repoRoot) {
  const results = checkBudgets(repoRoot);
  for (const r of results) {
    const status = r.ok ? 'ok' : 'OVER BUDGET';
    console.log(`loc-check: packages/${r.pkg} ${r.loc}/${r.budget} ${status}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`loc-check: ${failed.length} package(s) over LOC budget`);
    return 1;
  }
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
