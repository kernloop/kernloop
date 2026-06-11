import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Constitutional rule 1 (spec §1): wiring-complete or absent. No stub
 * executors, no TODO-wired exports, no not-implemented markers in shipped
 * package source. This gate scans packages/**\/*.ts (excluding *.test.ts) for
 * the incompleteness markers a stub leaves behind and fails CI if any survive,
 * so rule 1 is mechanically gated rather than merely asserted in prose.
 */

// Word-boundary comment tokens (in // or /* */). The `\b` anchors avoid
// matching these substrings inside identifiers or unrelated words.
const COMMENT_MARKERS = [
  { id: 'TODO', re: /\bTODO\b/ },
  { id: 'FIXME', re: /\bFIXME\b/ },
  { id: 'XXX', re: /\bXXX\b/ },
  { id: 'HACK', re: /\bHACK\b/ },
];

// Incompleteness strings, matched case-insensitively anywhere on the line.
const STRING_MARKERS = [
  { id: 'not implemented', re: /not implemented/i },
  { id: 'notImplemented', re: /notImplemented/i },
  { id: 'NotImplementedError', re: /NotImplementedError/i },
  { id: "throw new Error('stub", re: /throw new Error\(['"`]stub/i },
];

function isScannedFile(file) {
  return file.endsWith('.ts') && !file.endsWith('.test.ts');
}

// Only treat comment tokens as markers when they appear inside a comment, so a
// string literal mentioning "TODO" in production logic is not a false positive.
function commentRegionOfLine(line) {
  const lineComment = line.indexOf('//');
  const blockOpen = line.indexOf('/*');
  const candidates = [lineComment, blockOpen].filter((i) => i !== -1);
  if (candidates.length === 0) return '';
  return line.slice(Math.min(...candidates));
}

export function scanFile(full, rel) {
  const findings = [];
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    const comment = commentRegionOfLine(line);
    for (const m of COMMENT_MARKERS) {
      if (comment && m.re.test(comment)) {
        findings.push({ file: rel, line: idx + 1, marker: m.id });
      }
    }
    for (const m of STRING_MARKERS) {
      if (m.re.test(line)) {
        findings.push({ file: rel, line: idx + 1, marker: m.id });
      }
    }
  });
  return findings;
}

export function scanTree(rootDir, relBase = rootDir) {
  const findings = [];
  if (!fs.existsSync(rootDir)) return findings;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
        continue;
      }
      findings.push(...scanTree(full, relBase));
    } else if (entry.isFile() && isScannedFile(entry.name)) {
      findings.push(...scanFile(full, path.relative(relBase, full)));
    }
  }
  return findings;
}

export function main(repoRoot) {
  const packagesDir = path.join(repoRoot, 'packages');
  const findings = scanTree(packagesDir, repoRoot);
  for (const f of findings) {
    console.error(`wiring-check ✗ ${f.file}:${f.line} stub/incompleteness marker: ${f.marker}`);
  }
  if (findings.length > 0) {
    console.error(
      `wiring-check: ${findings.length} marker(s) — wiring-complete rule (spec §1.1) violated`,
    );
    return 1;
  }
  console.log('wiring-check ✓ no stub/TODO/not-implemented markers in shipped package source');
  return 0;
}

/* v8 ignore start -- CLI entry guard; scan logic above is covered directly */
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(main(repoRoot));
}
/* v8 ignore stop */
