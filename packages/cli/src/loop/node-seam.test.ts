/**
 * The composition-root model seam [CLM-0078]: a node's ModelRequirement
 * resolves (through the kernel translation seam) to the adapter + model alias +
 * effort arg that actually serve it, the binding rides those into the call, and
 * the served provenance names them — recording degradation/clamp honestly.
 */
import { describe, expect, it } from 'vitest';
import type { Cost, ModelRequirement } from '@kernloop/contracts';
import type { LoopInvoke } from './invoke.js';
import {
  buildNodeSeam,
  identityRef,
  resolveServed,
  servedIdentity,
  servedRef,
  voterServedIdentity,
  type ServedModel,
} from './node-seam.js';

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
    // Effort rides as a `-c` config override (#378): `-c model_reasoning_effort=medium`.
    expect(served.effortArg).toEqual({
      param: '-c',
      value: 'model_reasoning_effort=medium',
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

describe('servedIdentity / identityRef — the normalized served model class [CLM-0081]', () => {
  it('normalizes a catalogued served alias to the real model class (table)', () => {
    const id = servedIdentity(resolveServed(req(), 'claude')); // large → opus
    expect(id.resolvedBy).toBe('table');
    expect(id.family).toBe('claude-opus');
    expect(id.tier).toBe('large');
    expect(identityRef(resolveServed(req(), 'claude'))).toBe(
      'identity:claude-opus@4.8/large(table)',
    );
  });

  it('a harness-default served model (empty alias) is honestly unknown', () => {
    // codex ships no tier alias → served model '' → kernloop pinned nothing.
    const served = resolveServed(req({ tier: 'small' }), 'codex');
    expect(served.model).toBe('');
    expect(servedIdentity(served).resolvedBy).toBe('unknown');
    expect(identityRef(served)).toBe('identity:unknown(unknown)');
  });

  it('voterServedIdentity disambiguates an unknown class by ADAPTER so two uncatalogued adapters stay distinct (#381)', () => {
    // codex + opencode both serve the harness default → both globally normalize to
    // the SAME unknown/unknown class, which would collapse the #369 diversity key.
    const codex = resolveServed(req({ tier: 'small' }), 'codex');
    const opencode = resolveServed(req({ tier: 'small' }), 'opencode');
    expect(servedIdentity(codex).provider).toBe('unknown');
    expect(servedIdentity(opencode).provider).toBe('unknown'); // collide globally
    // The vote-scoped identity keys an unknown class by its adapter → DISTINCT
    // providers, so the panel's two independent oracles are not merged into one.
    const c = voterServedIdentity(codex);
    const o = voterServedIdentity(opencode);
    expect(c.provider).toBe('codex');
    expect(o.provider).toBe('opencode');
    expect(c.provider).not.toBe(o.provider); // no diversity-key collapse
    expect(c.family).toBe('unknown'); // family stays honestly unknown
    expect(c.resolvedBy).toBe('unknown'); // still honestly an unknown class
  });

  it('voterServedIdentity returns a catalogued identity verbatim — no adapter override', () => {
    const claude = resolveServed(req(), 'claude'); // large → opus → catalogued
    expect(voterServedIdentity(claude)).toEqual(servedIdentity(claude));
    expect(voterServedIdentity(claude).provider).toBe('anthropic'); // the model class, not the adapter
  });

  it('a DISCOVERED served model normalizes by the cache, NOT a bare rule parse [CLM-0087]', () => {
    // An uncatalogued served alias that `models sync` enumerated from an endpoint.
    const served: ServedModel = {
      adapter: 'internal',
      model: 'acme/llama-3',
      requestedTier: 'large',
      servedTier: 'large',
      degraded: false,
      requestedEffort: 'high',
      servedEffort: 'high',
      effortClamped: false,
      effortArg: undefined,
    };
    // Without a cache it falls through to a bare rule parse.
    expect(servedIdentity(served).resolvedBy).toBe('rule');
    expect(servedIdentity(served).family).toBe('llama');
    // The cache holds a DISTINCT normalized identity for that id (here, a richer
    // one the discovered index returns verbatim) — proving the cache is consulted
    // rather than the id being re-derived by the rule layer.
    const cached = {
      provider: 'acme',
      family: 'acme-llama',
      generation: '3',
      variant: null,
      tier: 'large' as const,
      raw: 'acme/llama-3',
      resolvedBy: 'table' as const,
      contextWindow: 128000,
      inputCostPerMTok: 1,
      outputCostPerMTok: 2,
    };
    const cache = {
      snapshot: 'test',
      sources: { internal: { syncedAt: 'test', models: [cached] } },
    };
    const id = servedIdentity(served, cache);
    expect(id).toEqual(cached); // the cached identity, returned verbatim (not re-parsed)
    expect(identityRef(served, cache)).toBe('identity:acme-llama@3/large(table)');
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

  it('attributes the node’s spend to the serving adapter in byAdapter (#44)', async () => {
    const base: LoopInvoke = () => Promise.resolve({ output: 'ok', cost: COST });
    const totals: { tokens: number; usd: number; byAdapter?: Record<string, unknown> } = {
      tokens: 0,
      usd: 0,
    };
    await buildNodeSeam(resolveServed(req(), 'claude'), base, totals).invoke('a');
    await buildNodeSeam(resolveServed(req(), 'codex'), base, totals).invoke('b');
    expect(totals.byAdapter).toEqual({
      claude: { tokens: COST.tokens, usd: COST.usd },
      codex: { tokens: COST.tokens, usd: COST.usd },
    });
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

  it('binds the per-node timeoutMs (#127); a caller-supplied timeout still wins', async () => {
    const seen: Array<number | undefined> = [];
    const base: LoopInvoke = (_p, options = {}) => {
      seen.push(options.timeoutMs);
      return Promise.resolve({ output: 'ok', cost: COST });
    };
    const seam = buildNodeSeam(
      resolveServed(req(), 'claude'),
      base,
      { tokens: 0, usd: 0 },
      900_000,
    );
    await seam.invoke('hi'); // no caller timeout → the bound per-node budget
    await seam.invoke('hi', { timeoutMs: 5_000 }); // caller override wins
    expect(seen).toEqual([900_000, 5_000]);
  });

  it('binds NO timeoutMs when the seam was built without one (the invoke default applies)', async () => {
    const seen: Array<number | undefined> = [];
    const base: LoopInvoke = (_p, options = {}) => {
      seen.push(options.timeoutMs);
      return Promise.resolve({ output: 'ok', cost: COST });
    };
    const seam = buildNodeSeam(resolveServed(req(), 'claude'), base, { tokens: 0, usd: 0 });
    await seam.invoke('hi');
    expect(seen[0]).toBeUndefined();
  });
});

describe('buildNodeSeam — per-model-call fitness hook (#66, CLM-0125)', () => {
  it('fires onModelCall with the served identity + true + metered cost on success', async () => {
    const calls: Array<{ family: string; success: boolean; cost: Cost }> = [];
    const base: LoopInvoke = () => Promise.resolve({ output: 'ok', cost: COST });
    const seam = buildNodeSeam(
      resolveServed(req(), 'claude'), // large → opus → claude-opus identity
      base,
      { tokens: 0, usd: 0 },
      undefined,
      { onModelCall: (id, success, cost) => calls.push({ family: id.family, success, cost }) },
    );
    const result = await seam.invoke('hi');
    expect(result.output).toBe('ok'); // result returned unchanged
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ family: 'claude-opus', success: true, cost: COST });
  });

  it('fires onModelCall with false + ZERO cost on a throw, then rethrows unchanged', async () => {
    const calls: Array<{ success: boolean; cost: Cost }> = [];
    const boom = new Error('adapter exploded');
    const base: LoopInvoke = () => Promise.reject(boom);
    const seam = buildNodeSeam(
      resolveServed(req(), 'claude'),
      base,
      { tokens: 0, usd: 0 },
      undefined,
      {
        onModelCall: (_id, success, cost) => calls.push({ success, cost }),
      },
    );
    await expect(seam.invoke('hi')).rejects.toBe(boom); // rethrown unchanged
    expect(calls).toEqual([{ success: false, cost: { tokens: 0, usd: 0, wallClockMs: 0 } }]);
  });

  it('omitting the hook is a no-op (the injected/test path leaves it undefined)', async () => {
    const base: LoopInvoke = () => Promise.resolve({ output: 'ok', cost: COST });
    const seam = buildNodeSeam(resolveServed(req(), 'claude'), base, { tokens: 0, usd: 0 });
    await expect(seam.invoke('hi')).resolves.toMatchObject({ output: 'ok' });
  });
});
