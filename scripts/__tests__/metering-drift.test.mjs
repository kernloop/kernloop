/**
 * Metering-drift comparator (#464): the static `metersUsd`/`metersTokens` adapter facts
 * (#462) must agree with a real call's runtime `metered` flags, or the static fact has
 * silently gone stale. `meteringDrift` is the pure comparator the opt-in `adapters:smoke`
 * harness runs against each live adapter; this pins its truth table hermetically.
 */
import { describe, expect, it } from 'vitest';
import { ADAPTER_NAMES, adapterDefinitions } from '@kernloop/kernel';
import { meteringDrift } from '../adapter-smoke.mjs';

describe('meteringDrift (#464)', () => {
  it('reports NO drift when the runtime metered flags match each adapter static fact', () => {
    for (const name of ADAPTER_NAMES) {
      const def = adapterDefinitions[name];
      const matching = { tokens: def.metersTokens, usd: def.metersUsd };
      expect(meteringDrift(name, matching)).toEqual([]);
    }
  });

  it('reports usd drift when a metersUsd:true adapter reports no cost (claude went stale)', () => {
    // claude statically meters usd; a call that metered usd=false is drift.
    const drift = meteringDrift('claude', { tokens: true, usd: false });
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('usd');
  });

  it('reports usd drift when a metersUsd:false adapter DID report cost (under-claiming)', () => {
    // codex statically meters tokens-only; if it started reporting usd, the fact is stale.
    const drift = meteringDrift('codex', { tokens: true, usd: true });
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('usd');
  });

  it('reports tokens drift when a metersTokens:false adapter started reporting tokens (agy)', () => {
    const drift = meteringDrift('agy', { tokens: true, usd: false });
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain('tokens');
  });

  it('reports BOTH when both flags diverge', () => {
    // ollama meters nothing; a call that metered both is two drifts.
    expect(meteringDrift('ollama', { tokens: true, usd: true })).toHaveLength(2);
  });
});
