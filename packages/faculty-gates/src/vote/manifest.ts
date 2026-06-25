/**
 * The vote gate's registration record (spec §4, §5.3). Parsed through
 * `ManifestSchema` at module load so an invalid manifest fails fast, not at
 * registry time. A separate manifest from the quality gate's: the registry
 * keys on name@version, and the two gates' authority tiers must be
 * promotable independently (spec §3.2).
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';

/**
 * Manifest for the vote gate. Tier is `advisory` (spec §3.2) — promotion to
 * `enforce` needs evidence + ratification, never a default.
 *
 * The authority tier here governs RATIFICATION authority (whether the vote
 * gate's verdict may ratify a protected/spec/tier decision — the #328/#348
 * native-ratifier role, today still external via consensus_vote + human),
 * DECOUPLED from the gate's LOOP role. That loop role — plan-iterate: a
 * rejecting vote re-enters plan, bounded by K, then escalates the run — is
 * STRUCTURAL in the canonical graph and TIER-INDEPENDENT (there is no
 * voteGateDrivesIteration flag; cf. the review gate, whose enforce promotion
 * DOES flip child re-iteration, #328 Inc1). So `advisory` is honest: the vote
 * gate drives the loop but does NOT yet ratify external decisions, and
 * promoting its tier (a future #348 step, gated on parity evidence + human
 * sign-off) changes ratification authority, not loop mechanics [CLM-0184, #480].
 *
 * Consumes TaskContract (what to judge) and Brief (the one shared compiled
 * context every voter receives, CLM-0039); emits Verdict. Expected cost: the
 * default 3-voter panel on a `large`-tier model at high effort — the `model`
 * requirement declares that demand per spec §8.4 so the loop/Router can
 * resolve and budget-match; actual cost is metered by the injected adapters
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
  // Plan ratification is load-bearing: large tier, high effort (spec §8.4).
  model: { tier: 'large', effort: 'high', capabilities: [] },
});
