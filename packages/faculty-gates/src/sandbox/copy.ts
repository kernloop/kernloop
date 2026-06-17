/**
 * Copy a workspace into a scratch dir for sandboxed gating (#236). The sandbox
 * runs a COPY, never the live workspace, so generated code cannot poison the
 * real tree. Two binding conditions: credentials/VCS are never copied (asserted
 * by a positive test), and symlinks are copied AS symlinks (`dereference:false`)
 * so an escaping link never pulls host content into the scratch.
 */
import { cpSync, existsSync } from 'node:fs';
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
 * Copy `node_modules` wholesale (deps must come along — no offline install
 * under `--network none`). `cp -a --reflink=auto` is copy-on-write where the FS
 * supports it (addresses the copy-cost condition), preserves symlinks, and falls
 * back to `cpSync`. A copy (not a mount) lets tools write their caches.
 */
export function copyNodeModules(workspaceDir: string, scratchDir: string): void {
  const src = path.join(workspaceDir, 'node_modules');
  if (!existsSync(src)) return;
  const dest = path.join(scratchDir, 'node_modules');
  try {
    execFileSync('cp', ['-a', '--reflink=auto', src, dest], { stdio: 'ignore' });
  } catch {
    cpSync(src, dest, { recursive: true, dereference: false });
  }
}

/** Populate a fresh scratch with the workspace source + its node_modules. */
export function populateScratch(workspaceDir: string, scratchDir: string): void {
  copyWorkspaceSource(workspaceDir, scratchDir);
  copyNodeModules(workspaceDir, scratchDir);
}
