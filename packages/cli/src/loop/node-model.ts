/**
 * Per-node model REQUIREMENT derivation for the canonical loop [CLM-0078] —
 * the realization of spec §8.4's "tiered adapters … declared in manifests",
 * with the manifest/template as the SINGLE source of truth.
 *
 * There is NO parallel per-node tier map (the old `NODE_TIERS` constant is
 * deleted): each model-calling loop node DERIVES its {@link ModelRequirement}
 * from the manifest/template it actually routes to. Flip a template/manifest's
 * declared `model` and the loop resolves a different model+effort for that node
 * — that is the guarantee the propagation test proves, and the reason a second,
 * divergence-prone source of truth no longer exists.
 *
 * Node → governing source (the manifest/template each node invokes):
 *  - research   → workforce Researcher template (gather/condense prior art)
 *  - plan       → workforce PM template (draft the plan)
 *  - decompose  → workforce PM template (slice the ratified plan into children)
 *  - implement  → workforce Coder template (write the child's files)
 *  - vote       → vote gate manifest (ratify the plan)
 *  - review     → review gate manifest (adversarially read the child's diff)
 *
 * frame, quality, integrate, retrospect make NO model call, so they derive no
 * requirement (absent from the node set by design, not stubbed).
 *
 * HONESTY / deviation from §8.4: the spec phrases enforcement as "declared in
 * manifests, enforced by Router." The manifest IS the declaration; this module
 * reads it at the LOOP (the composition root), not the Router — choosing WHICH
 * adapter+model a given loop node calls is a composition concern (the loop is
 * where adapters bind to nodes). Do not read this as Router enforcement.
 */
import { ModelRequirementSchema, type Manifest, type ModelRequirement } from '@kernloop/contracts';
import { voteGateManifest, reviewGateManifest } from '@kernloop/faculty-gates';
import { SHIPPED_TEMPLATES, type AgentTemplate } from '@kernloop/faculty-workforce';

/** The loop nodes that make a model call and therefore derive a requirement. */
export const TIERED_NODES = [
  'research',
  'plan',
  'decompose',
  'implement',
  'vote',
  'review',
] as const;

/** A loop node that derives a model requirement from its governing source. */
export type TieredNode = (typeof TIERED_NODES)[number];

/**
 * The manifests/templates each tiered node routes to — injectable so the
 * propagation test can flip a single source's `model` and assert the derived
 * node requirement moves with it (proving the manifest is the sole authority).
 * Defaults to the real shipped templates and gate manifests.
 */
export interface ModelSources {
  readonly researcher: Pick<AgentTemplate, 'model'>;
  readonly pm: Pick<AgentTemplate, 'model'>;
  readonly coder: Pick<AgentTemplate, 'model'>;
  readonly vote: Pick<Manifest, 'model'>;
  readonly review: Pick<Manifest, 'model'>;
}

/** Look up a shipped template or fail loudly — a missing one is a wiring bug. */
function shipped(name: string): AgentTemplate {
  const template = SHIPPED_TEMPLATES[name];
  if (template === undefined) {
    throw new Error(`model derivation: shipped template "${name}" is missing`);
  }
  return template;
}

/** The real sources: the shipped templates + the two model-calling gates. */
export function defaultModelSources(): ModelSources {
  return {
    researcher: shipped('researcher'),
    pm: shipped('pm'),
    coder: shipped('coder'),
    vote: voteGateManifest,
    review: reviewGateManifest,
  };
}

/**
 * Derive a node's {@link ModelRequirement} from the manifest/template it routes
 * to (the single source of truth). A model-calling gate manifest MUST declare a
 * `model`; an omitted one is a manifest bug surfaced loudly here rather than
 * silently defaulting. The returned requirement is schema-complete (defaults
 * applied), so downstream resolution always has tier + effort.
 */
export function nodeRequirement(
  node: TieredNode,
  sources: ModelSources = defaultModelSources(),
): ModelRequirement {
  switch (node) {
    case 'research':
      return sources.researcher.model;
    case 'plan':
    case 'decompose':
      return sources.pm.model;
    case 'implement':
      return sources.coder.model;
    case 'vote':
      return manifestModel(sources.vote.model, 'vote gate');
    case 'review':
      return manifestModel(sources.review.model, 'review gate');
  }
}

/** A model-calling gate manifest must declare a requirement — an omission is a bug. */
function manifestModel(model: ModelRequirement | undefined, label: string): ModelRequirement {
  if (model === undefined) {
    throw new Error(`model derivation: ${label} manifest declares no model (spec §8.4)`);
  }
  return ModelRequirementSchema.parse(model);
}

/**
 * Default per-call model-invoke timeout (ms) for the GENERATIVE nodes
 * (implement, research, review) when the overlay sets no `invokeTimeoutMs`
 * [CLM-0078, #127]. Raised from the old uniform 5-minute cap so a real
 * cross-file edit is not killed mid-write — the failure mode the first
 * self-hosted run hit. The overlay's `invokeTimeoutMs` overrides this base.
 */
export const DEFAULT_INVOKE_TIMEOUT_MS = 900_000;

/**
 * Per-call timeout (ms) for the LIGHTER nodes (plan, decompose, vote): a quick
 * decision should fail fast rather than wait the full generative budget. A node
 * is capped at the SMALLER of this and the configured base, so lowering the base
 * lowers everything but raising it never makes a vote wait the generative budget.
 */
export const LIGHT_INVOKE_TIMEOUT_MS = 300_000;

/** The generative nodes that receive the full configured invoke timeout; every
 * other model-calling node is capped at {@link LIGHT_INVOKE_TIMEOUT_MS}. */
const HEAVY_NODES: ReadonlySet<TieredNode> = new Set(['implement', 'research', 'review']);

/**
 * The per-call model-invoke timeout for `node` given the configured base
 * (`overlay.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS`): a heavy/generative
 * node gets the full base; a lighter node is capped at
 * {@link LIGHT_INVOKE_TIMEOUT_MS} (#127).
 */
export function invokeTimeoutForNode(node: TieredNode, baseMs: number): number {
  return HEAVY_NODES.has(node) ? baseMs : Math.min(baseMs, LIGHT_INVOKE_TIMEOUT_MS);
}

/**
 * The tiered nodes that run the agentic CLI as a PURE COMPLETION (#148) — tool-free,
 * consuming only the compiled Brief, never reading/writing the workspace: the ones
 * that judge or plan over text. An EXPLICIT allowlist, not `!== 'implement'` (#355):
 * a future tool-NEEDING node (a second coder-like node) then defaults to NOT
 * reasoning — it keeps tool access rather than being silently starved tool-free.
 * Adding a new reasoning node is a conscious one-line edit here.
 */
const REASONING_NODES: ReadonlySet<TieredNode> = new Set([
  'research',
  'plan',
  'decompose',
  'vote',
  'review',
]);

/** Whether a tiered node runs tool-free (#148) — see {@link REASONING_NODES}. */
export function isReasoningNode(node: TieredNode): boolean {
  return REASONING_NODES.has(node);
}
