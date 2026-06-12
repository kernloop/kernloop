/**
 * The workforce faculty's registration record (spec §4, §5.4). Parsed
 * through `ManifestSchema` at module load so an invalid manifest fails
 * fast, not at registry time.
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';

/**
 * The faculty-workforce registration manifest. Tier is `suggest` — the
 * workforce stands behind the PM, a generative role, and anything
 * generative enters at `suggest` (spec §3.2); promotion needs evidence +
 * ratification. Consumes TaskContract (the parent plan) and emits
 * TaskContract (the derived children). Cost is zero tokens/usd: template
 * instantiation and decomposition enforcement are mechanical — the PM's
 * generative work runs through the composition-root-injected invoke, where
 * the adapters meter it.
 */
export const workforceManifest: Manifest = ManifestSchema.parse({
  name: '@kernloop/faculty-workforce',
  version: '0.1.0',
  kind: 'faculty',
  capabilities: [
    {
      name: 'workforce.instantiate',
      description: 'Instantiate an agent template as an agentTemplate Manifest (spec §5.4)',
    },
    {
      name: 'workforce.decompose',
      description: 'Derive child TaskContracts from a parent plan under the budget-sum invariant',
    },
  ],
  contracts: {
    consumes: ['TaskContract'],
    emits: ['TaskContract'],
  },
  cost: {
    tokens: 0,
    usd: 0,
    latencyMs: 10,
  },
  tier: 'suggest',
  claims: ['CLM-0040', 'CLM-0041'],
  maturity: 'stable',
});
