/**
 * The per-model-call identity fitness series (#66, CLM-0125) — an ADDITIVE
 * sibling of the subject-keyed fitness ledger (ledger.ts). Where `ingestOutcome`
 * keys fitness on a manifest/template/tool SUBJECT (so learning resets when a
 * model version bumps), this series keys on the normalized {@link ModelIdentity}
 * tuple `(provider, family, generation, tier)` — the model CLASS the loop node
 * was actually served — so the success/cost record survives a model-version
 * bump and an `unknown` identity buckets in its own row, never merging into a
 * named class. The subject-keyed `observer_fitness` table and the priors/router
 * that read it are untouched: this is a NEW table, written by a NEW function.
 */
import type Database from 'better-sqlite3';
import {
  CostSchema,
  ModelIdentitySchema,
  type Cost,
  type ModelIdentity,
} from '@kernloop/contracts';
import { InvalidModelFitnessError } from './errors.js';

/** The four-field key one identity-fitness row is keyed on (#66). */
export interface IdentityKey {
  readonly provider: string;
  readonly family: string;
  /** Opaque generation label; NEVER compared across providers as a number. */
  readonly generation: string;
  readonly tier: string;
}

/** Accumulated realized cost on an identity-fitness row. */
export interface IdentityFitnessCost {
  readonly tokens: number;
  readonly usd: number;
  readonly wallClockMs: number;
}

/** One identity-fitness row (#66): the key + invocations/successRate/cost/recency. */
export interface IdentityFitnessRecord {
  readonly key: IdentityKey;
  readonly invocations: number;
  /** successes / invocations — the per-class success-correlation signal. */
  readonly successRate: number;
  readonly cost: IdentityFitnessCost;
  /** Epoch ms of the most recent model call served by this identity class. */
  readonly lastUsedAt: number;
}

interface IdentityFitnessRow {
  provider: string;
  family: string;
  generation: string;
  tier: string;
  invocations: number;
  successes: number;
  tokens: number;
  usd: number;
  wallClockMs: number;
  lastUsedAt: number;
}

function toRecord(row: IdentityFitnessRow): IdentityFitnessRecord {
  return {
    key: {
      provider: row.provider,
      family: row.family,
      generation: row.generation,
      tier: row.tier,
    },
    invocations: row.invocations,
    successRate: row.successes / row.invocations,
    cost: { tokens: row.tokens, usd: row.usd, wallClockMs: row.wallClockMs },
    lastUsedAt: row.lastUsedAt,
  };
}

/**
 * Ingest one per-MODEL-CALL fitness event keyed on a served {@link ModelIdentity}
 * (#66, CLM-0125). `identity` and `cost` are zod-validated at the boundary
 * (throwing {@link InvalidModelFitnessError}); the row is UPSERTed on the
 * `(provider, family, generation, tier)` tuple — `invocations + 1`,
 * `successes += success ? 1 : 0`, cost accumulation, `lastUsedAt = now`. Two
 * distinct served aliases that normalize to the SAME tuple accumulate into ONE
 * row; an `unknown` identity (family `'unknown'`) keys a DISTINCT row and never
 * merges into a named class. This writes ONLY `observer_fitness_identity`; the
 * subject-keyed `observer_fitness` ledger is never touched.
 */
export function ingestModelFitness(
  db: Database.Database,
  now: number,
  identity: ModelIdentity,
  success: boolean,
  cost: Cost,
): IdentityFitnessRecord {
  const parsedId = ModelIdentitySchema.safeParse(identity);
  if (!parsedId.success) {
    throw new InvalidModelFitnessError(
      `model identity rejected at boundary: ${parsedId.error.message}`,
    );
  }
  const parsedCost = CostSchema.safeParse(cost);
  if (!parsedCost.success) {
    throw new InvalidModelFitnessError(
      `model-call cost rejected at boundary: ${parsedCost.error.message}`,
    );
  }
  const { provider, family, generation, tier } = parsedId.data;
  const { tokens, usd, wallClockMs } = parsedCost.data;
  const succeeded = success ? 1 : 0;
  db.prepare(
    `INSERT INTO observer_fitness_identity
       (provider, family, generation, tier, invocations, successes, tokens, usd, wallClockMs, lastUsedAt)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, family, generation, tier) DO UPDATE SET
       invocations = invocations + 1,
       successes = successes + excluded.successes,
       tokens = tokens + excluded.tokens,
       usd = usd + excluded.usd,
       wallClockMs = wallClockMs + excluded.wallClockMs,
       lastUsedAt = excluded.lastUsedAt`,
  ).run(provider, family, generation, tier, succeeded, tokens, usd, wallClockMs ?? 0, now);
  const record = fitnessForIdentity(db, { provider, family, generation, tier });
  /* v8 ignore next -- the row was just upserted on the same connection */
  if (record === undefined) throw new InvalidModelFitnessError('identity row missing after upsert');
  return record;
}

/** One identity class's fitness, or `undefined` if never served (#66). */
export function fitnessForIdentity(
  db: Database.Database,
  key: IdentityKey,
): IdentityFitnessRecord | undefined {
  const row = db
    .prepare(
      `SELECT * FROM observer_fitness_identity
       WHERE provider = ? AND family = ? AND generation = ? AND tier = ?`,
    )
    .get(key.provider, key.family, key.generation, key.tier) as IdentityFitnessRow | undefined;
  return row === undefined ? undefined : toRecord(row);
}

/**
 * The identity-fitness series, most recently used first (#66). With `limit`
 * (a positive integer), returns only the `limit` MOST-RECENTLY-USED classes —
 * a bounded, recency-ordered read so a hot-path caller (e.g. the router's
 * live-fitness prior, CLM-0128) cannot materialize an unboundedly large table
 * (#253). Recency-decayed scoring already discounts stale classes, so dropping
 * the long tail is sound. Omit `limit` for the full series.
 */
export function identityFitnessLedger(
  db: Database.Database,
  limit?: number,
): IdentityFitnessRecord[] {
  const order = `ORDER BY lastUsedAt DESC, provider ASC, family ASC, generation ASC, tier ASC`;
  const bounded = limit !== undefined && Number.isInteger(limit) && limit > 0;
  const rows = (
    bounded
      ? db.prepare(`SELECT * FROM observer_fitness_identity ${order} LIMIT ?`).all(limit)
      : db.prepare(`SELECT * FROM observer_fitness_identity ${order}`).all()
  ) as IdentityFitnessRow[];
  return rows.map(toRecord);
}
