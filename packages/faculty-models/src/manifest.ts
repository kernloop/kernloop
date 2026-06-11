/**
 * The models faculty's registration record (spec §4, §5.2/§8.4). Parsed
 * through `ManifestSchema` at module load so an invalid manifest fails fast.
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';

/**
 * Manifest for @kernloop/faculty-models. Tier is `observe` — the lowest rung:
 * this faculty NORMALIZES a served model id into a {@link
 * import('@kernloop/contracts').ModelIdentity}, it does not act, block, file an
 * issue, or mutate anything. It makes no model call and carries no `model`
 * demand of its own. It consumes/emits none of the frozen five over the bus:
 * `resolveIdentity` is a pure function the composition root calls inline to
 * enrich provenance, not a bus participant.
 */
export const modelsManifest: Manifest = ManifestSchema.parse({
  name: '@kernloop/faculty-models',
  version: '0.1.0',
  kind: 'faculty',
  capabilities: [
    {
      name: 'models.resolveIdentity',
      description: 'Normalize a served model alias/id into a ModelIdentity (table→rule→unknown)',
    },
    {
      name: 'models.catalog',
      description: 'Expose the vendored models.dev-pattern catalog snapshot (no network)',
    },
  ],
  contracts: {
    consumes: [],
    emits: [],
  },
  cost: {
    tokens: 0,
    usd: 0,
    latencyMs: 1,
  },
  tier: 'observe',
  claims: ['CLM-0080', 'CLM-0081'],
  maturity: 'stable',
});
