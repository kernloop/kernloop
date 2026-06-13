/**
 * The gates faculty's registration record (spec §4, §5.3). Parsed through
 * `ManifestSchema` at module load so an invalid manifest fails fast, not at
 * registry time.
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';

/**
 * The faculty-gates registration manifest. P1 surface is the quality gate
 * only. Tier is `advisory` (spec §3.2: may cast non-blocking Verdicts) —
 * verdict emission is non-blocking until the gate is wired into an
 * enforcing path; promotion to `enforce` needs evidence + ratification,
 * never a default. Consumes TaskContract (what to judge), emits Verdict.
 * Expected cost: zero tokens/usd — the gate is mechanical and never calls
 * a model; latency is dominated by the workspace's own tooling.
 */
export const qualityGateManifest: Manifest = ManifestSchema.parse({
  name: '@kernloop/faculty-gates',
  version: '0.1.0',
  kind: 'gate',
  capabilities: [
    {
      name: 'gate.quality',
      description:
        'Run typecheck/lint/test (coverage via test exit) plus an in-process doc-comment scan over a workspace; emit a Verdict',
    },
  ],
  contracts: {
    consumes: ['TaskContract'],
    emits: ['Verdict'],
  },
  cost: {
    tokens: 0,
    usd: 0,
    latencyMs: 60_000,
  },
  tier: 'advisory',
  claims: ['CLM-0031', 'CLM-0104'],
  maturity: 'stable',
});
