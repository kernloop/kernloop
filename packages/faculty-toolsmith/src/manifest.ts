/**
 * The toolsmith faculty's registration record (spec §4, §5.6). Parsed
 * through `ManifestSchema` at module load so an invalid manifest fails fast,
 * not at registry time.
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';

/**
 * Manifest for @kernloop/faculty-toolsmith. Tier is `suggest` — forge output
 * is proposed, not acted on; everything it births starts at `suggest` too
 * (spec §5.6). Consumes TaskContract (a forge request is a task); emits
 * Outcome (the build report).
 */
export const toolsmithManifest: Manifest = ManifestSchema.parse({
  name: '@kernloop/faculty-toolsmith',
  version: '0.1.0',
  kind: 'faculty',
  capabilities: [
    {
      name: 'toolsmith.forge',
      description: 'Birth a workshop tool: validate claim+test+manifest, sandbox-test, install',
    },
    {
      name: 'toolsmith.retire',
      description: 'Human-ratified removal of a workshop tool, history preserved',
    },
    {
      name: 'toolsmith.lifecycle',
      description: 'Workshop ladder: record runs, earned promotion, ratified enforce, decay',
    },
  ],
  contracts: {
    consumes: ['TaskContract'],
    emits: ['Outcome'],
  },
  cost: {
    tokens: 0,
    usd: 0,
    latencyMs: 30000,
  },
  tier: 'suggest',
  claims: ['CLM-0051', 'CLM-0052', 'CLM-0053', 'CLM-0054'],
  maturity: 'stable',
});
