/**
 * Per-node model-tier selection for the canonical loop [CLM-0068] — the
 * realization of spec §8.4's tiered-adapter cost lever ("Observer/triage on
 * cheap models; Plan/Vote on frontier").
 *
 * HONESTY / deviation from §8.4: the spec phrases this as "declared in
 * manifests, enforced by Router." This realization enforces it at the LOOP
 * (the composition root), not the Router. The router selects manifests by
 * capability/budget/authority tier; choosing WHICH model adapter a given loop
 * node calls is a composition concern — the loop is where adapters are bound
 * to nodes, so it is the natural and honest enforcement point. Do not read
 * this as Router enforcement; it is loop enforcement.
 *
 * Tiers per §8.4 rationale:
 *  - research, review → `cheap`: they read/triage/judge existing material
 *    (gather + summarize prior art; adversarially read a diff) — the load is
 *    comprehension, not frontier generation.
 *  - plan, vote, decompose, implement → `frontier`: these are the
 *    load-bearing generation and ratification decisions.
 *  - frame, quality, integrate, retrospect make NO model call, so they have
 *    no tier (absent from the map by design, not stubbed).
 */

/** The two model tiers a node may declare (mirrors workforce `modelTier`). */
export type ModelTier = 'cheap' | 'frontier';

/**
 * The declared model tier of each model-calling loop node. Nodes that make no
 * model call (frame, quality, integrate, retrospect) are intentionally absent.
 */
export const NODE_TIERS = {
  research: 'cheap',
  plan: 'frontier',
  vote: 'frontier',
  decompose: 'frontier',
  implement: 'frontier',
  review: 'cheap',
} as const satisfies Record<string, ModelTier>;

/** A node name that declares a model tier (keys of {@link NODE_TIERS}). */
export type TieredNode = keyof typeof NODE_TIERS;
