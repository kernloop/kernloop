/**
 * The workflows package's registration record (spec §4). Kind is
 * `strategy`: the canonical loop is strategy-as-data (spec §2 lists L3 as
 * "data: graphs"), not an L2 plugin — `faculty` would claim a peer of
 * compiler/memory/gates, `gate` and `agentTemplate` are roles the loop
 * INVOKES, and skills/workshopTools are something else entirely. Of the
 * frozen ManifestKind values, `strategy` is the honest one.
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';

/**
 * The workflows registration manifest. Consumes a TaskContract (the run
 * entry), emits an Outcome (retrospect's close). Tier `suggest`: the engine
 * orchestrates and proposes; every blocking decision inside the loop is a
 * gate's, under the gate's own tier. Zero token cost — the engine never
 * calls a model (all work is injected executors); latency is dominated by
 * the executors themselves.
 */
export const workflowsManifest: Manifest = ManifestSchema.parse({
  name: '@kernloop/workflows',
  version: '0.1.0',
  kind: 'strategy',
  capabilities: [
    {
      name: 'workflow.canonical',
      description:
        'Run the canonical loop (spec §6) over injected executors with per-node checkpoint/resume and the K-bounded vote-iterate cycle',
    },
  ],
  contracts: {
    consumes: ['TaskContract'],
    emits: ['Outcome'],
  },
  cost: {
    tokens: 0,
    usd: 0,
    latencyMs: 0,
  },
  tier: 'suggest',
  claims: ['CLM-0042', 'CLM-0043', 'CLM-0044', 'CLM-0045'],
  maturity: 'stable',
});
