/**
 * The diverse-panel ADAPTER SELECTION layer (#369) — the production function that
 * decides WHICH adapters form a ratification panel. Exercised directly here (the
 * executor tests inject a ready `voteDiversity`, so they bypass this), per the
 * #370 diff-review finding that the selection branch logic was unverified.
 */
import { describe, expect, it } from 'vitest';
import { diverseVoteAdapters } from './vote-diversity.js';
import type { Overlay } from '../overlay.js';

function overlayWith(
  adapters: Record<string, string | string[]>,
  endpoints: Record<string, unknown> = {},
): Overlay {
  return { adapters, endpoints } as unknown as Overlay;
}

describe('diverseVoteAdapters (#369)', () => {
  it('dedups the run adapter, excludes endpoints + non-CLI names, and stable-sorts', () => {
    const overlay = overlayWith(
      { large: ['gemini', 'codex'], medium: 'claude', frontier: 'my-endpoint' },
      { 'my-endpoint': {} },
    );
    // claude deduped (run adapter ∪ medium); my-endpoint excluded (endpoint + not a
    // CLI adapter); result deterministic (sorted) regardless of declaration order.
    expect(diverseVoteAdapters(overlay, 'claude')).toEqual(['claude', 'codex', 'gemini']);
  });

  it('returns just the run adapter with no `adapters` block (→ degraded single-oracle)', () => {
    expect(diverseVoteAdapters(overlayWith({}), 'claude')).toEqual(['claude']);
  });

  it('excludes a tier candidate that is a registered endpoint id', () => {
    const overlay = overlayWith({ large: ['gemini', 'ep1'] }, { ep1: {} });
    expect(diverseVoteAdapters(overlay, 'claude')).toEqual(['claude', 'gemini']);
  });

  it('is deterministic regardless of the run adapter (still sorted, deduped)', () => {
    const overlay = overlayWith({ large: ['claude', 'codex'] });
    expect(diverseVoteAdapters(overlay, 'gemini')).toEqual(['claude', 'codex', 'gemini']);
  });
});
