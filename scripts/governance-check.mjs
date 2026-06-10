import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * governance:check v0 (seed Step 5): verifies repo structure matches the
 * spec §9 tree, CODEOWNERS covers the protected paths, the charter symlinks
 * are real, and the AGENTS.md command list matches package.json reality.
 * Drift between charter and repo fails CI (AGENTS.md header contract).
 */

/** Paths that must exist (spec §9 + charter repository map). */
export const REQUIRED_PATHS = [
  'packages/contracts',
  'packages/kernel',
  'claims',
  'skills',
  'docs/kernloop-kernel-spec.md',
  '.github/CODEOWNERS',
  '.github/workflows',
  'AGENTS.md',
  'LICENSE',
  'NOTICE',
  'BOOTSTRAP.md',
];

/** The only package names spec §9 allows under packages/. */
export const ALLOWED_PACKAGES = new Set([
  'contracts',
  'kernel',
  'faculty-compiler',
  'faculty-memory',
  'faculty-gates',
  'faculty-workforce',
  'faculty-observer',
  'faculty-toolsmith',
  'workflows',
  'cli',
]);

/** Protected paths that CODEOWNERS must cover with at least one owner. */
export const PROTECTED_PATTERNS = [
  '/packages/contracts/',
  '/packages/kernel/',
  '/claims/',
  '/AGENTS.md',
];

export function checkStructure(root) {
  const errors = [];
  for (const rel of REQUIRED_PATHS) {
    if (!fs.existsSync(path.join(root, rel))) {
      errors.push(`required path missing: ${rel}`);
    }
  }
  const packagesDir = path.join(root, 'packages');
  if (fs.existsSync(packagesDir)) {
    for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !ALLOWED_PACKAGES.has(entry.name)) {
        errors.push(`packages/${entry.name} is not in the spec §9 tree`);
      }
    }
  }
  return errors;
}

export function checkSymlinks(root) {
  const errors = [];
  for (const link of ['CLAUDE.md', 'GEMINI.md']) {
    const full = path.join(root, link);
    let target;
    try {
      target = fs.readlinkSync(full);
    } catch {
      errors.push(`${link} must be a symlink to AGENTS.md (one charter)`);
      continue;
    }
    if (target !== 'AGENTS.md') {
      errors.push(`${link} points at ${target}, expected AGENTS.md`);
    }
  }
  return errors;
}

export function checkCodeowners(root) {
  const file = path.join(root, '.github/CODEOWNERS');
  if (!fs.existsSync(file)) return ['.github/CODEOWNERS missing'];
  const lines = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'));
  const errors = [];
  for (const pattern of PROTECTED_PATTERNS) {
    const covered = lines.some((l) => {
      const [pathPart, ...owners] = l.trim().split(/\s+/);
      return pathPart === pattern && owners.some((o) => o.startsWith('@'));
    });
    if (!covered) {
      errors.push(`CODEOWNERS does not cover protected path ${pattern} with an @owner`);
    }
  }
  return errors;
}

export function checkCharterCommands(root) {
  const charter = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const scripts = pkg.scripts ?? {};
  const commands = [...charter.matchAll(/^pnpm ([a-z:]+)/gm)].map((m) => m[1]);
  const errors = [];
  for (const cmd of commands) {
    if (cmd === 'install') continue; // pnpm built-in, not a script
    if (!(cmd in scripts)) {
      errors.push(`AGENTS.md documents \`pnpm ${cmd}\` but package.json has no such script`);
    }
  }
  if (commands.length === 0) {
    errors.push('AGENTS.md contains no `pnpm <command>` lines — charter/commands drift');
  }
  return errors;
}

export function runGovernanceCheck(root) {
  return [
    ...checkStructure(root),
    ...checkSymlinks(root),
    ...checkCodeowners(root),
    ...checkCharterCommands(root),
  ];
}

export function main(root) {
  const errors = runGovernanceCheck(root);
  for (const e of errors) console.error(`governance:check ✗ ${e}`);
  if (errors.length > 0) return 1;
  console.log('governance:check ✓ structure, symlinks, CODEOWNERS, charter commands');
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
