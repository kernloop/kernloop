/**
 * The loop composition root resolving each node's model end-to-end
 * [CLM-0078]: buildInvokeForNode derives a node's requirement from its single
 * source, applies overlay per-node overrides + per-tier adapter choice, and
 * resolves the SERVED model+effort+adapter. Backward-compat: with no overlay
 * model config, every node binds the run adapter at its declared tier alias.
 */
import { describe, expect, it } from 'vitest';
import { OverlaySchema, type Overlay } from '../overlay.js';
import { buildInvokeForNode } from './index.js';

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
    const invokeFor = buildInvokeForNode('gemini', overlay(), { tokens: 0, usd: 0 });
    // gemini large → gemini-3.1-pro; medium → gemini-3-flash.
    expect(invokeFor('implement').served.model).toBe('gemini-3.1-pro');
    expect(invokeFor('review').served.model).toBe('gemini-3-flash');
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
});
