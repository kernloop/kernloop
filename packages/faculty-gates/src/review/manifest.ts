/**
 * The review gate's registration record (spec §4, §5.3). Parsed through
 * `ManifestSchema` at module load so an invalid manifest fails fast, not
 * at registry time. A separate manifest from the quality and vote gates':
 * the registry keys on name@version, and each gate's authority tier must
 * be promotable independently (spec §3.2).
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';
import { PROMOTION_CRITERION } from './calibrate.js';

/**
 * Manifest for the review gate. Tier is `advisory` until the v1 Epic-E
 * promotion criterion is met (spec §5.3) — the `promotion` field carries
 * that criterion as data; promotion to `enforce` is a named human-
 * ratification point, never a default. Consumes TaskContract + Brief;
 * emits Verdict whose per-reviewer VoterRecords feed the fitness ledger's
 * precision series (CLM-0047). Expected cost: the default 3-reviewer
 * panel over a PR-sized diff on frontier-tier models (spec §8.4); actual
 * cost is metered by the injected adapters into each Verdict.
 */
export const reviewGateManifest: Manifest = ManifestSchema.parse({
  name: '@kernloop/faculty-gates/review',
  version: '0.1.0',
  kind: 'gate',
  capabilities: [
    {
      name: 'gate.review',
      description:
        'Adversarial diff review by a reviewer panel (3 lenses by default, 5 in full); findings merged, deduplicated, and attributed per reviewer; emits a Verdict with per-voter records for precision tracking',
    },
  ],
  contracts: {
    consumes: ['TaskContract', 'Brief'],
    emits: ['Verdict'],
  },
  cost: {
    tokens: 45_000,
    usd: 0.75,
    latencyMs: 180_000,
  },
  tier: 'advisory',
  promotion: PROMOTION_CRITERION,
  claims: ['CLM-0047', 'CLM-0048'],
  maturity: 'stable',
});
