/**
 * Agent templates as DATA (spec §5.4: "configuration, not generation").
 * An agent is a manifest instantiated from a template: role prompt + skill
 * set + model requirement + budget slice. Nothing here calls a model —
 * generative work happens through an invoke function the composition root
 * binds to the kernel adapters later.
 */
import { ModelRequirementSchema, type ModelRequirement, type ModelTier } from '@kernloop/contracts';
import { z } from 'zod';

/**
 * One workforce agent template (spec §5.4): role prompt + skill set + model
 * requirement + budget slice. `budgetShare` is the fraction of the parent
 * task's budget this role may receive by default when the PM slices budgets —
 * a default allocation hint, not a kernel-enforced ceiling (the kernel
 * meters, the PM allocates).
 *
 * `model` is the role's two-axis {@link ModelRequirement} (spec §8.4): the
 * model `tier` (frontier > large > medium > small) and reasoning `effort` the
 * role demands. Mapping a tier+effort to a concrete model id + effort arg is a
 * composition-root concern resolved through the kernel translation seam; this
 * faculty only declares the requirement as configuration.
 */
export const AgentTemplateSchema = z.strictObject({
  /** Stable template name, e.g. `pm`; becomes `workforce/<name>` on instantiation. */
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'template name must be lowercase kebab-case'),
  /** The role prompt the agent runs under. */
  rolePrompt: z.string().min(1),
  /** Skill names from the skill library this role loads (spec §5.2 procedural memory). */
  skills: z.array(z.string().min(1)),
  /** The role's two-axis model demand (spec §8.4): tier + effort + capabilities. */
  model: ModelRequirementSchema,
  /** Default fraction (0, 1] of the parent budget this role may receive. */
  budgetShare: z.number().gt(0).max(1),
});
export type AgentTemplate = z.infer<typeof AgentTemplateSchema>;

/**
 * Expected cost profile per model tier, declared on instantiated manifests
 * for router budget-matching (spec §3.1). Expectations, not meters — the
 * kernel adapters meter actual spend per call. Effort is noted, not separately
 * priced: a tier's row is the expectation at its default effort; raising
 * effort raises realized tokens, which the per-call meters capture.
 */
export const MODEL_TIER_COST = {
  frontier: { tokens: 48_000, usd: 0.8, latencyMs: 180_000 },
  large: { tokens: 32_000, usd: 0.5, latencyMs: 120_000 },
  medium: { tokens: 16_000, usd: 0.1, latencyMs: 60_000 },
  small: { tokens: 8_000, usd: 0.02, latencyMs: 30_000 },
} as const satisfies Record<ModelTier, { tokens: number; usd: number; latencyMs: number }>;

/** Build a {@link ModelRequirement} from a partial, applying the schema defaults. */
const model = (req: Partial<ModelRequirement>): ModelRequirement =>
  ModelRequirementSchema.parse(req);

const template = (t: AgentTemplate): AgentTemplate => AgentTemplateSchema.parse(t);

/**
 * The five shipped templates (spec §5.4): PM, Coder, Reviewer, Documenter,
 * Researcher. Research ships as a single Researcher template + the
 * `research` skill pack — NOT a faculty (spec §5.7). Shipped templates are
 * `stable`; anything else instantiates as `experimental` (see
 * instantiateAgent). Tiers reflect each role's load (spec §8.4): the
 * load-bearing generation roles (Coder, PM, Researcher) on `large` at high
 * effort; the judging/writing roles (Reviewer, Documenter) on `medium`.
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
    model: model({ tier: 'large', effort: 'high' }),
    budgetShare: 0.1,
  }),
  coder: template({
    name: 'coder',
    rolePrompt:
      'You are the Coder. Implement exactly the child TaskContract you were ' +
      'assigned: satisfy its definition of done, produce its evidence, and ' +
      'respect its constraints and budget. Wiring-complete or absent.',
    skills: ['implementation', 'testing'],
    model: model({ tier: 'large', effort: 'high' }),
    budgetShare: 0.5,
  }),
  reviewer: template({
    name: 'reviewer',
    rolePrompt:
      'You are the Reviewer. Adversarially review the proposed change against ' +
      'its contract: correctness, constraint violations, untested claims. ' +
      'Report severity-tagged findings; do not rewrite the work.',
    skills: ['diff-review'],
    model: model({ tier: 'medium', effort: 'high' }),
    budgetShare: 0.15,
  }),
  documenter: template({
    name: 'documenter',
    rolePrompt:
      'You are the Documenter. Update docs in the same change set, tagging ' +
      'every capability statement with its claim id. Documentation may state ' +
      'only verified capability.',
    skills: ['docs'],
    model: model({ tier: 'medium', effort: 'high' }),
    budgetShare: 0.1,
  }),
  researcher: template({
    name: 'researcher',
    rolePrompt:
      'You are the Researcher. Gather and condense the source material the ' +
      'task needs — code, specs, prior art — with provenance on every finding. ' +
      'You produce inputs for others; you do not implement.',
    skills: ['research'],
    model: model({ tier: 'large', effort: 'high' }),
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
