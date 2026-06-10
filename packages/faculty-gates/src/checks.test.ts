import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEOUT_MS, defaultQualityChecks } from './checks.js';
import { parseEslintOutput, parseTscOutput, parseVitestOutput } from './parsers.js';

describe('defaultQualityChecks', () => {
  it('default checks cover typecheck, lint, and test (coverage rides the test exit)', () => {
    const checks = defaultQualityChecks();
    expect(checks.map((c) => c.name)).toEqual(['typecheck', 'lint', 'test']);
    expect(checks.every((c) => c.command === 'pnpm')).toBe(true);
    expect(checks.map((c) => c.args)).toEqual([['typecheck'], ['lint'], ['test']]);
  });

  it('wires each default check to its tool-specific parser', () => {
    const [typecheck, lint, test] = defaultQualityChecks();
    expect(typecheck?.parse).toBe(parseTscOutput);
    expect(lint?.parse).toBe(parseEslintOutput);
    expect(test?.parse).toBe(parseVitestOutput);
  });

  it('returns a fresh array each call', () => {
    expect(defaultQualityChecks()).not.toBe(defaultQualityChecks());
  });

  it('defaults the per-check timeout to two minutes', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(120_000);
  });
});
