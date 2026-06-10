import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBudgets, countLoc, main } from '../loc-check.mjs';

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-loc-'));
  for (const [rel, lines] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(
      full,
      Array.from({ length: lines }, (_, i) => `const v${i} = ${i};`).join('\n'),
    );
  }
  return root;
}

describe('countLoc', () => {
  test('counts non-blank source lines, excluding tests and d.ts', () => {
    const root = makeRepo({
      'src/a.ts': 10,
      'src/b.test.ts': 500,
      'src/types.d.ts': 500,
    });
    fs.appendFileSync(path.join(root, 'src/a.ts'), '\n\n\n');
    expect(countLoc(root)).toBe(10);
  });

  test('skips node_modules, dist, coverage', () => {
    const root = makeRepo({
      'src/a.ts': 5,
      'node_modules/x/y.ts': 100,
      'dist/a.ts': 100,
      'coverage/a.ts': 100,
    });
    expect(countLoc(root)).toBe(5);
  });
});

describe('checkBudgets — deliberate-failure proof for the package LOC gate', () => {
  test('contracts package over 800 LOC fails the gate', () => {
    const root = makeRepo({ 'packages/contracts/src/big.ts': 801 });
    const results = checkBudgets(root);
    expect(results).toEqual([{ pkg: 'contracts', loc: 801, budget: 800, ok: false }]);
    expect(main(root)).toBe(1);
  });

  test('contracts package within budget passes', () => {
    const root = makeRepo({ 'packages/contracts/src/ok.ts': 799 });
    expect(checkBudgets(root)).toEqual([{ pkg: 'contracts', loc: 799, budget: 800, ok: true }]);
    expect(main(root)).toBe(0);
  });

  test('faculty packages get the 4000-LOC budget; kernel 5000', () => {
    const root = makeRepo({
      'packages/faculty-memory/src/a.ts': 4001,
      'packages/kernel/src/b.ts': 4999,
    });
    const byPkg = Object.fromEntries(checkBudgets(root).map((r) => [r.pkg, r]));
    expect(byPkg['faculty-memory'].ok).toBe(false);
    expect(byPkg['kernel'].ok).toBe(true);
  });

  test('repo without packages dir yields no results', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-loc-'));
    expect(checkBudgets(root)).toEqual([]);
  });
});
