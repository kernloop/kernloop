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

/** The per-CALL series table; OUTCOME_FITNESS_TABLE is its deliverable-pass twin. */
export const CALL_FITNESS_TABLE = 'observer_fitness_identity';
/** The OUTCOME-level (deliverable-pass) series table (#229/#5). */
export const OUTCOME_FITNESS_TABLE = 'observer_fitness_identity_outcome';
/** The two identity-fitness tables — a CLOSED union so the interpolated `table`
 * arg can never be arbitrary SQL (the #357 review's latent-injection hardening). */
type FitnessTable = typeof CALL_FITNESS_TABLE | typeof OUTCOME_FITNESS_TABLE;

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
  table: FitnessTable = CALL_FITNESS_TABLE,
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
    `INSERT INTO ${table}
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
  const record = fitnessForIdentity(db, { provider, family, generation, tier }, table);
  /* v8 ignore next -- the row was just upserted on the same connection */
  if (record === undefined) throw new InvalidModelFitnessError('identity row missing after upsert');
  return record;
}

/** Outcome-level (deliverable-pass) ingest (#229/#5): same identity keying as the
 * per-call series but into the SEPARATE {@link OUTCOME_FITNESS_TABLE}. */
export function ingestOutcomeFitness(
  db: Database.Database,
  now: number,
  identity: ModelIdentity,
  success: boolean,
  cost: Cost,
): IdentityFitnessRecord {
  return ingestModelFitness(db, now, identity, success, cost, OUTCOME_FITNESS_TABLE);
}

/** One identity class's fitness, or `undefined` if never served (#66). */
export function fitnessForIdentity(
  db: Database.Database,
  key: IdentityKey,
  table: FitnessTable = CALL_FITNESS_TABLE,
): IdentityFitnessRecord | undefined {
  const row = db
    .prepare(
      `SELECT * FROM ${table}
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
 * the long tail is sound. Omit `limit` for the full series (inspection callers).
 *
 * FAIL-CLOSED: a PROVIDED but invalid `limit` (non-integer or ≤ 0) THROWS rather
 * than silently reverting to the unbounded read — a resource bound must never
 * fail open. Only the deliberate `undefined` returns the full series.
 */
export function identityFitnessLedger(
  db: Database.Database,
  limit?: number,
  table: FitnessTable = CALL_FITNESS_TABLE,
): IdentityFitnessRecord[] {
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new RangeError(
      `identityFitnessLedger limit must be a positive integer, got ${String(limit)}`,
    );
  }
  const order = `ORDER BY lastUsedAt DESC, provider ASC, family ASC, generation ASC, tier ASC`;
  const rows = (
    limit === undefined
      ? db.prepare(`SELECT * FROM ${table} ${order}`).all()
      : db.prepare(`SELECT * FROM ${table} ${order} LIMIT ?`).all(limit)
  ) as IdentityFitnessRow[];
  return rows.map(toRecord);
}

/** The OUTCOME-level (deliverable-pass) identity-fitness series (#229/#5),
 * recency-ordered + bounded like {@link identityFitnessLedger}. */
export function outcomeFitnessLedger(
  db: Database.Database,
  limit?: number,
): IdentityFitnessRecord[] {
  return identityFitnessLedger(db, limit, OUTCOME_FITNESS_TABLE);
}
