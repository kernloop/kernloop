import { describe, expect, it } from 'vitest';
import { adapterForTier, UnknownModelTierError } from './tier.js';

describe('adapterForTier — pure tier→adapter resolution (spec §8.4)', () => {
  it('resolves a declared tier to its configured adapter', () => {
    const cfg = { cheap: 'codex', frontier: 'claude' } as const;
    expect(adapterForTier('cheap', cfg, 'claude')).toBe('codex');
    expect(adapterForTier('frontier', cfg, 'codex')).toBe('claude');
  });

  it('falls back to the run adapter when the overlay declares no adapter for the tier', () => {
    expect(adapterForTier('cheap', {}, 'claude')).toBe('claude');
    expect(adapterForTier('frontier', { cheap: 'codex' }, 'gemini')).toBe('gemini');
  });

  it('is pure: same inputs always give the same adapter', () => {
    const cfg = { frontier: 'claude' } as const;
    expect(adapterForTier('frontier', cfg, 'codex')).toBe(adapterForTier('frontier', cfg, 'codex'));
  });

  it('fails closed on an unrecognized tier — never silently defaults upward', () => {
    expect(() => adapterForTier('luxury' as 'cheap', {}, 'claude')).toThrow(UnknownModelTierError);
  });
});
