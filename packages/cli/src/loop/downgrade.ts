/**
 * Budget-aware model DOWNGRADE (#194): once a run has spent a configured
 * fraction of its budget, the nodes that run AFTER that point route one model
 * tier lower (frontier→large→medium→small) instead of the run simply halting at
 * the budget cap (CLM-0077). A cost lever, never an upgrade: it only ever moves
 * DOWN the tier order, is fail-safe (no `downgrade` config or no budget → no
 * change), and the lower served model is recorded honestly in the node's
 * provenance plus a `cli.loop.downgrade` audit event. Pure: no I/O.
 */
import { MODEL_TIER_ORDER, type ModelRequirement, type ModelTier } from '@kernloop/contracts';
import type { RunTotals } from './invoke.js';
import type { TieredNode } from './node-model.js';

/** Resolved downgrade context: the trip fraction + the run's budget to measure against. */
export interface BudgetDowngrade {
  readonly atSpendFraction: number;
  readonly budget: { readonly tokens: number; readonly usd: number };
}

/** Audit hook fired when a node's tier is dropped for budget (#194). */
export type OnDowngrade = (e: {
  node: TieredNode;
  fromTier: ModelTier;
  toTier: ModelTier;
  spendFraction: number;
}) => void;

/** The next tier DOWN along MODEL_TIER_ORDER; `small` (the floor) stays `small`. */
export function downgradeTier(tier: ModelTier): ModelTier {
  const i = MODEL_TIER_ORDER.indexOf(tier);
  if (i < 0) return tier;
  return MODEL_TIER_ORDER[Math.min(i + 1, MODEL_TIER_ORDER.length - 1)] ?? tier;
}

/** Run spend as a fraction of budget — the MAX of the token/usd fractions (0 if no budget). */
export function spendFraction(totals: RunTotals, budget: BudgetDowngrade['budget']): number {
  const t = budget.tokens > 0 ? totals.tokens / budget.tokens : 0;
  const u = budget.usd > 0 ? totals.usd / budget.usd : 0;
  return Math.max(t, u);
}

/**
 * Apply the budget-aware downgrade to a node's requirement: once spend reaches
 * `atSpendFraction` of the budget, drop the node one tier and fire `onDowngrade`.
 * Below the threshold (or already at the `small` floor) the requirement is
 * returned unchanged — never upgraded.
 */
export function applyDowngrade(
  node: TieredNode,
  req: ModelRequirement,
  totals: RunTotals,
  dg: BudgetDowngrade,
  onDowngrade?: OnDowngrade,
): ModelRequirement {
  const frac = spendFraction(totals, dg.budget);
  if (frac < dg.atSpendFraction) return req;
  const tier = downgradeTier(req.tier);
  if (tier === req.tier) return req;
  onDowngrade?.({ node, fromTier: req.tier, toTier: tier, spendFraction: frac });
  return { ...req, tier };
}
