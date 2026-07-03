/**
 * Copy a workspace into a scratch dir for sandboxed gating (#236). The sandbox
 * runs a COPY, never the live workspace, so generated code cannot poison the
 * real tree. Two binding conditions: credentials/VCS are never copied (asserted
 * by a positive test), and symlinks are copied AS symlinks (`dereference:false`)
 * so an escaping link never pulls host content into the scratch.
 */
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

/** Directories never copied — deps (mounted read-only) and credential stores. */
export const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.ssh',
  '.aws',
  '.gnupg',
  '.docker',
  '.kube',
]);

/** Credential file basenames never copied (broad: dotenv, keys/certs, token files). */
export const SECRET_FILE_PATTERN =
  /(^\.env($|\..*)|^\.npmrc$|^\.netrc$|^\.?id_(rsa|dsa|ecdsa|ed25519)$|^kubeconfig$|\.(pem|key|crt|cer|p12|pfx|keystore|jks)$)/i;

/** True iff a path entry may be copied into the sandbox scratch. */
export function isCopyable(srcPath: string): boolean {
  const base = path.basename(srcPath);
  if (EXCLUDED_DIRS.has(base)) return false;
  if (SECRET_FILE_PATTERN.test(base)) return false;
  return true;
}

/** Copy the workspace SOURCE (no node_modules/VCS/credentials, no symlink deref). */
export function copyWorkspaceSource(workspaceDir: string, scratchDir: string): void {
  cpSync(workspaceDir, scratchDir, {
    recursive: true,
    dereference: false, // copy symlinks AS symlinks — never read their targets
    filter: (src) => isCopyable(src),
  });
}

/**
 * Copy `src` dir to `dest`, preserving symlinks. Uses `cp -a --reflink=auto`
 * (copy-on-write where the FS supports it) with a cpSync fallback. Exported so
 * the PM provisioner (#548) reuses the same copy-on-write path for the corepack
 * dist without re-deriving the fallback.
 */
export function copyDir(src: string, dest: string): void {
  try {
    execFileSync('cp', ['-a', '--reflink=auto', src, dest], { stdio: 'ignore' });
  } catch {
    cpSync(src, dest, { recursive: true, dereference: false });
  }
}

/**
 * Walk `workspaceDir` and copy EVERY `node_modules` directory (root AND per-package)
 * to the same relative path in `scratchDir`. Does NOT descend into a `node_modules`
 * dir (its contents come along with the copy) or any other EXCLUDED_DIRS entry.
 * Fixes pnpm workspaces where each package has its own `packages/<name>/node_modules`
 * symlink farm (#546).
 */
function walkAndCopyNodeModules(workspaceDir: string, scratchDir: string, rel = ''): void {
  const abs = rel ? path.join(workspaceDir, rel) : workspaceDir;
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.name === 'node_modules') {
      const dest = path.join(scratchDir, entryRel);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyDir(path.join(workspaceDir, entryRel), dest);
      // Do NOT recurse — contents come along with the parent copy.
    } else if (!EXCLUDED_DIRS.has(entry.name)) {
      walkAndCopyNodeModules(workspaceDir, scratchDir, entryRel);
    }
  }
}

/** Populate a fresh scratch with the workspace source + all node_modules. */
export function populateScratch(workspaceDir: string, scratchDir: string): void {
  copyWorkspaceSource(workspaceDir, scratchDir);
  walkAndCopyNodeModules(workspaceDir, scratchDir);
}
