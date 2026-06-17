/**
 * Workspace copy-in safety (#236, binding conditions): credentials/VCS are never
 * copied into the scratch (positive assertion, not just a denylist claim), and a
 * symlink that escapes the workspace is NOT dereferenced (its target content
 * never lands in the scratch).
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  existsSync,
  readFileSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isCopyable, copyWorkspaceSource } from './copy.js';

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
});
