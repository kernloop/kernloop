/**
 * The fitness ledger (spec §5.5, CLM-0055): per-subject invocations, success
 * correlation, accumulated cost, and last-used recency, plus the drift
 * signal computed over each subject's recent outcome window.
 */
import type Database from 'better-sqlite3';
import { OutcomeSchema, type Outcome } from '@kernloop/contracts';
import { InvalidOutcomeError } from './errors.js';

/** Accumulated realized cost on a fitness row. */
export interface FitnessCost {
  readonly tokens: number;
  readonly usd: number;
  readonly wallClockMs: number;
}

/** One fitness-ledger row (CLM-0055). */
export interface FitnessRecord {
  /** The manifest/template/tool name the outcomes are attributed to. */
  readonly subject: string;
  readonly invocations: number;
  /** successes / invocations — the success-correlation signal. */
  readonly successRate: number;
  readonly cost: FitnessCost;
  /** Epoch ms of the most recent ingested Outcome for this subject. */
  readonly lastUsedAt: number;
}

/**
 * Drift detection defaults (spec §5.5 "drift signals"; shape mirrors the
 * spec §3.2 sliding-window evidence threshold). A subject drifts when its
 * success rate over its last `windowN` outcomes sits at least `minDrop`
 * below its lifetime success rate. Both are injectable per call; the
 * defaults are deliberate, documented constants:
 * - `DEFAULT_DRIFT_WINDOW_N = 10` — small enough to react within a working
 *   session, large enough that one flaky outcome (0.1 of the window) cannot
 *   trip the signal alone.
 * - `DEFAULT_DRIFT_MIN_DROP = 0.2` — a fifth of the success scale; below
 *   that, window-vs-lifetime gaps are indistinguishable from sampling noise
 *   at n=10.
 */
export const DEFAULT_DRIFT_WINDOW_N = 10;
export const DEFAULT_DRIFT_MIN_DROP = 0.2;

/** One drift signal: a subject whose recent window underperforms lifetime. */
export interface DriftSignal {
  readonly subject: string;
  /** Success rate over the subject's last `windowN` outcomes. */
  readonly windowRate: number;
  /** Success rate over all of the subject's outcomes. */
  readonly lifetimeRate: number;
  /** lifetimeRate − windowRate (≥ the minDrop threshold). */
  readonly drop: number;
  readonly windowN: number;
}

interface FitnessRow {
  subject: string;
  invocations: number;
  successes: number;
  tokens: number;
  usd: number;
  wallClockMs: number;
  lastUsedAt: number;
}

function toRecord(row: FitnessRow): FitnessRecord {
  return {
    subject: row.subject,
    invocations: row.invocations,
    successRate: row.successes / row.invocations,
    cost: { tokens: row.tokens, usd: row.usd, wallClockMs: row.wallClockMs },
    lastUsedAt: row.lastUsedAt,
  };
}

/**
 * Ingest one Outcome attributed to `subject` (CLM-0055). Zod-validated at
 * the boundary; updates the aggregate row (invocations++, successes++ on
 * `status === 'success'`, cost accumulation, lastUsedAt) and appends to the
 * per-subject outcome log that drift detection reads. Both writes commit in
 * one transaction.
 */
export function ingestOutcome(
  db: Database.Database,
  now: number,
  outcome: Outcome,
  subject: string,
): FitnessRecord {
  const parsed = OutcomeSchema.safeParse(outcome);
  if (!parsed.success) {
    throw new InvalidOutcomeError(`outcome rejected at boundary: ${parsed.error.message}`);
  }
  if (subject.trim().length === 0) {
    throw new InvalidOutcomeError('outcome rejected: subject must be a non-empty string');
  }
  const { taskId, status, cost } = parsed.data;
  const success = status === 'success' ? 1 : 0;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO observer_fitness (subject, invocations, successes, tokens, usd, wallClockMs, lastUsedAt)
       VALUES (?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(subject) DO UPDATE SET
         invocations = invocations + 1,
         successes = successes + excluded.successes,
         tokens = tokens + excluded.tokens,
         usd = usd + excluded.usd,
         wallClockMs = wallClockMs + excluded.wallClockMs,
         lastUsedAt = excluded.lastUsedAt`,
    ).run(subject, success, cost.tokens, cost.usd, cost.wallClockMs ?? 0, now);
    db.prepare(
      `INSERT INTO observer_outcome_log (subject, taskId, status, success, at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(subject, taskId, status, success, now);
  })();
  const record = fitness(db, subject);
  /* v8 ignore next -- the row was just upserted in the same connection */
  if (record === undefined) throw new InvalidOutcomeError('fitness row missing after upsert');
  return record;
}

/** One subject's fitness, or `undefined` if it has never been observed. */
export function fitness(db: Database.Database, subject: string): FitnessRecord | undefined {
  const row = db.prepare('SELECT * FROM observer_fitness WHERE subject = ?').get(subject) as
    | FitnessRow
    | undefined;
  return row === undefined ? undefined : toRecord(row);
}

/** The whole ledger, most recently used first. */
export function fitnessLedger(db: Database.Database): FitnessRecord[] {
  const rows = db
    .prepare('SELECT * FROM observer_fitness ORDER BY lastUsedAt DESC, subject ASC')
    .all() as FitnessRow[];
  return rows.map(toRecord);
}

/** Options for {@link driftSignals}; defaults documented on the constants. */
export interface DriftOptions {
  readonly windowN?: number;
  readonly minDrop?: number;
}

/**
 * Subjects whose success rate over their last `windowN` outcomes dropped at
 * least `minDrop` below their lifetime rate (spec §5.5). Honest minimum:
 * a subject is only assessed once it has a full window of outcomes —
 * partial windows are sampling noise, not drift.
 */
export function driftSignals(db: Database.Database, options: DriftOptions = {}): DriftSignal[] {
  const windowN = options.windowN ?? DEFAULT_DRIFT_WINDOW_N;
  const minDrop = options.minDrop ?? DEFAULT_DRIFT_MIN_DROP;
  const signals: DriftSignal[] = [];
  for (const row of fitnessLedger(db)) {
    if (row.invocations < windowN) continue;
    const recent = db
      .prepare(
        'SELECT success FROM observer_outcome_log WHERE subject = ? ORDER BY id DESC LIMIT ?',
      )
      .all(row.subject, windowN) as { success: number }[];
    const windowRate = recent.reduce((sum, r) => sum + r.success, 0) / windowN;
    const drop = row.successRate - windowRate;
    if (drop >= minDrop) {
      signals.push({
        subject: row.subject,
        windowRate,
        lifetimeRate: row.successRate,
        drop,
        windowN,
      });
    }
  }
  return signals;
}
