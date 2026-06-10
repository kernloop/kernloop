/**
 * Agent templates as DATA (spec §5.4: "configuration, not generation").
 * An agent is a manifest instantiated from a template: role prompt + skill
 * set + model tier + budget slice. Nothing here calls a model — generative
 * work happens through an invoke function the composition root binds to the
 * kernel adapters later.
 */
import { z } from 'zod';

/**
 * Model tier of a template (spec §8.4: tiered adapters — Observer/triage on
 * cheap models, Plan/Vote on frontier; declared in manifests, enforced by
 * the Router). Mapping a tier to a concrete model id is a composition-root
 * concern; this faculty only declares the tier as configuration.
 */
export const ModelTierSchema = z.enum(['cheap', 'frontier']);
export type ModelTier = z.infer<typeof ModelTierSchema>;

/**
 * One workforce agent template (spec §5.4): role prompt + skill set + model
 * tier + budget slice. `budgetShare` is the fraction of the parent task's
 * budget this role may receive by default when the PM slices budgets —
 * a default allocation hint, not a kernel-enforced ceiling (the kernel
 * meters, the PM allocates).
 */
export const AgentTemplateSchema = z.strictObject({
  /** Stable template name, e.g. `pm`; becomes `workforce/<name>` on instantiation. */
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'template name must be lowercase kebab-case'),
  /** The role prompt the agent runs under. */
  rolePrompt: z.string().min(1),
  /** Skill names from the skill library this role loads (spec §5.2 procedural memory). */
  skills: z.array(z.string().min(1)),
  /** Which adapter tier serves this role (spec §8.4). */
  modelTier: ModelTierSchema,
  /** Default fraction (0, 1] of the parent budget this role may receive. */
  budgetShare: z.number().gt(0).max(1),
});
export type AgentTemplate = z.infer<typeof AgentTemplateSchema>;

/**
 * Expected cost profile per model tier, declared on instantiated manifests
 * for router budget-matching (spec §3.1). Expectations, not meters — the
 * kernel adapters meter actual spend per call.
 */
export const MODEL_TIER_COST = {
  cheap: { tokens: 8_000, usd: 0.02, latencyMs: 30_000 },
  frontier: { tokens: 32_000, usd: 0.5, latencyMs: 120_000 },
} as const satisfies Record<ModelTier, { tokens: number; usd: number; latencyMs: number }>;

const template = (t: AgentTemplate): AgentTemplate => AgentTemplateSchema.parse(t);

/**
 * The five shipped templates (spec §5.4): PM, Coder, Reviewer, Documenter,
 * Researcher. Research ships as a single Researcher template + the
 * `research` skill pack — NOT a faculty (spec §5.7). Shipped templates are
 * `stable`; anything else instantiates as `experimental` (see
 * instantiateAgent).
 */
export const SHIPPED_TEMPLATES: Readonly<Record<string, AgentTemplate>> = {
  pm: template({
    name: 'pm',
    rolePrompt:
      'You are the PM. Decompose the ratified plan into child TaskContracts, ' +
      'each with a goal, evidence requirements, a definition of done, and a ' +
      'budget slice. Child budgets must sum within the parent budget on every ' +
      'dimension; the kernel meters, you allocate.',
    skills: ['plan-decomposition', 'budget-allocation'],
    modelTier: 'frontier',
    budgetShare: 0.1,
  }),
  coder: template({
    name: 'coder',
    rolePrompt:
      'You are the Coder. Implement exactly the child TaskContract you were ' +
      'assigned: satisfy its definition of done, produce its evidence, and ' +
      'respect its constraints and budget. Wiring-complete or absent.',
    skills: ['implementation', 'testing'],
    modelTier: 'frontier',
    budgetShare: 0.5,
  }),
  reviewer: template({
    name: 'reviewer',
    rolePrompt:
      'You are the Reviewer. Adversarially review the proposed change against ' +
      'its contract: correctness, constraint violations, untested claims. ' +
      'Report severity-tagged findings; do not rewrite the work.',
    skills: ['diff-review'],
    modelTier: 'frontier',
    budgetShare: 0.15,
  }),
  documenter: template({
    name: 'documenter',
    rolePrompt:
      'You are the Documenter. Update docs in the same change set, tagging ' +
      'every capability statement with its claim id. Documentation may state ' +
      'only verified capability.',
    skills: ['docs'],
    modelTier: 'cheap',
    budgetShare: 0.1,
  }),
  researcher: template({
    name: 'researcher',
    rolePrompt:
      'You are the Researcher. Gather and condense the source material the ' +
      'task needs — code, specs, prior art — with provenance on every finding. ' +
      'You produce inputs for others; you do not implement.',
    skills: ['research'],
    modelTier: 'cheap',
    budgetShare: 0.15,
  }),
};

/** Names of the five shipped templates, in spec §5.4 order. */
export const SHIPPED_TEMPLATE_NAMES = [
  'pm',
  'coder',
  'reviewer',
  'documenter',
  'researcher',
] as const;
export type ShippedTemplateName = (typeof SHIPPED_TEMPLATE_NAMES)[number];
