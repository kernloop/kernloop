/**
 * The scrum faculty's registration record (spec §4, §5.4). Parsed through
 * `ManifestSchema` at module load so an invalid manifest fails fast, not at
 * registry time.
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';

/**
 * The faculty-scrum registration manifest. Tier is `suggest` — program
 * decomposition stands behind the PM, a generative role, and anything
 * generative enters at `suggest` (spec §3.2); promotion needs evidence +
 * ratification. Consumes TaskContract (the program parent) and emits
 * TaskContract (the derived epic/story children). Cost is zero tokens/usd:
 * decomposition enforcement is mechanical — the PM's generative work runs
 * elsewhere, where the adapters meter it. The capability has no run-executor:
 * it is surfaced through the `kernloop program decompose` CLI verb (CLM-0096),
 * registered here for observability and its ladder tier.
 */
export const scrumManifest: Manifest = ManifestSchema.parse({
  name: '@kernloop/faculty-scrum',
  version: '0.1.0',
  kind: 'faculty',
  capabilities: [
    {
      name: 'scrum.decompose-goal',
      description:
        'Decompose a program goal into an epic/story TaskContract tree under the budget-sum invariant with altitude/track/sprint tags (spec §5.4)',
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
  claims: ['CLM-0096'],
  maturity: 'stable',
});
