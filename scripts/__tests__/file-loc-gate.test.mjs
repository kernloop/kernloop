import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const eslintBin = path.join(repoRoot, 'node_modules', '.bin', 'eslint');

function lintLines(n, virtualPath) {
  const content = Array.from({ length: n }, (_, i) => `// line ${i + 1}`).join('\n') + '\n';
  let stdout;
  try {
    stdout = execFileSync(
      eslintBin,
      ['--stdin', '--stdin-filename', virtualPath, '--format', 'json', '--no-warn-ignored'],
      { cwd: repoRoot, input: content, encoding: 'utf8' },
    );
  } catch (err) {
    stdout = err.stdout; // eslint exits 1 when it reports errors
  }
  return JSON.parse(stdout)[0].messages;
}

// P0 exit criterion 3: a 401-line file must fail the LOC gate.
test('a 401-line file fails eslint max-lines under the real repo config', () => {
  const messages = lintLines(401, 'packages/kernel/src/fixture-401.ts');
  const maxLines = messages.filter((m) => m.ruleId === 'max-lines');
  expect(maxLines.length).toBe(1);
  expect(maxLines[0].severity).toBe(2);
});

test('a 400-line file passes the LOC gate', () => {
  const messages = lintLines(400, 'packages/kernel/src/fixture-400.ts');
  expect(messages.filter((m) => m.ruleId === 'max-lines')).toEqual([]);
});
