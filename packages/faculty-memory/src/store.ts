/**
 * SQLite storage for the memory faculty (spec §3.3, §7): one database file
 * per overlay, opened and migrated on `createMemory`. Migration is a set of
 * idempotent `CREATE TABLE IF NOT EXISTS` statements, so deleting the file
 * and reopening yields a functional, empty store (CLM-0025) and reopening an
 * existing file preserves state.
 */
import Database from 'better-sqlite3';

/**
 * The complete schema. Timestamps are epoch milliseconds.
 *
 * - `facts` — semantic store (spec §5.2): typed facts with mandatory
 *   provenance, optional confidence, and the decay clock (`refreshedAt`).
 *   `fact` is UNIQUE so re-remembering an identical fact refreshes rather
 *   than duplicates.
 * - `traces` — episodic store (spec §5.2, §8 item 5): compressed summary +
 *   pointer to the full trace (`traceRef`), never the transcript itself.
 *   One row per task; a re-recorded Outcome replaces the row.
 */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact TEXT NOT NULL UNIQUE,
  provenance TEXT NOT NULL,
  confidence REAL,
  createdAt INTEGER NOT NULL,
  refreshedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS traces (
  taskId TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  traceRef TEXT NOT NULL,
  status TEXT NOT NULL,
  distillCandidates TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
`;

/** Open (creating if absent) and migrate the overlay database at `dbPath`. */
export function openStore(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.exec(SCHEMA_DDL);
  return db;
}
