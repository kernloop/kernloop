import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  checksFromDefinitionOfDone,
  defaultQualityChecks,
  docCommentCheck,
  isInProcessCheck,
} from './checks.js';
import { parseEslintOutput, parseTscOutput, parseVitestOutput } from './parsers.js';

describe('checksFromDefinitionOfDone (#226)', () => {
  it('maps each DoD Check to a no-shell subprocess check, tokenized on whitespace', () => {
    const [check] = checksFromDefinitionOfDone([
      { name: 'acceptance', command: 'node verify.mjs --strict' },
    ]);
    expect(check !== undefined && isInProcessCheck(check)).toBe(false);
    expect(check).toMatchObject({
      name: 'dod:acceptance',
      command: 'node',
      args: ['verify.mjs', '--strict'],
    });
  });

  it('does NOT shell-interpret the command — metacharacters become literal argv', () => {
    const [check] = checksFromDefinitionOfDone([
      { name: 'x', command: 'echo a; rm -rf b && curl evil' },
    ]);
    // No shell: `;` and `&&` are just arguments to `echo`, never separators/operators.
    expect(check).toMatchObject({
      command: 'echo',
      args: ['a;', 'rm', '-rf', 'b', '&&', 'curl', 'evil'],
    });
  });

  it('a blank command yields an empty executable that fails to start (fail CLOSED)', () => {
    const [check] = checksFromDefinitionOfDone([{ name: 'blank', command: '   ' }]);
    expect(check?.command).toBe(''); // spawn('') errors → a failed-to-start error finding, never a silent pass
  });

  it('an empty definition-of-done maps to no checks (backward-compat)', () => {
    expect(checksFromDefinitionOfDone([])).toEqual([]);
  });
});

describe('defaultQualityChecks', () => {
  it('default checks cover typecheck, lint, test, and the doc-comment scan', () => {
    const checks = defaultQualityChecks();
    expect(checks.map((c) => c.name)).toEqual(['typecheck', 'lint', 'test', 'doc-comments']);
  });

  it('the three tool checks are subprocess `pnpm` runs; doc-comments is in-process', () => {
    const checks = defaultQualityChecks();
    const subprocess = checks.filter((c) => !isInProcessCheck(c));
    expect(subprocess.map((c) => (isInProcessCheck(c) ? null : c.command))).toEqual([
      'pnpm',
      'pnpm',
      'pnpm',
    ]);
    expect(subprocess.map((c) => (isInProcessCheck(c) ? null : c.args))).toEqual([
      ['typecheck'],
      ['lint'],
      ['test'],
    ]);
    const docCheck = checks.find((c) => c.name === 'doc-comments');
    expect(docCheck !== undefined && isInProcessCheck(docCheck)).toBe(true);
  });

  it('wires each subprocess check to its tool-specific parser', () => {
    const [typecheck, lint, test] = defaultQualityChecks();
    expect(typecheck !== undefined && !isInProcessCheck(typecheck) && typecheck.parse).toBe(
      parseTscOutput,
    );
    expect(lint !== undefined && !isInProcessCheck(lint) && lint.parse).toBe(parseEslintOutput);
    expect(test !== undefined && !isInProcessCheck(test) && test.parse).toBe(parseVitestOutput);
  });

  it('docCommentCheck is an in-process check named doc-comments', () => {
    const check = docCommentCheck();
    expect(check.name).toBe('doc-comments');
    expect(isInProcessCheck(check)).toBe(true);
    expect(typeof check.run).toBe('function');
  });

  it('isInProcessCheck discriminates the union by the `run` property', () => {
    expect(isInProcessCheck({ name: 'd', run: () => [] })).toBe(true);
    expect(isInProcessCheck({ name: 't', command: 'pnpm', args: ['test'], parse: () => [] })).toBe(
      false,
    );
  });

  it('returns a fresh array each call', () => {
    expect(defaultQualityChecks()).not.toBe(defaultQualityChecks());
  });

  it('defaults the per-check timeout to two minutes', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(120_000);
  });
});
