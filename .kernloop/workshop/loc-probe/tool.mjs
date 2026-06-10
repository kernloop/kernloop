// workshop/loc-probe — non-blank LOC counts for a directory tree.
// Dependency-free: node builtins only. Skips node_modules and dist.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', 'dist']);

function countNonBlankLines(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  let loc = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() !== '') loc += 1;
  }
  return loc;
}

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory: report what we can, never throw mid-walk
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, files);
    } else if (entry.isFile()) {
      try {
        files.push({ path: full, loc: countNonBlankLines(full) });
      } catch {
        // unreadable file: skip rather than abort the probe
      }
    }
  }
}

/**
 * Probe a directory tree for non-blank line counts.
 * @param {string} root directory to scan
 * @returns {{ total: number, files: Array<{ path: string, loc: number }> }}
 */
export function probe(root) {
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) {
    throw new Error(`probe: not a directory: ${root}`);
  }
  const files = [];
  walk(root, files);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const total = files.reduce((sum, f) => sum + f.loc, 0);
  return { total, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? '.';
  try {
    process.stdout.write(JSON.stringify(probe(root), null, 2) + '\n');
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
