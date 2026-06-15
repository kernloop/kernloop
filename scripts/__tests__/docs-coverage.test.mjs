import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GATED_PACKAGES,
  gapsForPackage,
  isTrivialDoc,
  main,
  runCoverage,
} from '../docs-coverage.mjs';

/** A throwaway package whose barrel re-exports a definition file under test. */
function fixturePkg(indexSrc, defSrc) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-doccov-'));
  const pkgSrc = path.join(root, 'packages', 'contracts', 'src');
  fs.mkdirSync(pkgSrc, { recursive: true });
  fs.writeFileSync(path.join(pkgSrc, 'index.ts'), indexSrc);
  fs.writeFileSync(path.join(pkgSrc, 'def.ts'), defSrc);
  return root;
}

describe('isTrivialDoc — placeholder rejection', () => {
  test('null / empty / whitespace are trivial', () => {
    expect(isTrivialDoc(null, 'x')).toBe(true);
    expect(isTrivialDoc('', 'x')).toBe(true);
    expect(isTrivialDoc('   ', 'x')).toBe(true);
  });
  test('a doc that merely restates the symbol name is trivial', () => {
    expect(isTrivialDoc('routeTask', 'routeTask')).toBe(true);
    expect(isTrivialDoc('Route Task.', 'routeTask')).toBe(true);
    expect(isTrivialDoc('ManifestSchema', 'ManifestSchema')).toBe(true);
    expect(isTrivialDoc('Manifest', 'ManifestSchema')).toBe(true); // Schema suffix stripped
  });
  test('a bare TODO is trivial', () => {
    expect(isTrivialDoc('TODO document this', 'x')).toBe(true);
  });
  test('a real description is NOT trivial', () => {
    expect(isTrivialDoc('Routes a TaskContract to its manifest.', 'routeTask')).toBe(false);
  });
});

describe('gapsForPackage — undocumented value exports', () => {
  test('flags an undocumented exported function, ignores documented ones', () => {
    const root = fixturePkg(
      "export { documented, bare } from './def.js';",
      [
        '/** A real description of the documented export. */',
        'export function documented(): void {}',
        'export function bare(): void {}',
      ].join('\n'),
    );
    const gaps = gapsForPackage(path.join(root, 'packages', 'contracts'), root);
    expect(gaps.map((g) => g.name)).toEqual(['bare']);
  });

  test('a placeholder doc that restates the name still counts as a gap', () => {
    const root = fixturePkg(
      "export { routeTask } from './def.js';",
      ['/** routeTask */', 'export function routeTask(): void {}'].join('\n'),
    );
    const gaps = gapsForPackage(path.join(root, 'packages', 'contracts'), root);
    expect(gaps.map((g) => g.name)).toEqual(['routeTask']);
  });

  test('type-only re-exports are excluded from the value-export gate', () => {
    const root = fixturePkg(
      "export type { BareType } from './def.js';",
      ['export type BareType = string;'].join('\n'),
    );
    const gaps = gapsForPackage(path.join(root, 'packages', 'contracts'), root);
    expect(gaps).toEqual([]); // a TYPE re-export is excluded by policy, not a gap
  });

  test('an undocumented value reached through a NESTED barrel is still a gap (#72)', () => {
    // index → inner barrel → def: the recursive resolver must chase both hops
    // and surface the deep declaration so its missing doc is caught.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-doccov-'));
    const pkgSrc = path.join(root, 'packages', 'contracts', 'src');
    fs.mkdirSync(pkgSrc, { recursive: true });
    fs.writeFileSync(path.join(pkgSrc, 'index.ts'), "export { deep } from './inner/index.js';");
    fs.mkdirSync(path.join(pkgSrc, 'inner'), { recursive: true });
    fs.writeFileSync(path.join(pkgSrc, 'inner', 'index.ts'), "export { deep } from './def.js';");
    fs.writeFileSync(path.join(pkgSrc, 'inner', 'def.ts'), 'export function deep(): void {}');
    const gaps = gapsForPackage(path.join(root, 'packages', 'contracts'), root);
    expect(gaps.map((g) => g.name)).toEqual(['deep']);
  });
});

describe('runCoverage / main — the real gated repo', () => {
  test('every gated package has zero undocumented value exports (the CI invariant)', () => {
    const repoRoot = path.resolve(import.meta.dirname, '..', '..');
    const { report, total } = runCoverage(repoRoot);
    expect(report.map((r) => r.pkg)).toEqual(GATED_PACKAGES);
    expect(total).toBe(0);
  });

  test('main exits 0 against the real repo', () => {
    const repoRoot = path.resolve(import.meta.dirname, '..', '..');
    expect(main(repoRoot)).toBe(0);
  });

  test('main exits 1 when a gated package has an undocumented value export', () => {
    const root = fixturePkg("export { bare } from './def.js';", 'export function bare(): void {}');
    expect(main(root)).toBe(1); // runs the default GATED_PACKAGES, but our fixture
    // only defines `contracts`; the missing packages resolve to empty (no index.ts)
    // so the single undocumented `bare` is the lone gap that fails the gate.
  });
});
