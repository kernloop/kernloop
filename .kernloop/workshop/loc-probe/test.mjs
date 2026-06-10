import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { probe } from './tool.mjs';

test('counts non-blank lines per file and total', () => {
  fs.mkdirSync('fixture/sub', { recursive: true });
  fs.writeFileSync('fixture/a.js', 'one\n\ntwo\n');
  fs.writeFileSync('fixture/sub/b.ts', 'x\ny\nz\n\n');
  const r = probe('fixture');
  assert.equal(r.total, 5);
  assert.equal(r.files.find((f) => f.path.endsWith('a.js')).loc, 2);
  assert.equal(r.files.find((f) => f.path.endsWith('b.ts')).loc, 3);
});

test('skips node_modules and dist', () => {
  fs.mkdirSync('fixture2/node_modules', { recursive: true });
  fs.mkdirSync('fixture2/dist', { recursive: true });
  fs.writeFileSync('fixture2/node_modules/x.js', 'a\nb\n');
  fs.writeFileSync('fixture2/dist/y.js', 'c\n');
  fs.writeFileSync('fixture2/real.js', 'keep\n');
  const r = probe('fixture2');
  assert.equal(r.total, 1);
  assert.equal(r.files.length, 1);
});
