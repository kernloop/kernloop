/**
 * The vote gate's registration record (spec §4, §5.3). Parsed through
 * `ManifestSchema` at module load so an invalid manifest fails fast, not at
 * registry time. A separate manifest from the quality gate's: the registry
 * keys on name@version, and the two gates' authority tiers must be
 * promotable independently (spec §3.2).
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';

/**
 * Manifest for the vote gate. Tier is `advisory` (spec §3.2: may cast
 * non-blocking Verdicts) — promotion to `enforce` needs evidence +
 * ratification, never a default (the tier is itself a P2-exit ratification
 * item). Consumes TaskContract (what to judge) and Brief (the one shared
 * compiled context every voter receives, CLM-0039); emits Verdict.
 * Expected cost: the default 3-voter panel on frontier-tier models. The
 * `modelTier: 'frontier'` is declared first-class (spec §8.4: plan
 * ratification runs on frontier) — the SINGLE source the loop's vote node
 * derives its adapter from; actual cost is metered by the injected adapters
 * and summed into each Verdict.
 */
export const voteGateManifest: Manifest = ManifestSchema.parse({
  name: '@kernloop/faculty-gates/vote',
  version: '0.1.0',
  kind: 'gate',
  capabilities: [
    {
      name: 'gate.vote',
      description:
        'Convene a voter panel (3 default, 7 at plan ratification) over one shared Brief; aggregate under simple-majority, supermajority, or unanimous; emit a Verdict',
    },
  ],
  contracts: {
    consumes: ['TaskContract', 'Brief'],
    emits: ['Verdict'],
  },
  cost: {
    tokens: 30_000,
    usd: 0.5,
    latencyMs: 120_000,
  },
  tier: 'advisory',
  claims: ['CLM-0037', 'CLM-0038', 'CLM-0039'],
  maturity: 'stable',
  modelTier: 'frontier',
});
