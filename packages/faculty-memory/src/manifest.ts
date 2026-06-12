/**
 * The memory faculty's registration record (spec §4, §5.2). Parsed through
 * `ManifestSchema` at module load so an invalid manifest fails fast, not at
 * registry time.
 */
import { ManifestSchema, type Manifest } from '@kernloop/contracts';

/**
 * The faculty-memory registration manifest. Tier is `suggest` — the
 * conservative entry default for anything generative-adjacent (spec §3.2);
 * tier assignment is under ratification review and the orchestrator may
 * adjust at integration. Consumes Outcome (episodic auto-write); emits
 * nothing — recall results travel as Brief fragments compiled elsewhere.
 */
export const memoryManifest: Manifest = ManifestSchema.parse({
  name: '@kernloop/faculty-memory',
  version: '0.1.0',
  kind: 'faculty',
  capabilities: [
    { name: 'memory.semantic.write', description: 'Store a typed fact; provenance mandatory' },
    { name: 'memory.semantic.recall', description: 'Rank facts by relevance, provenance, recency' },
    { name: 'memory.episodic.write', description: 'Record an Outcome as summary + trace pointer' },
    { name: 'memory.episodic.read', description: 'Fetch trace summaries, newest first' },
  ],
  contracts: {
    consumes: ['Outcome'],
    emits: [],
  },
  cost: {
    tokens: 0,
    usd: 0,
    latencyMs: 50,
  },
  tier: 'suggest',
  claims: ['CLM-0022', 'CLM-0023', 'CLM-0024', 'CLM-0025'],
  maturity: 'stable',
});
