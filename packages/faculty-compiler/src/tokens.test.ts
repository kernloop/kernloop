import { describe, expect, it } from 'vitest';
import { CHARS_PER_TOKEN, estimateTokens } from './index.js';

describe('estimateTokens', () => {
  it('is documented as ceil(UTF-16 code units / 4)', () => {
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('x'.repeat(400))).toBe(100);
  });

  it('is deterministic for repeated calls on the same text', () => {
    const text = 'Goal: ship the deterministic compiler';
    expect(estimateTokens(text)).toBe(estimateTokens(text));
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });
});
