/**
 * Overlay sub-schema helpers (#259 extraction, #252 additions). tierCandidates
 * normalizes a tier's adapter spec (string | array | undefined) to a candidate
 * list — the shared normalizer every adapters reader uses.
 */
import { describe, expect, it } from 'vitest';
import { tierCandidates, type TierAdapters } from './overlay-schemas.js';

describe('tierCandidates (#252)', () => {
  it('normalizes a single string to a one-element list', () => {
    expect(tierCandidates({ large: 'claude' }, 'large')).toEqual(['claude']);
  });

  it('returns an array spec as-is (copied)', () => {
    const adapters: TierAdapters = { large: ['claude', 'opencode'] };
    expect(tierCandidates(adapters, 'large')).toEqual(['claude', 'opencode']);
  });

  it('returns [] for an unset tier or an undefined adapters block', () => {
    expect(tierCandidates({ large: 'claude' }, 'small')).toEqual([]);
    expect(tierCandidates(undefined, 'large')).toEqual([]);
  });
});
