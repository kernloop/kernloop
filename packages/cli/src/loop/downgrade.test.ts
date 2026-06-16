/**
 * Budget-aware model downgrade (#194, CLM-0119). The pure tier arithmetic, plus
 * the end-to-end binding through buildInvokeForNode: with an overlay `downgrade`
 * fraction and a budget, a node bound AFTER spend crosses the fraction routes one
 * tier lower (large→medium → claude opus→sonnet), firing the audit hook; below
 * the threshold, and with no `downgrade` config at all, binding is unchanged.
 */
import { describe, expect, it } from 'vitest';
import type { ModelRequirement, ModelTier } from '@kernloop/contracts';
import { OverlaySchema, type Overlay } from '../overlay.js';
import { buildInvokeForNode } from './index.js';
import { applyDowngrade, downgradeTier, spendFraction, type BudgetDowngrade } from './downgrade.js';

const overlay = (yaml: Partial<Overlay> = {}): Overlay =>
  OverlaySchema.parse({ id: 'downgrade-test', ...yaml });

const req = (tier: ModelTier): ModelRequirement => ({ tier, effort: 'high', capabilities: [] });
const dg = (atSpendFraction: number): BudgetDowngrade => ({
  atSpendFraction,
  budget: { tokens: 1000, usd: 1 },
});

describe('downgradeTier — one tier down, floored at small', () => {
  it('steps frontier→large→medium→small and floors at small', () => {
    expect(downgradeTier('frontier')).toBe('large');
    expect(downgradeTier('large')).toBe('medium');
    expect(downgradeTier('medium')).toBe('small');
    expect(downgradeTier('small')).toBe('small'); // the floor — never below
  });
});

describe('spendFraction — max of the token/usd fractions', () => {
  it('takes the larger of the two dimensions; 0 when a dim has no budget', () => {
    expect(spendFraction({ tokens: 500, usd: 0 }, { tokens: 1000, usd: 1 })).toBe(0.5);
    expect(spendFraction({ tokens: 100, usd: 0.9 }, { tokens: 1000, usd: 1 })).toBeCloseTo(0.9);
    expect(spendFraction({ tokens: 500, usd: 0 }, { tokens: 0, usd: 0 })).toBe(0);
  });
});

describe('applyDowngrade — gated on the spend fraction', () => {
  it('returns the requirement UNCHANGED below the threshold (no audit)', () => {
    const fired: unknown[] = [];
    const out = applyDowngrade('implement', req('large'), { tokens: 200, usd: 0 }, dg(0.5), (e) =>
      fired.push(e),
    );
    expect(out.tier).toBe('large');
    expect(fired).toHaveLength(0);
  });

  it('drops one tier AT/above the threshold and fires the audit hook once', () => {
    const fired: Array<{ node: string; fromTier: ModelTier; toTier: ModelTier }> = [];
    const out = applyDowngrade('implement', req('large'), { tokens: 600, usd: 0 }, dg(0.5), (e) =>
      fired.push(e),
    );
    expect(out.tier).toBe('medium');
    expect(out.effort).toBe('high'); // only the tier moves; effort/capabilities untouched
    expect(fired).toEqual([
      { node: 'implement', fromTier: 'large', toTier: 'medium', spendFraction: 0.6 },
    ]);
  });

  it('a `small` node over the threshold stays small and does NOT fire (already the floor)', () => {
    const fired: unknown[] = [];
    const out = applyDowngrade('vote', req('small'), { tokens: 900, usd: 0 }, dg(0.5), (e) =>
      fired.push(e),
    );
    expect(out.tier).toBe('small');
    expect(fired).toHaveLength(0);
  });
});

describe('buildInvokeForNode — downgrade end-to-end', () => {
  it('binds the lower tier once spend crosses the fraction; audits the drop', () => {
    const totals = { tokens: 0, usd: 0 };
    const fired: Array<{ node: string; fromTier: string; toTier: string }> = [];
    const invokeFor = buildInvokeForNode(
      'claude',
      overlay({ downgrade: { atSpendFraction: 0.5 } }),
      totals,
      { tokens: 1000, usd: 1 },
      (e) => fired.push(e),
    );
    // implement is large/high → claude opus while under the threshold.
    expect(invokeFor('implement').served.model).toBe('opus');
    expect(fired).toHaveLength(0);
    // Cross 50% of the token budget → the SAME node now binds the lower tier.
    totals.tokens = 600;
    expect(invokeFor('implement').served.model).toBe('sonnet'); // large→medium
    expect(fired).toEqual([
      { node: 'implement', fromTier: 'large', toTier: 'medium', spendFraction: 0.6 },
    ]);
  });

  it('with NO downgrade config, binding is unchanged even at high spend (backward-compat)', () => {
    const totals = { tokens: 999_999, usd: 999 };
    const invokeFor = buildInvokeForNode('claude', overlay(), totals, { tokens: 1000, usd: 1 });
    expect(invokeFor('implement').served.model).toBe('opus'); // never downgrades without config
  });
});
