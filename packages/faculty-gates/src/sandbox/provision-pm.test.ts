/**
 * Package-manager provisioning tests (#548) — fixture-based, NO docker. A fake
 * corepack cache (a dist with a `bin` field + a real entry file) proves: the
 * entry is RESOLVED from the dist's own package.json (never hardcoded); the
 * shim is executable, points at the container path, and its copied target
 * exists; a missing declared version fails CLOSED with the exact actionable
 * message; and npm/absent declarations are no-ops.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cachedDistDir,
  corepackCacheRoot,
  parseDeclaredPm,
  provisionPackageManager,
  resolveEntry,
} from './provision-pm.js';

const dirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Write a workspace root package.json with the given (or no) packageManager field. */
function workspace(packageManager?: string): string {
  const ws = tmp('kernloop-pm-ws-');
  const pkg = packageManager === undefined ? {} : { packageManager };
  writeFileSync(join(ws, 'package.json'), JSON.stringify(pkg));
  return ws;
}

/** Build a fake corepack cache with a `<name>@<version>` dist (bin field + entry). */
function fakeCache(name: string, version: string, entry = 'bin/pm.cjs'): string {
  const cache = tmp('kernloop-pm-cache-');
  const dist = join(cache, 'v1', name, version);
  mkdirSync(join(dist, 'bin'), { recursive: true });
  writeFileSync(
    join(dist, 'package.json'),
    JSON.stringify({ name, version, bin: { [name]: entry } }),
  );
  writeFileSync(join(dist, entry), '#!/usr/bin/env node\nconsole.log("pm");\n');
  return cache;
}

describe('parseDeclaredPm', () => {
  it('parses pnpm@version and strips a +integrity suffix', () => {
    expect(parseDeclaredPm(workspace('pnpm@10.33.0'))).toEqual({
      name: 'pnpm',
      version: '10.33.0',
    });
    expect(parseDeclaredPm(workspace('pnpm@10.33.0+sha512.abc'))).toEqual({
      name: 'pnpm',
      version: '10.33.0',
    });
  });

  it('is a no-op (undefined) for npm, absent, or malformed fields', () => {
    expect(parseDeclaredPm(workspace('npm@10.0.0'))).toBeUndefined();
    expect(parseDeclaredPm(workspace())).toBeUndefined();
    expect(parseDeclaredPm(workspace('pnpm'))).toBeUndefined();
  });

  it('rejects a path-traversal version in the child-writable field (no-op, host FS untouched)', () => {
    // The gated CHILD can edit package.json; a crafted version must never be
    // path.joined against the host corepack cache (read-exfiltration channel).
    expect(parseDeclaredPm(workspace('pnpm@../../../../etc'))).toBeUndefined();
    expect(parseDeclaredPm(workspace('pnpm@..'))).toBeUndefined();
    expect(parseDeclaredPm(workspace('yarn@1.2.3/../../../etc'))).toBeUndefined();
  });

  it('rejects a non-semver-shaped version (slash suffix, v-prefix, wildcard)', () => {
    expect(parseDeclaredPm(workspace('pnpm@10.33.0/evil'))).toBeUndefined();
    expect(parseDeclaredPm(workspace('pnpm@v10.33.0'))).toBeUndefined();
    expect(parseDeclaredPm(workspace('pnpm@10.x'))).toBeUndefined();
    // A legitimate prerelease suffix still parses.
    expect(parseDeclaredPm(workspace('pnpm@10.33.0-beta.1'))).toEqual({
      name: 'pnpm',
      version: '10.33.0-beta.1',
    });
  });
});

describe('corepackCacheRoot / cachedDistDir', () => {
  it('honors COREPACK_HOME, else defaults under ~/.cache/node/corepack', () => {
    expect(corepackCacheRoot({ COREPACK_HOME: '/x/corepack' })).toBe('/x/corepack');
    expect(corepackCacheRoot({})).toMatch(/\.cache[/\\]node[/\\]corepack$/);
    expect(cachedDistDir({ name: 'pnpm', version: '1.2.3' }, { COREPACK_HOME: '/x' })).toBe(
      join('/x', 'v1', 'pnpm', '1.2.3'),
    );
  });

  it('throws LOUD on a dist dir escaping <cache>/v1 (belt-and-braces behind the parse)', () => {
    // Only reachable if a future refactor loosens the semver shape — the
    // containment assert must still refuse a traversal to the host FS.
    const crafted = { name: 'pnpm', version: '../../../../etc' } as const;
    expect(() => cachedDistDir(crafted, { COREPACK_HOME: '/x' })).toThrow(
      /refusing corepack cache path outside/,
    );
  });
});

describe('resolveEntry', () => {
  it('resolves the entry from the dist bin field and verifies it exists', () => {
    const cache = fakeCache('pnpm', '1.2.3', 'bin/pnpm.cjs');
    expect(resolveEntry(join(cache, 'v1', 'pnpm', '1.2.3'), 'pnpm')).toBe('bin/pnpm.cjs');
  });

  it('throws LOUD when the resolved entry file is absent (broken cache)', () => {
    const cache = tmp('kernloop-pm-broken-');
    const dist = join(cache, 'v1', 'pnpm', '1.2.3');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'package.json'), JSON.stringify({ bin: { pnpm: 'bin/gone.cjs' } }));
    expect(() => resolveEntry(dist, 'pnpm')).toThrow(/does not exist/);
  });
});

describe('provisionPackageManager', () => {
  it('resolves the entry, copies the dist, and writes a working shim', () => {
    const ws = workspace('pnpm@1.2.3');
    const cache = fakeCache('pnpm', '1.2.3', 'bin/pnpm.cjs');
    const scratch = tmp('kernloop-pm-scratch-');
    const result = provisionPackageManager(ws, scratch, { COREPACK_HOME: cache });
    expect(result.ok).toBe(true);
    // The dist was copied — the shim's target file exists in the scratch.
    const copiedEntry = join(scratch, '.kernloop-pm', 'pnpm', 'bin', 'pnpm.cjs');
    expect(existsSync(copiedEntry)).toBe(true);
    // The shim is executable, POSIX, and execs node against the CONTAINER path.
    const shimPath = join(scratch, '.kernloop-pm', 'bin', 'pnpm');
    const shim = readFileSync(shimPath, 'utf8');
    expect(shim.startsWith('#!/bin/sh\n')).toBe(true);
    expect(shim).toContain('exec node /work/.kernloop-pm/pnpm/bin/pnpm.cjs "$@"');
    expect(statSync(shimPath).mode & 0o777).toBe(0o755);
  });

  it('fails CLOSED with an actionable message when the host cache lacks the version', () => {
    const ws = workspace('pnpm@9.9.9');
    const emptyCache = tmp('kernloop-pm-empty-');
    const scratch = tmp('kernloop-pm-scratch-');
    const result = provisionPackageManager(ws, scratch, { COREPACK_HOME: emptyCache });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('workspace declares pnpm@9.9.9');
    expect(result.error).toContain('corepack prepare pnpm@9.9.9');
    // Nothing was provisioned.
    expect(existsSync(join(scratch, '.kernloop-pm'))).toBe(false);
  });

  it('is a no-op (ok, nothing written) for an npm or absent declaration', () => {
    for (const pm of ['npm@10.0.0', undefined]) {
      const scratch = tmp('kernloop-pm-scratch-');
      const result = provisionPackageManager(workspace(pm), scratch, { COREPACK_HOME: tmp('c-') });
      expect(result.ok).toBe(true);
      expect(existsSync(join(scratch, '.kernloop-pm'))).toBe(false);
    }
  });
});
