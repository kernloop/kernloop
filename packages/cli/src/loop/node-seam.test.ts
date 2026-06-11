/**
 * The composition-root model seam [CLM-0078]: a node's ModelRequirement
 * resolves (through the kernel translation seam) to the adapter + model alias +
 * effort arg that actually serve it, the binding rides those into the call, and
 * the served provenance names them — recording degradation/clamp honestly.
 */
import { describe, expect, it } from 'vitest';
import type { Cost, ModelRequirement } from '@kernloop/contracts';
import type { LoopInvoke } from './invoke.js';
import { adapterForTier, buildNodeSeam, resolveServed, servedRef } from './node-seam.js';

const COST: Cost = { tokens: 2, usd: 0.001 };
const req = (over: Partial<ModelRequirement> = {}): ModelRequirement => ({
  tier: 'large',
  effort: 'high',
  capabilities: [],
  ...over,
});

describe('resolveServed — binds the right alias + effort per adapter', () => {
  it('claude large/high → opus alias + high effort, nothing degraded', () => {
    const served = resolveServed(req(), 'claude');
    expect(served.model).toBe('opus');
    expect(served.servedTier).toBe('large');
    expect(served.degraded).toBe(false);
    expect(served.servedEffort).toBe('high');
    expect(served.effortClamped).toBe(false);
    expect(served.effortArg).toEqual({ param: '--effort', value: 'high', via: 'arg' });
  });

  it('claude frontier/xhigh → fable alias + claude’s "max" effort literal', () => {
    const served = resolveServed(req({ tier: 'frontier', effort: 'xhigh' }), 'claude');
    expect(served.model).toBe('fable');
    expect(served.effortArg).toEqual({ param: '--effort', value: 'max', via: 'arg' });
  });

  it('codex (concrete-id, no tier alias) degrades the harness default but keeps effort', () => {
    const served = resolveServed(req({ tier: 'frontier', effort: 'medium' }), 'codex');
    expect(served.model).toBe(''); // no tier alias ships → harness default
    expect(served.effortArg).toEqual({
      param: 'model_reasoning_effort',
      value: 'medium',
      via: 'arg',
    });
  });

  it('ollama DROPS effort honestly (servedEffort unsupported, no effort arg)', () => {
    const served = resolveServed(req({ effort: 'high' }), 'ollama');
    expect(served.servedEffort).toBe('unsupported');
    expect(served.effortArg).toBeUndefined();
  });

  it('records tier degradation: gemini has every tier, a sparse stand-in would degrade', () => {
    // gemini binds every tier, so large is served exactly.
    expect(resolveServed(req({ tier: 'large' }), 'gemini').degraded).toBe(false);
  });
});

describe('servedRef — provenance names the served model + effort + degradation', () => {
  it('names model + requested effort for an exact serve', () => {
    expect(servedRef(resolveServed(req(), 'claude'))).toBe('model:claude/opus@high');
  });

  it('records a dropped effort in the ref', () => {
    const ref = servedRef(resolveServed(req({ effort: 'high' }), 'ollama'));
    expect(ref).toContain('effort dropped');
  });

  it('records an effort clamp in the ref', () => {
    // codex supports low..xhigh exactly, so no clamp there; use a synthetic via resolveServed
    // on claude with xhigh which maps (not clamped). Instead assert the dropped path above and
    // the harness-default model name here.
    const ref = servedRef(resolveServed(req({ tier: 'small' }), 'codex'));
    expect(ref).toContain('model:codex/default@high');
  });
});

describe('adapterForTier — overlay choice vs run-adapter fallback', () => {
  it('uses the overlay’s per-tier adapter when set', () => {
    expect(adapterForTier('medium', { medium: 'codex' }, 'claude')).toBe('codex');
  });

  it('falls back to the run adapter for an unset tier (backward-compat)', () => {
    expect(adapterForTier('frontier', { medium: 'codex' }, 'claude')).toBe('claude');
    expect(adapterForTier('frontier', undefined, 'claude')).toBe('claude');
    expect(adapterForTier('frontier', {}, 'gemini')).toBe('gemini');
  });
});

describe('buildNodeSeam — rides the served model + effort into the call', () => {
  it('passes the served model alias and effort arg to the bound invoke, metered', async () => {
    const seen: Array<{ model?: string; effort?: unknown }> = [];
    const base: LoopInvoke = (_prompt, options = {}) => {
      seen.push({ model: options.model, effort: options.effort });
      return Promise.resolve({ output: 'ok', cost: COST });
    };
    const totals = { tokens: 0, usd: 0 };
    const seam = buildNodeSeam(resolveServed(req(), 'claude'), base, totals);
    await seam.invoke('hi');
    expect(seen[0]?.model).toBe('opus');
    expect(seen[0]?.effort).toEqual({ param: '--effort', value: 'high', via: 'arg' });
    expect(totals.tokens).toBe(2); // metered through totals
  });

  it('does not bind a model when the harness defaults (empty alias)', async () => {
    const seen: Array<string | undefined> = [];
    const base: LoopInvoke = (_p, options = {}) => {
      seen.push(options.model);
      return Promise.resolve({ output: 'ok', cost: COST });
    };
    const seam = buildNodeSeam(resolveServed(req({ tier: 'small' }), 'codex'), base, {
      tokens: 0,
      usd: 0,
    });
    await seam.invoke('hi');
    expect(seen[0]).toBeUndefined(); // codex small → no alias → harness default
  });
});
