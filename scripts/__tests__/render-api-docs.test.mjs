import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  firstSentence,
  main,
  mineRefs,
  normalizeBlock,
  renderApiTable,
  renderRow,
  spliceBlock,
} from '../render-api-docs.mjs';

/** Build a throwaway repo with one package barrel that re-exports a definition file. */
function fixtureRepo(indexSrc, defSrc) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-apidoc-'));
  const pkgSrc = path.join(root, 'packages', 'contracts', 'src');
  fs.mkdirSync(pkgSrc, { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(pkgSrc, 'index.ts'), indexSrc);
  fs.writeFileSync(path.join(pkgSrc, 'def.ts'), defSrc);
  return root;
}

const DEF = [
  '/** Routes a TaskContract to a manifest [CLM-0026] (spec §3.4). Extra prose. */',
  'export function routeTask(): number {',
  '  return 1;',
  '}',
  '/** A neutral prior. */',
  'export const NEUTRAL = 0.5;',
].join('\n');

const INDEX = ['/** Barrel. */', "export { routeTask, NEUTRAL } from './def.js';"].join('\n');

describe('firstSentence', () => {
  test('keeps only the first sentence and escapes table pipes', () => {
    expect(firstSentence('First one. Second one.')).toBe('First one.');
    expect(firstSentence('Has a | pipe. Tail.')).toBe('Has a \\| pipe.');
  });
  test('null/empty doc → empty string', () => {
    expect(firstSentence(null)).toBe('');
    expect(firstSentence('   ')).toBe('');
  });
});

describe('mineRefs', () => {
  test('extracts CLM and spec § references already present, deduped', () => {
    expect(mineRefs('does X [CLM-0026] per spec §3.4 and spec §3.4 again')).toEqual([
      '[CLM-0026]',
      'spec §3.4',
    ]);
  });
  test('no refs → empty array; null → empty array', () => {
    expect(mineRefs('plain prose')).toEqual([]);
    expect(mineRefs(null)).toEqual([]);
  });
});

describe('renderRow', () => {
  test('mines name, kind, first sentence, and refs from the symbol JSDoc', () => {
    const row = renderRow('contracts', {
      name: 'routeTask',
      kind: 'FunctionDeclaration',
      doc: 'Routes a TaskContract [CLM-0026] (spec §3.4). More.',
    });
    expect(row).toContain('`contracts`');
    expect(row).toContain('`routeTask`');
    expect(row).toContain('| Function |');
    expect(row).toContain('Routes a TaskContract [CLM-0026] (spec §3.4).');
    expect(row).toContain('[CLM-0026] spec §3.4');
  });
});

describe('renderApiTable — mined from real re-exported JSDoc', () => {
  test('follows a barrel re-export to the definition and mines its doc', () => {
    const root = fixtureRepo(INDEX, DEF);
    const table = renderApiTable(root, ['contracts']);
    expect(table).toContain('`routeTask`');
    expect(table).toContain('Routes a TaskContract'); // mined summary, not synthesized
    expect(table).toContain('[CLM-0026]'); // pre-existing ref carried through
    expect(table).toContain('spec §3.4');
    expect(table).toContain('`NEUTRAL`');
  });
});

describe('main --check drift behaviour', () => {
  test('green when committed API.md matches, red after the source JSDoc changes', () => {
    const root = fixtureRepo(INDEX, DEF);
    // Point the gated set at our single fixture package via a wrapper repo:
    // main() iterates GATED_PACKAGES, so emulate by writing the table directly.
    fs.writeFileSync(
      path.join(root, 'docs', 'API.md'),
      `# x\n\n<!-- api:begin -->\n<!-- api:end -->\n`,
    );
    // Stub the gated set down to our one package by re-rendering through spliceBlock.
    const table = renderApiTable(root, ['contracts']);
    const apiPath = path.join(root, 'docs', 'API.md');
    fs.writeFileSync(apiPath, spliceBlock(fs.readFileSync(apiPath, 'utf8'), table));
    const committed = fs.readFileSync(apiPath, 'utf8');
    // A matching block normalizes identically (drift-free).
    expect(normalizeBlock(committed)).toBe(normalizeBlock(spliceBlock(committed, table)));
    // Mutating the mined source JSDoc makes the regenerated block differ → drift.
    fs.writeFileSync(
      path.join(root, 'packages', 'contracts', 'src', 'def.ts'),
      DEF.replace('Routes a TaskContract', 'COMPLETELY DIFFERENT SUMMARY'),
    );
    const drifted = renderApiTable(root, ['contracts']);
    expect(normalizeBlock(committed)).not.toBe(normalizeBlock(spliceBlock(committed, drifted)));
  });

  test('spliceBlock throws when the api markers are missing', () => {
    expect(() => spliceBlock('# no markers', 't')).toThrow('markers');
  });

  test('main writes then is --check green against the real repo', () => {
    const repoRoot = path.resolve(import.meta.dirname, '..', '..');
    // Render against the real repo into a temp copy of docs/API.md path is not
    // safe; instead assert the committed doc is current (the CI invariant).
    expect(main(repoRoot, true)).toBe(0);
  });
});
