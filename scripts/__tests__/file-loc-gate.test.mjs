import { expect, test } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function fileOfLines(n) {
  return Array.from({ length: n }, (_, i) => `// line ${i + 1}`).join('\n') + '\n';
}

// P0 exit criterion 3: a 401-line file must fail the LOC gate.
test('a 401-line file fails eslint max-lines under the repo config', async () => {
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(fileOfLines(401), {
    filePath: path.join(repoRoot, 'packages/kernel/src/fixture-401.ts'),
    warnIgnored: false,
  });
  const maxLines = result.messages.filter((m) => m.ruleId === 'max-lines');
  expect(maxLines.length).toBe(1);
  expect(maxLines[0].severity).toBe(2);
});

test('a 400-line file passes the LOC gate', async () => {
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(fileOfLines(400), {
    filePath: path.join(repoRoot, 'packages/kernel/src/fixture-400.ts'),
    warnIgnored: false,
  });
  expect(result.messages.filter((m) => m.ruleId === 'max-lines')).toEqual([]);
});
