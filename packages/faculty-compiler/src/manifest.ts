/**
 * The compiler faculty's registration record (spec §4, §5.1). Parsed through
 * `ManifestSchema` at module load so an invalid manifest fails fast, not at
 * registry time.
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';

/**
 * Manifest for @kernloop/faculty-compiler. Tier is `observe` — the compiler
 * only reads its typed inputs and assembles a Brief; it never acts, mutates,
 * or calls a model (spec §3.2). Cost profile is zero tokens/usd: assembly is
 * pure local computation.
 */
export const compilerManifest: Manifest = ManifestSchema.parse({
  name: '@kernloop/faculty-compiler',
  version: '0.1.0',
  kind: 'faculty',
  capabilities: [
    {
      name: 'brief.compile',
      description:
        'Deterministically assemble a budgeted, provenance-tagged Brief from a TaskContract',
    },
  ],
  contracts: {
    consumes: ['TaskContract'],
    emits: ['Brief'],
  },
  cost: {
    tokens: 0,
    usd: 0,
    latencyMs: 10,
  },
  tier: 'observe',
  claims: ['CLM-0029', 'CLM-0030'],
  maturity: 'stable',
});
