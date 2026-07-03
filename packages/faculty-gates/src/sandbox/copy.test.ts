/**
 * Workspace copy-in safety (#236, binding conditions): credentials/VCS are never
 * copied into the scratch (positive assertion, not just a denylist claim), and a
 * symlink that escapes the workspace is NOT dereferenced (its target content
 * never lands in the scratch).
 *
 * pnpm workspace node_modules propagation (#546): populateScratch copies every
 * workspace package's node_modules (root + per-package), so a pnpm monorepo's
 * typecheck/test runs inside the network-none sandbox with full module resolution.
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  existsSync,
  readFileSync,
  readlinkSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isCopyable, copyWorkspaceSource, populateScratch } from './copy.js';

const dirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('isCopyable — secret/dep/VCS exclusion (#236)', () => {
  it('excludes credential files and dep/VCS dirs', () => {
    for (const secret of [
      '.env',
      '.env.local',
      '.env.production',
      '.npmrc',
      '.netrc',
      'id_rsa',
      'server.pem',
      'tls.key',
      'cert.crt',
      'store.p12',
      'kubeconfig',
    ]) {
      expect(isCopyable(join('/ws', secret)), secret).toBe(false);
    }
    for (const dir of ['node_modules', '.git', '.ssh', '.aws', '.kube']) {
      expect(isCopyable(join('/ws', dir)), dir).toBe(false);
    }
  });

  it('allows ordinary source files', () => {
    for (const ok of ['index.ts', 'package.json', 'README.md', 'vitest.config.ts', 'src']) {
      expect(isCopyable(join('/ws', ok)), ok).toBe(true);
    }
  });
});

describe('copyWorkspaceSource — positive isolation (#236)', () => {
  it('copies source but NOT secrets, node_modules, or .git', () => {
    const ws = tmp('kernloop-ws-');
    writeFileSync(join(ws, 'index.ts'), 'export const x = 1;\n');
    writeFileSync(join(ws, '.env'), 'SECRET=topsecret\n');
    writeFileSync(join(ws, 'deploy.pem'), 'PRIVATE KEY\n');
    mkdirSync(join(ws, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(ws, 'node_modules', 'dep', 'index.js'), 'module.exports={}');
    mkdirSync(join(ws, '.git'));
    writeFileSync(join(ws, '.git', 'config'), '[core]\n');

    const scratch = tmp('kernloop-scratch-');
    rmSync(scratch, { recursive: true, force: true }); // copyWorkspaceSource creates it
    copyWorkspaceSource(ws, scratch);

    expect(existsSync(join(scratch, 'index.ts'))).toBe(true);
    expect(existsSync(join(scratch, '.env'))).toBe(false);
    expect(existsSync(join(scratch, 'deploy.pem'))).toBe(false);
    expect(existsSync(join(scratch, 'node_modules'))).toBe(false);
    expect(existsSync(join(scratch, '.git'))).toBe(false);
  });

  it('does NOT dereference a symlink that escapes the workspace (no host-content leak)', () => {
    const ws = tmp('kernloop-ws-');
    writeFileSync(join(ws, 'real.ts'), 'ok\n');
    // A workspace symlink pointing at a host secret outside the workspace.
    const hostSecret = tmp('kernloop-host-');
    writeFileSync(join(hostSecret, 'passwd'), 'root:x:0:0\n');
    symlinkSync(join(hostSecret, 'passwd'), join(ws, 'escape'));

    const scratch = tmp('kernloop-scratch-');
    rmSync(scratch, { recursive: true, force: true });
    copyWorkspaceSource(ws, scratch);

    const copied = join(scratch, 'escape');
    if (existsSync(copied) || lstatSync(copied, { throwIfNoEntry: false }) !== undefined) {
      // If present at all, it must be a symlink — NOT a dereferenced copy of the
      // host secret's CONTENT. (We never read the target during copy.)
      expect(lstatSync(copied).isSymbolicLink()).toBe(true);
      // And reading it must not yield host content from within the scratch tree
      // (the link target is absolute-outside; the point is content wasn't inlined).
      expect(lstatSync(copied).isFile()).toBe(false);
    }
    // The real source file did copy.
    expect(readFileSync(join(scratch, 'real.ts'), 'utf8')).toBe('ok\n');
  });

  it('preserves a RELATIVE symlink target verbatim — never resolved to an absolute host path (#561)', () => {
    const ws = tmp('kernloop-ws-');
    writeFileSync(join(ws, 'AGENTS.md'), '# charter\n');
    // The repo's own shape: CLAUDE.md is a relative symlink to AGENTS.md.
    symlinkSync('AGENTS.md', join(ws, 'CLAUDE.md'));

    const scratch = tmp('kernloop-scratch-');
    rmSync(scratch, { recursive: true, force: true });
    copyWorkspaceSource(ws, scratch);

    const copied = join(scratch, 'CLAUDE.md');
    expect(lstatSync(copied).isSymbolicLink()).toBe(true);
    // The target TEXT is unchanged — 'AGENTS.md', not an absolute path into the
    // copy source (which would dangle inside the sandbox container).
    expect(readlinkSync(copied)).toBe('AGENTS.md');
    // And it resolves inside the scratch tree.
    expect(readFileSync(copied, 'utf8')).toBe('# charter\n');
  });
});

describe('populateScratch — pnpm workspace node_modules (#546)', () => {
  it('pnpm workspace fixture — both root and per-package node_modules reach the scratch, symlink is preserved and resolves', () => {
    const ws = tmp('kernloop-ws-');
    // Root node_modules/.pnpm/dep/index.js — real file (the canonical pnpm store location)
    mkdirSync(join(ws, 'node_modules', '.pnpm', 'dep'), { recursive: true });
    writeFileSync(join(ws, 'node_modules', '.pnpm', 'dep', 'index.js'), 'module.exports=42;');
    // packages/a/ source
    mkdirSync(join(ws, 'packages', 'a', 'src'), { recursive: true });
    writeFileSync(join(ws, 'packages', 'a', 'src', 'index.ts'), 'export const x = 1;\n');
    // packages/a/node_modules/dep → relative symlink to ../../../node_modules/.pnpm/dep
    mkdirSync(join(ws, 'packages', 'a', 'node_modules'), { recursive: true });
    symlinkSync(
      '../../../node_modules/.pnpm/dep',
      join(ws, 'packages', 'a', 'node_modules', 'dep'),
    );

    const scratch = tmp('kernloop-scratch-');
    rmSync(scratch, { recursive: true, force: true });
    populateScratch(ws, scratch);

    // Root node_modules arrived in scratch
    expect(existsSync(join(scratch, 'node_modules', '.pnpm', 'dep', 'index.js'))).toBe(true);
    // Per-package node_modules also arrived
    expect(existsSync(join(scratch, 'packages', 'a', 'node_modules'))).toBe(true);
    // The per-package dep entry is still a symlink — never dereferenced
    expect(lstatSync(join(scratch, 'packages', 'a', 'node_modules', 'dep')).isSymbolicLink()).toBe(
      true,
    );
    // Reading through the relative symlink resolves inside the scratch (both sides at same paths)
    expect(
      readFileSync(join(scratch, 'packages', 'a', 'node_modules', 'dep', 'index.js'), 'utf8'),
    ).toBe('module.exports=42;');
  });

  it('nested node_modules inside another node_modules is not separately walked', () => {
    const ws = tmp('kernloop-ws-');
    // Root node_modules with a nested node_modules inside (common in non-flat installs)
    mkdirSync(join(ws, 'node_modules', 'pkg', 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(ws, 'node_modules', 'pkg', 'node_modules', 'dep', 'index.js'), 'nested');
    // packages/b/ has its own node_modules — the walk must still find and copy it
    mkdirSync(join(ws, 'packages', 'b', 'node_modules'), { recursive: true });
    writeFileSync(join(ws, 'packages', 'b', 'node_modules', 'x.js'), 'pkg-b');

    const scratch = tmp('kernloop-scratch-');
    rmSync(scratch, { recursive: true, force: true });
    populateScratch(ws, scratch);

    // Nested node_modules content arrived via the root copy (not a separate walk)
    expect(
      readFileSync(join(scratch, 'node_modules', 'pkg', 'node_modules', 'dep', 'index.js'), 'utf8'),
    ).toBe('nested');
    // Per-package node_modules arrived via the walk of packages/b/
    expect(readFileSync(join(scratch, 'packages', 'b', 'node_modules', 'x.js'), 'utf8')).toBe(
      'pkg-b',
    );
    // No spurious top-level copy of the inner node_modules' parent
    expect(existsSync(join(scratch, 'pkg'))).toBe(false);
  });
});
