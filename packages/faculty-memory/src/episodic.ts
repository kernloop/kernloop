/**
 * Episodic store (spec §5.2): replayable traces as compressed summary +
 * pointer to the full trace. Write policy — auto on Outcome, summarized at
 * write time (spec §8 item 5: digests, not transcripts; the transcript lives
 * behind `traceRef`). Read policy — summaries, newest first.
 */
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { OutcomeSchema, type Outcome, type OutcomeStatus } from '@kernloop/contracts';
import { InvalidOutcomeError } from './errors.js';

/** A stored episodic trace summary. `createdAt` is epoch milliseconds. */
export interface TraceSummary {
  taskId: string;
  summary: string;
  traceRef: string;
  status: OutcomeStatus;
  distillCandidates: string[];
  createdAt: number;
}

/** Default maximum number of summaries a listing returns. */
export const DEFAULT_LIST_LIMIT = 20;

interface TraceRow {
  taskId: string;
  summary: string;
  traceRef: string;
  status: string;
  distillCandidates: string;
  createdAt: number;
}

function toSummary(row: TraceRow): TraceSummary {
  return {
    taskId: row.taskId,
    summary: row.summary,
    traceRef: row.traceRef,
    status: row.status as OutcomeStatus,
    distillCandidates: JSON.parse(row.distillCandidates) as string[],
    createdAt: row.createdAt,
  };
}

/**
 * Record an Outcome as a trace summary (CLM-0024). The Outcome is
 * zod-validated at the boundary; invalid values throw
 * {@link InvalidOutcomeError}. Stored: the write-time `summary`, the
 * `traceRef` pointer, status, and distill candidates — never the full
 * transcript. One row per task; re-recording a task's Outcome replaces it.
 */
export function recordOutcome(
  db: Database.Database,
  now: number,
  outcome: Outcome,
  summary: string,
): TraceSummary {
  const parsed = OutcomeSchema.safeParse(outcome);
  if (!parsed.success) {
    throw new InvalidOutcomeError(
      `episodic memory write rejected: ${z.prettifyError(parsed.error)}`,
    );
  }
  const { taskId, traceRef, status, distillCandidates } = parsed.data;
  const row = db
    .prepare(
      `INSERT INTO traces (taskId, summary, traceRef, status, distillCandidates, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(taskId) DO UPDATE SET
         summary = excluded.summary,
         traceRef = excluded.traceRef,
         status = excluded.status,
         distillCandidates = excluded.distillCandidates,
         createdAt = excluded.createdAt
       RETURNING taskId, summary, traceRef, status, distillCandidates, createdAt`,
    )
    .get(taskId, summary, traceRef, status, JSON.stringify(distillCandidates), now);
  return toSummary(row as TraceRow);
}

/** Fetch one task's trace summary by id, or `undefined` when absent. */
export function getTraceSummary(db: Database.Database, taskId: string): TraceSummary | undefined {
  const row = db
    .prepare(
      `SELECT taskId, summary, traceRef, status, distillCandidates, createdAt
       FROM traces WHERE taskId = ?`,
    )
    .get(taskId) as TraceRow | undefined;
  return row === undefined ? undefined : toSummary(row);
}

/** List trace summaries newest-first (CLM-0024); ties break on later insert. */
export function listSummaries(
  db: Database.Database,
  options: { limit?: number } = {},
): TraceSummary[] {
  const limit = options.limit ?? DEFAULT_LIST_LIMIT;
  const rows = db
    .prepare(
      `SELECT taskId, summary, traceRef, status, distillCandidates, createdAt
       FROM traces ORDER BY createdAt DESC, rowid DESC LIMIT ?`,
    )
    .all(limit) as TraceRow[];
  return rows.map(toSummary);
}
