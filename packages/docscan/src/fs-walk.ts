/**
 * Shared, SECURITY-CRITICAL workspace file walk + byte budgets for the in-process
 * scanners (doc-comment coverage, CLM-0104; security smells, #277). These run
 * IN-PROCESS over MODEL-GENERATED, untrusted content, so the bounds and the
 * no-symlink-follow guarantee are load-bearing — one shared definition both
 * scanners call, never two hand-kept copies that could drift (the #271 lesson).
 *
 * @module docscan/fs-walk
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Directories never walked: build output, deps, VCS, coverage artifacts (incl.
 * other-language build dirs, so their compiled sources never inflate the scan).
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  'coverage',
  '.turbo',
  'target',
  'vendor',
  'out',
  '.next',
]);

/**
 * Largest single file a scanner will read; a larger one is recorded and skipped,
 * never read. AST/parse cost is superlinear and this runs IN-PROCESS on
 * model-generated content, so an unbounded read could block or OOM the whole
 * loop (the runner's timeout cannot interrupt synchronous work).
 */
export const MAX_FILE_BYTES = 1_000_000;

/**
 * Total bytes a scan will read before truncating (recorded, not silent),
 * bounding the many-files case the per-file cap alone would not.
 */
export const MAX_TOTAL_BYTES = 32_000_000;

/**
 * Recursively YIELD file paths under `dir`, skipping {@link SKIP_DIRS}. A lazy
 * generator (#278): paths stream one at a time instead of materializing a
 * `string[]` of EVERY path up front, so a workspace with millions of tiny files
 * cannot build an unbounded array (nor pay the O(n) `push(...recursive)` spread)
 * before a caller's byte budget engages — and a caller that `break`s on
 * {@link MAX_TOTAL_BYTES} stops the walk early. Uses `Dirent.isDirectory`/
 * `isFile`, which report the lstat type and do NOT follow symlinks — so a symlink
 * (to `/etc`, a loop, anywhere) is neither recursed into nor read. Do NOT switch
 * to `statSync` here: that follows symlinks and would reintroduce a
 * filesystem-escape on untrusted workspaces.
 */
export function* walkFiles(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}
