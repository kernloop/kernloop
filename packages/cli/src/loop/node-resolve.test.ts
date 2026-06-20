/**
 * The loop composition root resolving each node's model end-to-end
 * [CLM-0078]: buildInvokeForNode derives a node's requirement from its single
 * source, applies overlay per-node overrides + per-tier adapter choice, and
 * resolves the SERVED model+effort+adapter. Backward-compat: with no overlay
 * model config, every node binds the run adapter at its declared tier alias.
 */
import { describe, expect, it } from 'vitest';
import { OverlaySchema, type Overlay } from '../overlay.js';
import { buildInvokeForNode, injectedSeamFor } from './index.js';
import type { LoopInvoke } from './invoke.js';
import { DEFAULT_INVOKE_TIMEOUT_MS, LIGHT_INVOKE_TIMEOUT_MS } from './node-model.js';

const overlay = (yaml: Partial<Overlay> = {}): Overlay =>
  OverlaySchema.parse({ id: 'resolve-test', ...yaml });

describe('buildInvokeForNode — backward-compat (no model config)', () => {
  it('binds the run adapter at each node’s declared tier alias, unchanged spend shape', () => {
    const totals = { tokens: 0, usd: 0 };
    const invokeFor = buildInvokeForNode('claude', overlay(), totals);
    // implement derives from the coder template (large/high) → claude opus.
    const implement = invokeFor('implement').served;
    expect(implement.adapter).toBe('claude');
    expect(implement.model).toBe('opus');
    expect(implement.servedEffort).toBe('high');
    expect(implement.degraded).toBe(false);
    // review derives from the review gate (medium/high) → claude sonnet.
    expect(invokeFor('review').served.model).toBe('sonnet');
    // Nothing has been spent yet — the seam is lazy.
    expect(totals.tokens).toBe(0);
  });

  it('a different run adapter rebinds every node’s alias (the cost lever)', () => {
    const invokeFor = buildInvokeForNode('agy', overlay(), { tokens: 0, usd: 0 });
    // agy large → "Gemini 3.1 Pro (Low)"; medium → "Gemini 3.5 Flash (Medium)".
    expect(invokeFor('implement').served.model).toBe('Gemini 3.1 Pro (Low)');
    expect(invokeFor('review').served.model).toBe('Gemini 3.5 Flash (Medium)');
  });
});

describe('buildInvokeForNode — overlay overrides', () => {
  it('a per-tier adapter map routes a node to a DIFFERENT adapter', () => {
    // Send large-tier nodes to codex, keep the run adapter elsewhere.
    const ov = overlay({ adapters: { large: 'codex' } });
    const invokeFor = buildInvokeForNode('claude', ov, { tokens: 0, usd: 0 });
    const implement = invokeFor('implement').served; // coder = large
    expect(implement.adapter).toBe('codex');
    // review (medium) stays on the run adapter.
    expect(invokeFor('review').served.adapter).toBe('claude');
  });

  it('a per-node tier/effort override changes what that node requests', () => {
    const ov = overlay({ nodeOverrides: { implement: { tier: 'small', effort: 'low' } } });
    const invokeFor = buildInvokeForNode('claude', ov, { tokens: 0, usd: 0 });
    const implement = invokeFor('implement').served;
    expect(implement.requestedTier).toBe('small');
    expect(implement.model).toBe('haiku'); // claude small alias
    expect(implement.servedEffort).toBe('low');
    // The override is scoped: plan keeps its template tier (large → opus).
    expect(invokeFor('plan').served.model).toBe('opus');
  });

  it('a node sent to an effort-less adapter drops effort honestly', () => {
    const ov = overlay({ adapters: { large: 'ollama' } });
    const invokeFor = buildInvokeForNode('claude', ov, { tokens: 0, usd: 0 });
    const implement = invokeFor('implement').served;
    expect(implement.adapter).toBe('ollama');
    expect(implement.servedEffort).toBe('unsupported'); // ollama has no effort param
  });

  it('an ENDPOINT run adapter routes every node to the api seam — no CLI needed (#392)', () => {
    const ov = overlay({
      endpoints: {
        'my-api': {
          baseUrl: 'https://api.example.com/v1',
          apiKeyEnv: 'MY_API_KEY',
          models: { frontier: 'm-front', large: 'm-large', medium: 'm-medium', small: 'm-small' },
        },
      },
    });
    // Run adapter is the endpoint id (not a CLI) + no `adapters` block → every node
    // falls back to it, resolving through the api seam at the endpoint's per-tier model.
    const invokeFor = buildInvokeForNode('my-api', ov, { tokens: 0, usd: 0 });
    const implement = invokeFor('implement').served; // coder = large
    expect(implement.adapter).toBe('my-api');
    expect(implement.model).toBe('m-large');
    expect(invokeFor('review').served.adapter).toBe('my-api'); // review = medium
    expect(invokeFor('review').served.model).toBe('m-medium');
  });
});

describe('injectedSeamFor — the INJECTED/sampling path binds the per-node budget + tier', () => {
  /** A spy base recording the options each node's bound invoke hands down. */
  function spyBase(): { base: LoopInvoke; seen: Array<{ timeoutMs?: number; tier?: string }> } {
    const seen: Array<{ timeoutMs?: number; tier?: string }> = [];
    const base: LoopInvoke = async (_prompt, options = {}) => {
      seen.push({ timeoutMs: options.timeoutMs, tier: options.tier });
      return { output: '{}', cost: { tokens: 0, usd: 0 } };
    };
    return { base, seen };
  }

  it('gives a HEAVY node its full timeout (not the MCP SDK 60s default) and a light node the cap (#142)', async () => {
    const { base, seen } = spyBase();
    const seamFor = injectedSeamFor('claude', overlay(), base, { tokens: 0, usd: 0 });
    await seamFor('research').invoke('p'); // heavy → full configured base
    await seamFor('vote').invoke('p'); // light → capped
    expect(seen[0]?.timeoutMs).toBe(DEFAULT_INVOKE_TIMEOUT_MS);
    expect(seen[1]?.timeoutMs).toBe(LIGHT_INVOKE_TIMEOUT_MS);
  });

  it('carries each node’s REQUESTED tier so a sampling host can route high/med/low (#140)', async () => {
    const { base, seen } = spyBase();
    const seamFor = injectedSeamFor('claude', overlay(), base, { tokens: 0, usd: 0 });
    const research = seamFor('research');
    await research.invoke('p');
    expect(seen[0]?.tier).toBe(research.served.requestedTier);
  });

  it('honors an overlay-configured invoke base on the injected path', async () => {
    const { base, seen } = spyBase();
    const seamFor = injectedSeamFor('claude', overlay({ invokeTimeoutMs: 120_000 }), base, {
      tokens: 0,
      usd: 0,
    });
    await seamFor('research').invoke('p');
    expect(seen[0]?.timeoutMs).toBe(120_000);
  });
});
