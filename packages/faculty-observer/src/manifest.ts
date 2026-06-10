/**
 * The observer faculty's registration record (spec §4, §5.5). Parsed through
 * `ManifestSchema` at module load so an invalid manifest fails fast, not at
 * registry time.
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';

/**
 * Manifest for @kernloop/faculty-observer. Tier is `suggest` — the Observer
 * may file issues and proposals but never blocks, acts, or mutates anything
 * outside its own tables (spec §3.2, §5.5). Consumes every Outcome and
 * Verdict off the bus (subscription wired at the composition root); emits
 * nothing — telemetry is read through the `observe` kernel tool, and
 * self-issues travel through the tracker, not the bus.
 */
export const observerManifest: Manifest = ManifestSchema.parse({
  name: '@kernloop/faculty-observer',
  version: '0.1.0',
  kind: 'faculty',
  capabilities: [
    { name: 'observer.ingest', description: 'Consume every Outcome and Verdict into telemetry' },
    {
      name: 'observer.fitness',
      description: 'Fitness ledger, voter precision series, cost per governed decision, drift',
    },
    { name: 'observer.issues', description: 'File self-issues at suggest tier via gh' },
  ],
  contracts: {
    consumes: ['Outcome', 'Verdict'],
    emits: [],
  },
  cost: {
    tokens: 0,
    usd: 0,
    latencyMs: 50,
  },
  tier: 'suggest',
  claims: ['CLM-0055', 'CLM-0056'],
  maturity: 'stable',
});
