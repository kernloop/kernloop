/**
 * Per-tier model PIN for a CLI adapter (#393, CLM-0166). An overlay can pin a
 * concrete model onto a harness-routed CLI adapter (opencode) per tier, so
 * kernloop runs `opencode -m <model>` for a kernloop-chosen model instead of the
 * CLI's own auto-router. This file proves: (1) the pin merges OVER the adapter's
 * `tierBinding` in `resolveServed`; (2) an unpinned tier keeps the adapter
 * default; (3) `adapterModelOverride` is CLI-only (inert for an endpoint id);
 * (4) the honesty invariant CLM-0130 — the selector's PREDICTION
 * (`resolveServedFor`) equals node-bind's CALL-TIME binding (`resolveServed` via
 * the same override) under a pin, so a pin can never silently drift them apart.
 */
import { describe, expect, it } from 'vitest';
import type { ModelRequirement } from '@kernloop/contracts';
import { resolveServed } from './node-seam.js';
import { resolveServedFor } from './resolve-served.js';
import { adapterModelOverride, type AdapterModels } from '../overlay-schemas.js';
import type { Endpoints } from '../endpoints.js';

const req = (over: Partial<ModelRequirement> = {}): ModelRequirement => ({
  tier: 'large',
  effort: 'high',
  capabilities: [],
  ...over,
});

describe('resolveServed — per-tier model pin (#393, CLM-0166)', () => {
  it('pins opencode’s large tier to a kernloop-chosen model (was harness default "")', () => {
    // Without a pin, opencode large resolves to '' (its auto-router picks).
    expect(resolveServed(req({ tier: 'large' }), 'opencode').model).toBe('');
    // With a pin, kernloop drives a concrete model id into the call.
    const served = resolveServed(req({ tier: 'large' }), 'opencode', { large: 'custom-api/big' });
    expect(served.model).toBe('custom-api/big');
    expect(served.servedTier).toBe('large');
    expect(served.degraded).toBe(false);
  });

  it('an UNpinned tier keeps the adapter default — the pin merges over, not replaces', () => {
    // Pin only `large`; a `medium` request still gets opencode's '' default.
    const served = resolveServed(req({ tier: 'medium' }), 'opencode', { large: 'custom-api/big' });
    expect(served.model).toBe('');
  });

  it('a pin overrides even a catalogued tierBinding (claude large opus → pinned id)', () => {
    expect(resolveServed(req({ tier: 'large' }), 'claude').model).toBe('opus'); // catalogued
    const served = resolveServed(req({ tier: 'large' }), 'claude', { large: 'pinned-model' });
    expect(served.model).toBe('pinned-model');
  });

  it('MIXED config in one block — pinned tiers bind, unpinned tiers keep the default', () => {
    // The partial-merge precedence is the core behavior: one block pins large+small,
    // leaves frontier+medium unset → opencode's auto-router ('') on those tiers.
    const pin = { large: 'custom-api/big', small: 'custom-api/tiny' };
    expect(resolveServed(req({ tier: 'large' }), 'opencode', pin).model).toBe('custom-api/big');
    expect(resolveServed(req({ tier: 'small' }), 'opencode', pin).model).toBe('custom-api/tiny');
    expect(resolveServed(req({ tier: 'frontier' }), 'opencode', pin).model).toBe('');
    expect(resolveServed(req({ tier: 'medium' }), 'opencode', pin).model).toBe('');
  });
});

describe('adapterModelOverride — CLI-only lookup', () => {
  const models: AdapterModels = { opencode: { large: 'custom-api/big' } };
  it('returns the per-tier map for a built-in CLI adapter', () => {
    expect(adapterModelOverride(models, 'opencode')).toEqual({ large: 'custom-api/big' });
  });
  it('is inert for a non-CLI name (an endpoint id carries its own models)', () => {
    expect(adapterModelOverride(models, 'my-endpoint')).toBeUndefined();
  });
  it('is undefined when no block is configured', () => {
    expect(adapterModelOverride(undefined, 'opencode')).toBeUndefined();
  });
});

describe('predicted==served under a pin (CLM-0130, #393)', () => {
  const NO_ENDPOINTS: Endpoints = {};
  const models: AdapterModels = {
    opencode: { large: 'custom-api/big', medium: 'custom-api/small' },
  };

  it('prediction equals call-time binding under a pin (CLM-0130)', () => {
    // The selector predicts via resolveServedFor; node-bind binds via resolveServed
    // with adapterModelOverride. They must agree or live-fitness would credit a
    // model that didn't serve — exactly the drift #271 guards against.
    const predicted = resolveServedFor(req({ tier: 'large' }), 'opencode', NO_ENDPOINTS, models);
    const bound = resolveServed(
      req({ tier: 'large' }),
      'opencode',
      adapterModelOverride(models, 'opencode'),
    );
    expect(predicted).toEqual(bound);
    expect(predicted.model).toBe('custom-api/big');
  });

  // Parametrized coverage across every tier (names are dynamic — not cited as claim
  // evidence; the static-named case above is the load-bearing CLM-0130 assertion).
  for (const tier of ['frontier', 'large', 'medium', 'small'] as const) {
    it(`opencode/${tier}: prediction equals call-time binding`, () => {
      const predicted = resolveServedFor(req({ tier }), 'opencode', NO_ENDPOINTS, models);
      const bound = resolveServed(
        req({ tier }),
        'opencode',
        adapterModelOverride(models, 'opencode'),
      );
      expect(predicted).toEqual(bound);
    });
  }
});
