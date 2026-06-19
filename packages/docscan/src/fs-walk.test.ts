/**
 * The shared workspace walk (#278): a LAZY generator that streams paths instead
 * of materializing a `string[]` of every path — so an untrusted many-files
 * workspace cannot build an unbounded array before a byte budget engages — while
 * preserving the load-bearing guarantees: SKIP_DIRS are pruned and symlinks are
 * never recursed (no filesystem escape).
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { walkFiles } from './fs-walk.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-fswalk-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function touch(rel: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, 'x', 'utf8');
}

describe('walkFiles (#278)', () => {
  it('yields every file recursively (correctness preserved through the generator refactor)', () => {
    touch('a.ts');
    touch('sub/b.ts');
    touch('sub/deep/c.ts');
    const got = new Set([...walkFiles(dir)].map((p) => p.slice(dir.length + 1)));
    expect(got).toEqual(new Set(['a.ts', join('sub', 'b.ts'), join('sub', 'deep', 'c.ts')]));
  });

  it('prunes SKIP_DIRS (node_modules, .git, dist, …) without descending', () => {
    touch('keep.ts');
    touch('node_modules/pkg/index.ts');
    touch('.git/config');
    touch('dist/out.js');
    const got = [...walkFiles(dir)].map((p) => p.slice(dir.length + 1));
    expect(got).toEqual(['keep.ts']);
  });

  it('never recurses a symlinked directory (no filesystem escape)', () => {
    touch('real/secret.ts');
    symlinkSync(join(dir, 'real'), join(dir, 'link')); // a symlink to a dir
    const got = [...walkFiles(dir)].map((p) => p.slice(dir.length + 1));
    // The real file is yielded; the symlink (lstat type ≠ dir/file) is skipped,
    // so its target's contents are NOT re-walked through the link.
    expect(got).toEqual([join('real', 'secret.ts')]);
  });

  it('streams lazily as a generator — one path at a time, no up-front array', () => {
    touch('a.ts');
    touch('b.ts');
    const gen = walkFiles(dir);
    expect(typeof gen.next).toBe('function'); // a Generator, not a materialized string[]
    const first = gen.next();
    expect(first.done).toBe(false);
    expect(typeof first.value).toBe('string'); // got one WITHOUT walking the whole tree
  });

  it('an unreadable directory yields nothing and never throws', () => {
    expect([...walkFiles(join(dir, 'does-not-exist'))]).toEqual([]);
  });
});
