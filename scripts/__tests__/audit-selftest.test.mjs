import { expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, runSelfTest } from '../audit-selftest.mjs';

test('audit self-test passes against the built kernel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-selftest-'));
  expect(runSelfTest(dir)).toBeNull();
});

test('audit self-test main() exits 0', () => {
  expect(main()).toBe(0);
});
