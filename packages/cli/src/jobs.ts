/**
 * The persisted job registry (spec §3.3, §3.4: `run` → "Outcome (or job id)",
 * `status` → "Async job inspection, cross-session"). Every `run` is recorded
 * as a job row so `status --job <jobId>` can inspect any run after the fact,
 * and `run --async` can return a job id immediately while the work settles in
 * the resident MCP server process.
 *
 * Cross-session is by construction: the registry is a SQLite file
 * (`.kernloop/jobs.sqlite`), so a fresh Kernloop over the same overlay
 * resolves a prior job by id. The CLI is the composition root (spec §9), so
 * it MAY use better-sqlite3 directly here, mirroring faculty-memory/store.ts —
 * no faculty imports another (constitutional rule 5); this is root code.
 *
 * Timestamps are epoch milliseconds. The clock is injectable so async-run and
 * cross-session tests are deterministic. `jobId` is supplied by the caller
 * (the run tool, which injects a generator), never minted here — the store
 * persists what it is told, so the id is testable end to end.
 */
import Database from 'better-sqlite3';

/** Terminal and in-flight states a job can hold (spec §3.4). */
export type JobStatus = 'running' | 'done' | 'failed';

/** One persisted job row. `finishedAt`/`traceRef`/`error` are null while running. */
export interface JobRow {
  readonly jobId: string;
  readonly capability: string;
  readonly goal: string;
  readonly status: JobStatus;
  readonly createdAt: number;
  readonly finishedAt: number | null;
  readonly traceRef: string | null;
  readonly error: string | null;
}

/** Fields {@link JobStore.createJob} requires — the run's identity at start. */
export interface CreateJobInput {
  readonly jobId: string;
  readonly capability: string;
  readonly goal: string;
}

/** How a job settled: `done` carries a traceRef, `failed` carries an error. */
export interface FinishJobInput {
  readonly status: 'done' | 'failed';
  readonly traceRef?: string;
  readonly error?: string;
}

/** The job-registry API over one overlay's `jobs.sqlite`. */
export interface JobStore {
  /** Insert a `running` job row at `createdAt = now()`. Returns the row. */
  createJob(input: CreateJobInput): JobRow;
  /** Settle a job to done/failed, stamping `finishedAt = now()`. Returns the
   * updated row, or `undefined` if no such job exists. */
  finishJob(jobId: string, input: FinishJobInput): JobRow | undefined;
  /** One job by id, or `undefined` when absent — never invented. */
  getJob(jobId: string): JobRow | undefined;
  /** Jobs newest-first, capped at `limit` (default {@link DEFAULT_JOB_LIMIT}). */
  listJobs(options?: { limit?: number }): JobRow[];
  /** Close the underlying database handle. */
  close(): void;
}

/** Default number of rows {@link JobStore.listJobs} returns. */
export const DEFAULT_JOB_LIMIT = 20;

/**
 * The job-registry schema. One idempotent `CREATE TABLE IF NOT EXISTS`, so
 * deleting the file and reopening yields a functional, empty registry and
 * reopening an existing file preserves state (mirrors faculty-memory).
 */
export const JOBS_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS jobs (
  jobId TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  finishedAt INTEGER,
  traceRef TEXT,
  error TEXT
);
`;

/** Map a raw row to a typed {@link JobRow} (status is a closed enum at write). */
function toJobRow(row: {
  jobId: string;
  capability: string;
  goal: string;
  status: string;
  createdAt: number;
  finishedAt: number | null;
  traceRef: string | null;
  error: string | null;
}): JobRow {
  return {
    jobId: row.jobId,
    capability: row.capability,
    goal: row.goal,
    status: row.status as JobStatus,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    traceRef: row.traceRef,
    error: row.error,
  };
}

/**
 * Open (creating and migrating if absent) the job registry at `dbPath` and
 * return its API. `clock` returns epoch ms (default `Date.now`), injected so
 * createdAt/finishedAt are deterministic under test.
 */
export function createJobStore(dbPath: string, options: { clock?: () => number } = {}): JobStore {
  const clock = options.clock ?? Date.now;
  const db = new Database(dbPath);
  // WAL + busy timeout: a `status --job` reader stays off SQLITE_BUSY while the
  // resident `serve` writer updates a job (#157).
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(JOBS_SCHEMA_DDL);
  const get = (jobId: string): JobRow | undefined => {
    const row = db.prepare('SELECT * FROM jobs WHERE jobId = ?').get(jobId);
    return row === undefined ? undefined : toJobRow(row as Parameters<typeof toJobRow>[0]);
  };
  return {
    createJob: (input) => {
      const createdAt = clock();
      db.prepare(
        'INSERT INTO jobs (jobId, capability, goal, status, createdAt) VALUES (?, ?, ?, ?, ?)',
      ).run(input.jobId, input.capability, input.goal, 'running', createdAt);
      const row = get(input.jobId);
      if (row === undefined) throw new Error(`job "${input.jobId}" vanished after insert`);
      return row;
    },
    finishJob: (jobId, input) => {
      const finishedAt = clock();
      db.prepare(
        'UPDATE jobs SET status = ?, finishedAt = ?, traceRef = ?, error = ? WHERE jobId = ?',
      ).run(input.status, finishedAt, input.traceRef ?? null, input.error ?? null, jobId);
      return get(jobId);
    },
    getJob: get,
    listJobs: (opts) => {
      const limit = opts?.limit ?? DEFAULT_JOB_LIMIT;
      const rows = db
        .prepare('SELECT * FROM jobs ORDER BY createdAt DESC, jobId DESC LIMIT ?')
        .all(limit);
      return rows.map((r) => toJobRow(r as Parameters<typeof toJobRow>[0]));
    },
    close: () => db.close(),
  };
}
