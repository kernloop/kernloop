import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEOUT_MS,
  defaultQualityChecks,
  docCommentCheck,
  isInProcessCheck,
} from './checks.js';
import { parseEslintOutput, parseTscOutput, parseVitestOutput } from './parsers.js';

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
