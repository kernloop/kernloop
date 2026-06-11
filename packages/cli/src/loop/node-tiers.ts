/**
 * Per-node model-tier DERIVATION for the canonical loop [CLM-0068, CLM-0076] —
 * the realization of spec §8.4's tiered-adapter cost lever, with the manifest
 * as the SINGLE source of truth.
 *
 * There is no parallel per-node tier map here (the old `NODE_TIERS` constant
 * is deleted): each model-calling loop node DERIVES its tier from the
 * manifest/template it actually routes to. Flip a manifest/template's declared
 * `modelTier` and the loop binds a different adapter for that node — that is
 * the guarantee the propagation test proves, and the reason a second,
 * divergence-prone truth no longer exists.
 *
 * Node → governing source (the manifest/template each node invokes):
 *  - research   → workforce Researcher template (gather/condense prior art)
 *  - plan       → workforce PM template (draft the plan)
 *  - decompose  → workforce PM template (slice the ratified plan into children)
 *  - implement  → workforce Coder template (write the child's files)
 *  - vote       → vote gate manifest (ratify the plan)
 *  - review     → review gate manifest (adversarially read the child's diff)
 *
 * frame, quality, integrate, retrospect make NO model call, so they declare no
 * tier (absent from the node set by design, not stubbed).
 *
 * HONESTY / deviation from §8.4: the spec phrases enforcement as "declared in
 * manifests, enforced by Router." The manifest IS the declaration; this module
 * reads it at the LOOP (the composition root), not the Router — choosing WHICH
 * adapter a given loop node calls is a composition concern (the loop is where
 * adapters bind to nodes). Do not read this as Router enforcement.
 */
import { voteGateManifest, reviewGateManifest } from '@kernloop/faculty-gates';
import { SHIPPED_TEMPLATES, type AgentTemplate } from '@kernloop/faculty-workforce';
import type { Manifest, ModelTier } from '@kernloop/contracts';

/** The loop nodes that make a model call and therefore derive a tier. */
export const TIERED_NODES = [
  'research',
  'plan',
  'decompose',
  'implement',
  'vote',
  'review',
] as const;

/** A loop node that derives a model tier from its governing source. */
export type TieredNode = (typeof TIERED_NODES)[number];

/**
 * The manifests/templates each tiered node routes to — injectable so the
 * propagation test can flip a single source's `modelTier` and assert the
 * derived node tier moves with it (proving the manifest is the sole authority).
 * Defaults to the real shipped templates and gate manifests.
 */
export interface TierSources {
  readonly researcher: Pick<AgentTemplate, 'modelTier'>;
  readonly pm: Pick<AgentTemplate, 'modelTier'>;
  readonly coder: Pick<AgentTemplate, 'modelTier'>;
  readonly vote: Pick<Manifest, 'modelTier'>;
  readonly review: Pick<Manifest, 'modelTier'>;
}

/** Look up a shipped template or fail loudly — a missing one is a wiring bug. */
function shipped(name: string): AgentTemplate {
  const template = SHIPPED_TEMPLATES[name];
  if (template === undefined) {
    throw new Error(`tier derivation: shipped template "${name}" is missing`);
  }
  return template;
}

/** The real tier sources: the shipped templates + the two model-calling gates. */
export function defaultTierSources(): TierSources {
  return {
    researcher: shipped('researcher'),
    pm: shipped('pm'),
    coder: shipped('coder'),
    vote: voteGateManifest,
    review: reviewGateManifest,
  };
}

/**
 * Derive a node's declared model tier from the manifest/template it routes to
 * (the single source of truth). A gate manifest that makes a model call MUST
 * declare a `modelTier`; an omitted one is a manifest bug surfaced loudly here
 * rather than silently defaulting upward.
 */
export function nodeModelTier(
  node: TieredNode,
  sources: TierSources = defaultTierSources(),
): ModelTier {
  switch (node) {
    case 'research':
      return sources.researcher.modelTier;
    case 'plan':
    case 'decompose':
      return sources.pm.modelTier;
    case 'implement':
      return sources.coder.modelTier;
    case 'vote':
      return manifestTier(sources.vote.modelTier, 'vote gate');
    case 'review':
      return manifestTier(sources.review.modelTier, 'review gate');
  }
}

/** A model-calling gate manifest must declare a tier — an omission is a bug. */
function manifestTier(tier: ModelTier | undefined, label: string): ModelTier {
  if (tier === undefined) {
    throw new Error(`tier derivation: ${label} manifest declares no modelTier (spec §8.4)`);
  }
  return tier;
}
