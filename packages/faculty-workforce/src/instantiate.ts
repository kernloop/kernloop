/**
 * Template → Manifest instantiation (spec §5.4; CLM-0040). Purely
 * mechanical: validate the template, stamp it into a `agentTemplate`
 * Manifest, and parse the result through ManifestSchema so an invalid
 * instantiation fails fast.
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';
import { z } from 'zod';
import {
  AgentTemplateSchema,
  MODEL_TIER_COST,
  SHIPPED_TEMPLATES,
  type AgentTemplate,
} from './templates.js';

/** Version stamped on every instantiated agent manifest. */
export const WORKFORCE_VERSION = '0.1.0';

/** Options for {@link instantiateAgent}. */
export const InstantiateOptionsSchema = z.strictObject({
  /** Repo overlay id the agent serves (spec §7); recorded in the capability description. */
  overlay: z.string().min(1),
  /**
   * Field overrides composing a CUSTOM template from an existing one. Any
   * override — even an identity rewrite — makes the result custom:
   * `experimental` maturity at `suggest` tier, ratified into the library
   * later (spec §5.4).
   */
  overrides: AgentTemplateSchema.partial().optional(),
});
export type InstantiateOptions = z.infer<typeof InstantiateOptionsSchema>;

/** True iff `t` is byte-for-byte one of the five shipped templates. */
function isShipped(t: AgentTemplate): boolean {
  const shipped = SHIPPED_TEMPLATES[t.name];
  return shipped !== undefined && JSON.stringify(shipped) === JSON.stringify(t);
}

/**
 * Instantiate an agent template as a Manifest (kind `agentTemplate`).
 *
 * - `tier` is always `suggest`: templates are generative components and
 *   anything generative enters at `suggest` (spec §3.2, §5.4); promotion is
 *   never a default.
 * - `maturity` is `stable` only for an unmodified shipped template (PM,
 *   Coder, Reviewer, Documenter, Researcher); any custom template — composed
 *   from existing ones via `overrides` or supplied whole — is
 *   `experimental` until ratified into the library.
 * - `claims` is empty: an instantiated agent is a runtime configuration
 *   record, not a repo capability; the claim backing this machinery
 *   (CLM-0040) lives on the faculty manifest.
 * - `modelTier` and `overlay` are recorded in the capability description;
 *   the cost profile reflects the tier (spec §8.4). Binding the tier to a
 *   concrete model id is the composition root's concern.
 *
 * DEFERRED (P3): the spec grants the PM authority to compose bespoke
 * specialists at `enforce`. Per the P2 design-notes ratification point, that
 * enforce grant is deferred to P3 evidence — there is deliberately no
 * enforce path here, and composed templates come out `suggest`/
 * `experimental` like any other custom template.
 */
export function instantiateAgent(template: AgentTemplate, options: InstantiateOptions): Manifest {
  const opts = InstantiateOptionsSchema.parse(options);
  const base = AgentTemplateSchema.parse(template);
  const effective =
    opts.overrides === undefined ? base : AgentTemplateSchema.parse({ ...base, ...opts.overrides });
  const custom = opts.overrides !== undefined || !isShipped(effective);
  return ManifestSchema.parse({
    name: `workforce/${effective.name}`,
    version: WORKFORCE_VERSION,
    kind: 'agentTemplate',
    capabilities: [
      {
        name: `agent.${effective.name}`,
        description:
          `${effective.name} agent (${effective.modelTier} tier, ` +
          `budget share ${effective.budgetShare}, skills: ${effective.skills.join(', ') || 'none'}) ` +
          `for overlay ${opts.overlay}`,
      },
    ],
    contracts: {
      consumes: ['TaskContract'],
      emits: ['Outcome'],
    },
    cost: MODEL_TIER_COST[effective.modelTier],
    tier: 'suggest',
    claims: [],
    maturity: custom ? 'experimental' : 'stable',
  });
}
