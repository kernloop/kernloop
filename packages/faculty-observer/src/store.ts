/**
 * SQLite storage for the observer faculty (spec §3.3, §5.5). The Observer
 * shares the one-DB-per-overlay file with other faculties: the composition
 * root supplies `dbPath`, and **table-namespace separation is the ownership
 * boundary** — every Observer table is prefixed `observer_*` and the
 * Observer never reads or writes tables outside that prefix. better-sqlite3
 * serializes two connections to one file, so coexisting with the memory
 * faculty's tables in the same file is safe (proven in store.test.ts).
 *
 * Migration is idempotent `CREATE TABLE IF NOT EXISTS`; deleting the file
 * and reopening yields a functional, empty ledger. Timestamps are epoch ms.
 */
import Database from 'better-sqlite3';

/**
 * The complete observer schema (CLM-0055, CLM-0056):
 *
 * - `observer_fitness` — the fitness ledger aggregate, keyed by subject
 *   (a manifest/template/tool name): invocations, successes, accumulated
 *   cost, last-used recency.
 * - `observer_outcome_log` — one row per ingested Outcome per subject; the
 *   per-subject history that drift detection windows over.
 * - `observer_verdict_log` — one row per ingested Verdict per gate; feeds
 *   cost-per-governed-decision (spec §8 item 7).
 * - `observer_voter_series` — one row per VoterRecord per ingested Verdict;
 *   the per-voter vote series.
 * - `observer_voter_labels` — ground-truth labels supplied later; the
 *   sliding-window precision series (spec §3.2) reads these.
 * - `observer_issues` — self-issue proposals and their filing state
 *   (`proposed` → `filed`), always at `suggest` tier.
 * - `observer_fitness_identity` — the ADDITIVE per-model-call fitness series
 *   keyed on the normalized ModelIdentity tuple `(provider, family, generation,
 *   tier)` (#66), so learning survives a model-version bump (it re-keys on the
 *   model CLASS, not a manifest subject). An `unknown` identity buckets in its
 *   own row, never merging into a named class. This table is SEPARATE from and
 *   ADDITIVE to `observer_fitness`: the subject-keyed ledger (and the
 *   priors/router that read it) is untouched.
 * - `observer_fitness_identity_outcome` — the parallel OUTCOME-LEVEL fitness
 *   series (#229/#5), same identity tuple but counting DELIVERABLES that passed
 *   the quality+review gates, not model CALLS — a higher-quality cross-model
 *   signal. A SEPARATE table from `observer_fitness_identity` so the two never
 *   double-count (call-success vs deliverable-pass are different denominators).
 */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS observer_fitness (
  subject TEXT PRIMARY KEY,
  invocations INTEGER NOT NULL,
  successes INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  usd REAL NOT NULL,
  wallClockMs REAL NOT NULL,
  lastUsedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS observer_fitness_identity (
  provider TEXT NOT NULL,
  family TEXT NOT NULL,
  generation TEXT NOT NULL,
  tier TEXT NOT NULL,
  invocations INTEGER NOT NULL,
  successes INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  usd REAL NOT NULL,
  wallClockMs REAL NOT NULL,
  lastUsedAt INTEGER NOT NULL,
  PRIMARY KEY (provider, family, generation, tier)
);
CREATE TABLE IF NOT EXISTS observer_fitness_identity_outcome (
  provider TEXT NOT NULL,
  family TEXT NOT NULL,
  generation TEXT NOT NULL,
  tier TEXT NOT NULL,
  invocations INTEGER NOT NULL,
  successes INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  usd REAL NOT NULL,
  wallClockMs REAL NOT NULL,
  lastUsedAt INTEGER NOT NULL,
  PRIMARY KEY (provider, family, generation, tier)
);
CREATE TABLE IF NOT EXISTS observer_outcome_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  taskId TEXT NOT NULL,
  status TEXT NOT NULL,
  success INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS observer_verdict_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gate TEXT NOT NULL,
  taskId TEXT NOT NULL,
  result TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  usd REAL NOT NULL,
  wallClockMs REAL NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS observer_voter_series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voter TEXT NOT NULL,
  gate TEXT NOT NULL,
  vote TEXT NOT NULL,
  taskId TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS observer_voter_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voter TEXT NOT NULL,
  taskId TEXT NOT NULL,
  correct INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS observer_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  goal TEXT NOT NULL,
  constraints TEXT NOT NULL,
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  url TEXT,
  createdAt INTEGER NOT NULL,
  filedAt INTEGER
);
`;

/** Open (creating if absent) and migrate the observer tables at `dbPath`. WAL +
 * a busy timeout keep a concurrent reader off a SQLITE_BUSY while `serve` writes
 * (#157); idempotent with the memory faculty, which shares this file. */
export function openStore(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA_DDL);
  return db;
}

/** The four APPEND-ONLY Observer logs that grow one row per run (the fitness
 * ledger + issues are keyed/kept, so they self-bound and are NOT pruned). */
const LOG_TABLES = [
  'observer_outcome_log',
  'observer_verdict_log',
  'observer_voter_series',
  'observer_voter_labels',
] as const;

/** Default retention for the append-only logs: 90 days. The drift/precision
 * windows read only the recent tail, so 90 days keeps ample history while
 * bounding unbounded growth (#159). */
export const DEFAULT_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Delete Observer log rows older than `retentionMs` before the NEWEST log row
 * (#159) [CLM-0112] — run ONCE on open, off the ingest hot path. The reference "now" is the
 * data's own newest timestamp (no clock dependency, so it never disturbs a
 * write-clock), and an empty DB is a no-op. Bounds the append-only logs to a
 * retention-wide window without losing any active subject's recent tail. Table
 * names come from the fixed {@link LOG_TABLES} allowlist (no injection). */
export function pruneLogs(db: Database.Database, retentionMs: number): void {
  let newest = 0;
  for (const table of LOG_TABLES) {
    const row = db.prepare(`SELECT MAX(at) AS m FROM ${table}`).get() as { m: number | null };
    if (row.m !== null && row.m > newest) newest = row.m;
  }
  if (newest === 0) return;
  const cutoff = newest - retentionMs;
  for (const table of LOG_TABLES) db.prepare(`DELETE FROM ${table} WHERE at < ?`).run(cutoff);
}
