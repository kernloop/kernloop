/**
 * Per-voter precision series and verdict-cost accounting (spec §5.5,
 * CLM-0055; spec §8 item 7). `ingestVerdict` appends every VoterRecord to
 * the series; ground-truth labels arrive later via `recordVoterOutcome`,
 * and `runningPrecision` reads a sliding window over the labeled votes —
 * the evidence shape spec §3.2 promotes and demotes tiers on.
 */
import type Database from 'better-sqlite3';
import { VerdictSchema, type Verdict } from '@kernloop/contracts';
import { InvalidVerdictError } from './errors.js';

/** One appended vote in a voter's series. */
export interface VoterSeriesEntry {
  readonly voter: string;
  readonly gate: string;
  readonly vote: string;
  readonly taskId: string;
  /** Epoch ms at ingest time. */
  readonly at: number;
}

/**
 * Default sliding window for {@link runningPrecision}:
 * `DEFAULT_PRECISION_WINDOW_N = 20` — matches the order of magnitude the
 * spec §3.2 example threshold contemplates ("precision ≥ X over sliding
 * window n ≥ Y") while staying reachable within one phase of gate activity.
 */
export const DEFAULT_PRECISION_WINDOW_N = 20;

/** Sliding-window precision over a voter's labeled votes. */
export interface RunningPrecision {
  readonly voter: string;
  /** correct / labeled over the window; undefined when zero labels exist. */
  readonly precision: number | undefined;
  /** How many labeled votes the window actually contained (≤ windowN). */
  readonly labeled: number;
  readonly windowN: number;
}

/** Mean realized cost of a governed decision at one gate (spec §8 item 7). */
export interface GateDecisionCost {
  readonly gate: string;
  readonly decisions: number;
  readonly meanTokens: number;
  readonly meanUsd: number;
  readonly meanWallClockMs: number;
}

/**
 * Ingest one Verdict (CLM-0055). Zod-validated at the boundary; logs the
 * verdict's realized cost against its gate and appends one series row per
 * VoterRecord. Verdicts without voters still feed cost-per-decision.
 * Returns the number of voter rows appended.
 */
export function ingestVerdict(db: Database.Database, now: number, verdict: Verdict): number {
  const parsed = VerdictSchema.safeParse(verdict);
  if (!parsed.success) {
    throw new InvalidVerdictError(`verdict rejected at boundary: ${parsed.error.message}`);
  }
  const { taskId, gate, result, cost, voters } = parsed.data;
  return db.transaction(() => {
    db.prepare(
      `INSERT INTO observer_verdict_log (gate, taskId, result, tokens, usd, wallClockMs, at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(gate, taskId, result, cost.tokens, cost.usd, cost.wallClockMs ?? 0, now);
    const insertVoter = db.prepare(
      `INSERT INTO observer_voter_series (voter, gate, vote, taskId, at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const record of voters ?? []) {
      insertVoter.run(record.voter, gate, record.vote, taskId, now);
    }
    return voters?.length ?? 0;
  })();
}

/** One voter's full vote series, oldest first. */
export function voterSeries(db: Database.Database, voter: string): VoterSeriesEntry[] {
  return db
    .prepare(
      `SELECT voter, gate, vote, taskId, at FROM observer_voter_series
       WHERE voter = ? ORDER BY id ASC`,
    )
    .all(voter) as VoterSeriesEntry[];
}

/**
 * Record a ground-truth label for one voter's vote on one task (CLM-0055):
 * `correct` says whether the vote agreed with the eventual labeled truth.
 * Labels are append-only; precision reads the newest `windowN`.
 */
export function recordVoterOutcome(
  db: Database.Database,
  now: number,
  voter: string,
  taskId: string,
  correct: boolean,
): void {
  if (voter.trim().length === 0 || taskId.trim().length === 0) {
    throw new InvalidVerdictError('voter label rejected: voter and taskId must be non-empty');
  }
  db.prepare(
    'INSERT INTO observer_voter_labels (voter, taskId, correct, at) VALUES (?, ?, ?, ?)',
  ).run(voter, taskId, correct ? 1 : 0, now);
}

/**
 * Sliding-window precision over the voter's last `windowN` labeled votes
 * (spec §3.2 evidence shape). With zero labels, precision is honestly
 * `undefined` — never a stubbed 0 or 1.
 */
export function runningPrecision(
  db: Database.Database,
  voter: string,
  options: { windowN?: number } = {},
): RunningPrecision {
  const windowN = options.windowN ?? DEFAULT_PRECISION_WINDOW_N;
  const rows = db
    .prepare('SELECT correct FROM observer_voter_labels WHERE voter = ? ORDER BY id DESC LIMIT ?')
    .all(voter, windowN) as { correct: number }[];
  const labeled = rows.length;
  const precision =
    labeled === 0 ? undefined : rows.reduce((sum, r) => sum + r.correct, 0) / labeled;
  return { voter, precision, labeled, windowN };
}

/**
 * "What does a governed decision cost" per gate (spec §8 item 7): the mean
 * realized verdict cost over every Verdict ingested for `gate`, or
 * `undefined` when that gate has decided nothing yet.
 */
export function costPerGovernedDecision(
  db: Database.Database,
  gate: string,
): GateDecisionCost | undefined {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS decisions, AVG(tokens) AS meanTokens, AVG(usd) AS meanUsd,
              AVG(wallClockMs) AS meanWallClockMs
       FROM observer_verdict_log WHERE gate = ?`,
    )
    .get(gate) as {
    decisions: number;
    meanTokens: number | null;
    meanUsd: number | null;
    meanWallClockMs: number | null;
  };
  if (row.decisions === 0) return undefined;
  return {
    gate,
    decisions: row.decisions,
    meanTokens: row.meanTokens ?? 0,
    meanUsd: row.meanUsd ?? 0,
    meanWallClockMs: row.meanWallClockMs ?? 0,
  };
}
