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
  for (const [name, src] of Object.entries(defs)) {
    const dest = path.join(pkgSrc, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, src);
  }
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

  test('EXPANDS a relative `export *` into every named symbol (#72)', () => {
    const { root, pkgDir } = fixture("export * from './def.js';", {
      'def.ts':
        '/** A starred const. */\nexport const X = 1;\n/** A starred fn. */\nexport function y(): void {}',
    });
    const { symbols, starReExports } = resolvePackageApi(pkgDir, root);
    expect(symbols.map((s) => s.name).sort()).toEqual(['X', 'y']);
    expect(symbols.find((s) => s.name === 'X').doc).toContain('starred const');
    expect(starReExports).toBe(0); // a RELATIVE star is resolved, not counted
  });

  test('counts an EXTERNAL `export *` opaquely (gated in its own package)', () => {
    const { root, pkgDir } = fixture("export * from '@kernloop/contracts';");
    const { symbols, starReExports } = resolvePackageApi(pkgDir, root);
    expect(symbols).toEqual([]);
    expect(starReExports).toBe(1);
  });

  test('chases a NAMED re-export through a NESTED barrel to the real doc (#72)', () => {
    const { root, pkgDir } = fixture("export { deep } from './inner/index.js';", {
      'inner/index.ts': "export { deep } from './def.js';",
      'inner/def.ts': '/** The deep declaration. */\nexport function deep(): void {}',
    });
    const { symbols } = resolvePackageApi(pkgDir, root);
    expect(symbols.map((s) => s.name)).toEqual(['deep']);
    expect(symbols[0].doc).toContain('deep declaration');
    expect(symbols[0].file).toContain('inner/def.ts'); // resolved to the real origin
  });

  test('EXPANDS a star that passes THROUGH a nested barrel (#72)', () => {
    const { root, pkgDir } = fixture("export * from './inner/index.js';", {
      'inner/index.ts': "export * from './def.js';",
      'inner/def.ts': '/** Doc. */\nexport const THROUGH = 1;',
    });
    const { symbols } = resolvePackageApi(pkgDir, root);
    expect(symbols.map((s) => s.name)).toEqual(['THROUGH']);
  });

  test('an explicit local/named export SHADOWS a star of the same name', () => {
    const { root, pkgDir } = fixture(
      "/** The real one. */\nexport const DUP = 1;\nexport * from './def.js';",
      { 'def.ts': '/** The starred one. */\nexport const DUP = 2;' },
    );
    const { symbols } = resolvePackageApi(pkgDir, root);
    expect(symbols.filter((s) => s.name === 'DUP')).toHaveLength(1);
    expect(symbols.find((s) => s.name === 'DUP').doc).toContain('real one');
  });

  test('breaks a re-export CYCLE instead of looping forever', () => {
    const { root, pkgDir } = fixture(
      "/** Top. */\nexport const TOP = 1;\nexport * from './a.js';",
      {
        'a.ts': "/** A. */\nexport const A = 1;\nexport * from './b.js';",
        'b.ts': "/** B. */\nexport const B = 1;\nexport * from './a.js';",
      },
    );
    const { symbols } = resolvePackageApi(pkgDir, root);
    expect(symbols.map((s) => s.name).sort()).toEqual(['A', 'B', 'TOP']);
  });

  test('surfaces a BARE local re-export `export { foo }` (no from) (#213)', () => {
    // declare-then-export-at-bottom: foo has no inline export modifier, so the old
    // resolver missed it entirely — an undocumented value export escaping the gate.
    const { root, pkgDir } = fixture(
      '/** A bare-exported helper. */\nfunction helper() {}\nexport { helper };',
    );
    const { symbols } = resolvePackageApi(pkgDir, root);
    expect(symbols.map((s) => s.name)).toEqual(['helper']);
    expect(symbols[0].kind).toBe('FunctionDeclaration');
    expect(symbols[0].doc).toContain('bare-exported helper');
  });

  test('resolves a RENAME re-export `export { X as Y } from` under the alias (#214)', () => {
    const { root, pkgDir } = fixture("export { X as Y } from './def.js';", {
      'def.ts': '/** The X declaration. */\nexport const X = 1;',
    });
    const { symbols } = resolvePackageApi(pkgDir, root);
    expect(symbols.map((s) => s.name)).toEqual(['Y']); // surfaced under the alias
    expect(symbols[0].doc).toContain('X declaration'); // doc mined from the local X
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
