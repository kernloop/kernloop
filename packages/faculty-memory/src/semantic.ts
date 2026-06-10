/**
 * Semantic store (spec §5.2): typed facts in SQLite. Write policy —
 * provenance mandatory, optional confidence, decay clock (unrefreshed facts
 * fade). Read policy — ranked by relevance × provenance × recency.
 * All SQL uses parameterized statements; fact/provenance text is data, never
 * SQL.
 */
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { InvalidFactError, ProvenanceRequiredError } from './errors.js';

/** A stored semantic fact. Timestamps are epoch milliseconds. */
export interface FactRecord {
  id: number;
  fact: string;
  provenance: string;
  confidence: number | null;
  createdAt: number;
  refreshedAt: number;
}

/** A recalled fact with its ranking score (see {@link recallFacts}). */
export interface RecalledFact extends FactRecord {
  score: number;
}

/** Input to {@link rememberFact}. Provenance is mandatory (spec §5.2). */
export interface RememberFactInput {
  fact: string;
  provenance: string;
  confidence?: number;
}

/** Options for {@link recallFacts}. */
export interface RecallOptions {
  /** Clock for decay scoring, epoch ms; injectable for deterministic tests. */
  now?: number;
  /** Maximum facts returned; default {@link DEFAULT_RECALL_LIMIT}. */
  limit?: number;
}

const RememberFactSchema = z.strictObject({
  fact: z.string().min(1, 'fact must be a non-empty string'),
  provenance: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

/** Decay half-life: an unrefreshed fact's recency factor halves every 14 days. */
export const DECAY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/** Default maximum number of facts a recall returns. */
export const DEFAULT_RECALL_LIMIT = 10;

/**
 * Write (or refresh) a fact. Provenance is mandatory: missing, empty, or
 * whitespace-only provenance throws {@link ProvenanceRequiredError}
 * (CLM-0022); other malformed input throws {@link InvalidFactError}.
 * Re-remembering an identical fact does not duplicate it — it updates
 * provenance/confidence and resets `refreshedAt`, the decay clock (CLM-0023).
 */
export function rememberFact(
  db: Database.Database,
  now: number,
  input: RememberFactInput,
): FactRecord {
  const parsed = RememberFactSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidFactError(`semantic memory write rejected: ${z.prettifyError(parsed.error)}`);
  }
  const { fact, provenance, confidence } = parsed.data;
  if (provenance === undefined || provenance.trim().length === 0) {
    throw new ProvenanceRequiredError();
  }
  const row = db
    .prepare(
      `INSERT INTO facts (fact, provenance, confidence, createdAt, refreshedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(fact) DO UPDATE SET
         provenance = excluded.provenance,
         confidence = COALESCE(excluded.confidence, facts.confidence),
         refreshedAt = excluded.refreshedAt
       RETURNING id, fact, provenance, confidence, createdAt, refreshedAt`,
    )
    .get(fact, provenance, confidence ?? null, now, now);
  return row as FactRecord;
}

/** Lowercased word tokens of a text (split on non-alphanumerics, deduped). */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 0),
  );
}

/**
 * Score one fact against a query (spec §5.2 read policy: relevance ×
 * provenance × recency). The formula, exactly:
 *
 * - **relevance** — token overlap: |query tokens ∩ fact tokens| / |query
 *   tokens|, over lowercased word tokens. 0 means no shared token.
 * - **provenance** — 1 when provenance is present, else 0. Writes make
 *   provenance mandatory, so this factor is 1 for every stored fact; it is
 *   kept explicit so the spec's ranking contract is visible in code.
 * - **recency** — exponential decay on the decay clock:
 *   `2 ** (-(now - refreshedAt) / DECAY_HALF_LIFE_MS)`. A fact refreshed
 *   "now" scores 1; every 14 unrefreshed days halve it. Re-remembering
 *   resets `refreshedAt`, so refreshed facts outrank stale ones (CLM-0023).
 */
function scoreFact(fact: FactRecord, queryTokens: Set<string>, now: number): number {
  let overlap = 0;
  const factTokens = tokenize(fact.fact);
  for (const token of queryTokens) {
    if (factTokens.has(token)) overlap += 1;
  }
  const relevance = queryTokens.size === 0 ? 0 : overlap / queryTokens.size;
  const provenanceFactor = fact.provenance.trim().length > 0 ? 1 : 0;
  const ageMs = Math.max(0, now - fact.refreshedAt);
  const recency = 2 ** (-ageMs / DECAY_HALF_LIFE_MS);
  return relevance * provenanceFactor * recency;
}

/**
 * Recall facts relevant to `query`, ranked by the score documented on
 * {@link scoreFact}. Facts with zero relevance are omitted. Ties break on
 * fresher `refreshedAt`, then insertion order. `now` is injectable for
 * deterministic decay tests.
 */
export function recallFacts(
  db: Database.Database,
  query: string,
  options: RecallOptions = {},
): RecalledFact[] {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? DEFAULT_RECALL_LIMIT;
  const queryTokens = tokenize(query);
  const rows = db
    .prepare('SELECT id, fact, provenance, confidence, createdAt, refreshedAt FROM facts')
    .all() as FactRecord[];
  return rows
    .map((fact) => ({ ...fact, score: scoreFact(fact, queryTokens, now) }))
    .filter((fact) => fact.score > 0)
    .sort((a, b) => b.score - a.score || b.refreshedAt - a.refreshedAt || a.id - b.id)
    .slice(0, limit);
}
