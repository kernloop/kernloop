/**
 * Tiered-adapter resolution (spec §8.4) — the kernel's PURE enforcement of a
 * manifest's declared model tier. Given a manifest's `modelTier` and the
 * overlay's tier→adapter configuration, resolve which configured adapter
 * serves it.
 *
 * Constitutional guardrails (the consensus panel's unanimous condition, and
 * rules 1–4): this is a deterministic static lookup and NOTHING more. It makes
 * no model call, holds no deployment policy (the tier→adapter map is passed
 * in), and has NO fallback-on-failure, NO retry-at-higher-tier, and NO
 * cost-aware/dynamic selection. The kernel resolves the declared tier; the
 * composition root binds the adapter and makes the call. If the kernel ever
 * grows heuristics here, it has grown the model-adjacent intelligence the
 * constitution forbids — keep it a lookup.
 */
import { type AdapterName, ADAPTER_NAMES } from './definitions.js';
import { type ModelTier } from '@kernloop/contracts';

/** The overlay's deployment policy: which adapter serves each model tier. */
export type TierAdapters = Partial<Record<ModelTier, AdapterName>>;

/** Thrown when a declared tier cannot be resolved — fail closed, never default upward. */
export class UnknownModelTierError extends Error {
  constructor(tier: string) {
    super(
      `cannot resolve model tier ${JSON.stringify(tier)} — not one of cheap | frontier (spec §8.4)`,
    );
    this.name = 'UnknownModelTierError';
  }
}

/**
 * Resolve a declared `modelTier` to a concrete adapter: the tier's configured
 * adapter, or `fallback` (the run's default adapter) when the overlay declares
 * none. An unrecognized tier value FAILS CLOSED (throws) rather than silently
 * defaulting — a manifest that declares a tier the system does not know is a
 * bug, not a frontier call. Pure: same inputs → same adapter.
 */
export function adapterForTier(
  tier: ModelTier,
  tierAdapters: TierAdapters,
  fallback: AdapterName,
): AdapterName {
  if (tier !== 'cheap' && tier !== 'frontier') {
    throw new UnknownModelTierError(tier as string);
  }
  const declared = tierAdapters[tier];
  return declared ?? fallback;
}

/** Re-exported so callers can validate adapter names from config. */
export { ADAPTER_NAMES };
