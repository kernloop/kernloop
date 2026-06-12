import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePackageApi } from '../lib/public-api.mjs';

/** A throwaway package with the given index.ts (+ optional sibling def files). */
function fixture(indexSrc, defs = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-pubapi-'));
  const pkgSrc = path.join(root, 'packages', 'p', 'src');
  fs.mkdirSync(pkgSrc, { recursive: true });
  fs.writeFileSync(path.join(pkgSrc, 'index.ts'), indexSrc);
  for (const [name, src] of Object.entries(defs)) fs.writeFileSync(path.join(pkgSrc, name), src);
  return { root, pkgDir: path.join(root, 'packages', 'p') };
}

describe('resolvePackageApi', () => {
  test('returns empty for a package with no index.ts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-pubapi-'));
    expect(resolvePackageApi(path.join(root, 'packages', 'nope'), root)).toEqual({
      symbols: [],
      starReExports: 0,
    });
  });

  test('reads a LOCAL declaration in the barrel and marks it not-type-only', () => {
    const { root, pkgDir } = fixture('/** Local const. */\nexport const LOCAL = 1;');
    const { symbols } = resolvePackageApi(pkgDir, root);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({ name: 'LOCAL', typeOnly: false });
    expect(symbols[0].doc).toContain('Local const');
  });

  test('follows a relative re-export and resolves its definition doc', () => {
    const { root, pkgDir } = fixture("export { thing } from './def.js';", {
      'def.ts': '/** A documented thing. */\nexport function thing(): void {}',
    });
    const { symbols } = resolvePackageApi(pkgDir, root);
    expect(symbols.map((s) => s.name)).toEqual(['thing']);
    expect(symbols[0].doc).toContain('documented thing');
  });

  test('marks `export type { X }` re-exports as type-only', () => {
    const { root, pkgDir } = fixture("export type { T } from './def.js';", {
      'def.ts': 'export type T = string;',
    });
    const { symbols } = resolvePackageApi(pkgDir, root);
    expect(symbols[0]).toMatchObject({ name: 'T', typeOnly: true });
  });

  test('skips external (non-relative) re-exports — gated in their own package', () => {
    const { root, pkgDir } = fixture("export { Brief } from '@kernloop/contracts';");
    expect(resolvePackageApi(pkgDir, root).symbols).toEqual([]);
  });

  test('counts `export *` re-exports without inventing named symbols', () => {
    const { root, pkgDir } = fixture("export * from './def.js';", {
      'def.ts': 'export const X = 1;',
    });
    const { symbols, starReExports } = resolvePackageApi(pkgDir, root);
    expect(symbols).toEqual([]);
    expect(starReExports).toBe(1);
  });

  test('throws when a re-export module cannot be resolved', () => {
    const { root, pkgDir } = fixture("export { x } from './missing.js';");
    expect(() => resolvePackageApi(pkgDir, root)).toThrow('cannot resolve re-export module');
  });

  test('throws when a re-exported name is absent from its definition file', () => {
    const { root, pkgDir } = fixture("export { ghost } from './def.js';", {
      'def.ts': 'export const real = 1;',
    });
    expect(() => resolvePackageApi(pkgDir, root)).toThrow('not found in');
  });
});
