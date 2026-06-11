import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, scanTree } from '../wiring-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function makePackages(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-wiring-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, 'packages', rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

describe('wiring-check — gates constitutional rule 1 (wiring-complete or absent)', () => {
  test('a TODO comment in package source fails the gate', () => {
    const root = makePackages({ 'kernel/src/a.ts': 'export const a = 1;\n// TODO: later\n' });
    const findings = scanTree(path.join(root, 'packages'), root);
    expect(findings).toEqual([
      { file: path.join('packages', 'kernel', 'src', 'a.ts'), line: 2, marker: 'TODO' },
    ]);
    expect(main(root)).toBe(1);
  });

  test('a fully-wired clean file passes the gate', () => {
    const root = makePackages({ 'kernel/src/b.ts': 'export const b = 2;\n// a normal comment\n' });
    expect(scanTree(path.join(root, 'packages'), root)).toEqual([]);
    expect(main(root)).toBe(0);
  });

  test('*.test.ts files are excluded even when they contain a TODO', () => {
    const root = makePackages({
      'kernel/src/c.test.ts': '// TODO: write more tests\nexport const c = 3;\n',
    });
    expect(scanTree(path.join(root, 'packages'), root)).toEqual([]);
    expect(main(root)).toBe(0);
  });

  test("a 'not implemented' string in package source fails the gate", () => {
    const root = makePackages({
      'faculty-gates/src/d.ts':
        "export function d() {\n  throw new Error('not implemented yet');\n}\n",
    });
    const findings = scanTree(path.join(root, 'packages'), root);
    expect(findings.map((f) => f.marker)).toContain('not implemented');
    expect(main(root)).toBe(1);
  });

  test('a TODO inside a production string literal (not a comment) does not trip the comment marker', () => {
    const root = makePackages({
      'kernel/src/e.ts': "export const label = 'TODO list feature';\n",
    });
    expect(scanTree(path.join(root, 'packages'), root)).toEqual([]);
    expect(main(root)).toBe(0);
  });

  test('the REAL packages/ tree is wiring-complete: main(repoRoot) === 0', () => {
    expect(main(repoRoot)).toBe(0);
  });
});
