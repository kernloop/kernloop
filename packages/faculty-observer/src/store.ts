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
