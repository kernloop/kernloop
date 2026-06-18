/**
 * JSONL audit store + appendEvent (spec §3.3: "append-only JSONL for the
 * audit chain"; spec §10 item 1). Plain library functions only — the `audit`
 * MCP tool wraps these in P1.
 *
 * The audit log is MULTI-WRITER-SAFE across OS processes (CLM-0127, #244): two
 * processes on one overlay — the MCP `serve` and a CLI verb (dogfood mode) —
 * may append to the same JSONL concurrently. Serialization is via a small
 * SQLite SIDECAR (`<filePath>.lock.db`): each append takes a `BEGIN IMMEDIATE`
 * write lock, sources the next `seq`/`prevHash` from the sidecar's authoritative
 * tip row, appends the JSONL line, then commits the new tip — so no two
 * appenders, in this or another process, ever assign the same seq. The log
 * itself stays append-only JSONL (the human-readable record of truth); the
 * sidecar holds no events, only the O(1) tip plus the JSONL byte size it is
 * consistent with. Each append trusts that tip when the log's size still matches
 * (a `statSync`, O(1)) and falls back to re-reading the JSONL ONLY when the size
 * diverges — a fresh sidecar or a crash that left the log ahead — so the chain
 * self-heals (the JSONL always wins) without paying an O(N) read per append.
 * `verifyChain`, the envelope schema, the hash, and the JSONL format are
 * unchanged — only HOW seq/prevHash are sourced + serialized.
 *
 * @module kernel/audit/store
 */

import Database from 'better-sqlite3';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { type JsonValue } from './canonical.js';
import {
  AuditEnvelopeSchema,
  GENESIS_PREV_HASH,
  buildEnvelope,
  type AuditEnvelope,
} from './envelope.js';
import { ensureChainKeyed, getEpochKey } from './keyring.js';

/** Thrown on append-path failures (unreadable tip, invalid input). */
export class AuditStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditStoreError';
  }
}

/** Cached chain tip: the position the next envelope will extend. */
interface ChainTip {
  lastSeq: number;
  lastHash: string;
  /** JSONL byte size consistent with this tip — the O(1) staleness guard. */
  byteLen: number;
}

/**
 * Handle to one append-only JSONL audit log. Create via
 * {@link createAuditStore}; treat fields as private to the audit module.
 */
export interface AuditStore {
  /** Absolute or relative path of the JSONL log file. */
  readonly filePath: string;
  /** Injectable clock (tests pass a fixed clock for determinism). */
  readonly clock: () => Date;
  /**
   * Path to the HMAC keyring (#280 [CLM-0146]); when set, appends are KEYED
   * (HMAC-SHA256) and `verifyChain` enforces the keyed-segment floor. Omitted
   * ⇒ a legacy/unkeyed chain (plain SHA-256), byte-identical to pre-keying.
   * The keyring lives OUTSIDE the overlay, so an overlay-JSONL attacker cannot
   * forge the cutover boundary that defeats a downgrade.
   */
  readonly keyringPath?: string;
  /** Sink for the one-time keyring-generation / chain-keying warnings. */
  readonly warn: (msg: string) => void;
  /**
   * Lazily-opened SQLite sidecar that serializes cross-process appends and
   * holds the authoritative chain tip; null until the first append in THIS
   * process opens it (#244). The sidecar — not any in-memory counter — is the
   * source of `seq`/`prevHash`, so two processes cannot collide.
   */
  sidecar: Database.Database | null;
}

/**
 * Create a store handle for a JSONL audit log file. The file (and its parent
 * directory) is created on first append; an existing file is extended.
 *
 * @param filePath - path to the `.jsonl` log file
 * @param options.clock - clock used for envelope `ts` (default: system time)
 * @param options.keyringPath - HMAC keyring path; set ⇒ keyed chain (#280)
 * @param options.warn - sink for the one-time keyring-generation notice;
 *   default is a NO-OP so the audit layer never writes to a process stream
 *   (mixing a human notice with machine stdout/stderr would corrupt the CLI's
 *   clean-JSON contract). `kernloop doctor` surfaces keyring status instead.
 */
export function createAuditStore(
  filePath: string,
  options?: { clock?: () => Date; keyringPath?: string; warn?: (msg: string) => void },
): AuditStore {
  return {
    filePath,
    clock: options?.clock ?? (() => new Date()),
    ...(options?.keyringPath === undefined ? {} : { keyringPath: options.keyringPath }),
    warn: options?.warn ?? ((): void => {}),
    sidecar: null,
  };
}

/** Filesystem path of the SQLite tip sidecar beside a JSONL log. */
function sidecarPath(filePath: string): string {
  return `${filePath}.lock.db`;
}

/** Idempotent schema for the single-row tip sidecar (id is pinned to 1). */
const SIDECAR_SCHEMA_DDL = `CREATE TABLE IF NOT EXISTS audit_tip (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  lastSeq INTEGER NOT NULL,
  lastHash TEXT NOT NULL,
  byteLen INTEGER NOT NULL
);`;

/**
 * Open (once per process) the SQLite tip sidecar beside the JSONL log. WAL +
 * a busy timeout match the observer/program-store hardening (#157): a
 * concurrent appender's `BEGIN IMMEDIATE` blocks up to the timeout rather than
 * failing SQLITE_BUSY. The sidecar holds NO events — only the O(1) chain tip.
 */
function openSidecar(store: AuditStore): Database.Database {
  if (store.sidecar !== null) return store.sidecar;
  mkdirSync(dirname(store.filePath), { recursive: true });
  const db = new Database(sidecarPath(store.filePath));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SIDECAR_SCHEMA_DDL);
  store.sidecar = db;
  return db;
}

/** Split file text into JSONL lines, dropping the trailing empty segment. */
export function readChainLines(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, 'utf8');
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Recover the chain tip (incl. the JSONL byte size) from the last line of an
 * existing log — the O(N) reconcile path, run only on a fresh/diverged sidecar. */
function recoverTip(filePath: string): ChainTip {
  const byteLen = existsSync(filePath) ? statSync(filePath).size : 0;
  const lines = readChainLines(filePath);
  const last = lines.at(-1);
  if (last === undefined) return { lastSeq: 0, lastHash: GENESIS_PREV_HASH, byteLen };
  let parsed: unknown;
  try {
    parsed = JSON.parse(last);
  } catch {
    throw new AuditStoreError(
      `cannot append: last line of ${filePath} is not valid JSON — run verifyChain`,
    );
  }
  const result = AuditEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    throw new AuditStoreError(
      `cannot append: last line of ${filePath} is not a valid envelope — run verifyChain`,
    );
  }
  return { lastSeq: result.data.seq, lastHash: result.data.hash, byteLen };
}

/**
 * The sidecar's authoritative tip under an already-held write lock — an O(1)
 * common path (#244). The sidecar row carries the JSONL `byteLen` it is
 * consistent with; when the log's ACTUAL size matches, the row IS the tip with
 * no JSONL read. We fall back to the O(N) {@link recoverTip} ONLY when the row
 * is absent (fresh DB) or the sizes diverge — i.e. the JSONL changed out of band
 * (a crash left a half-written append ahead of the sidecar, or an external
 * edit). Then the JSONL wins (it is canonical) and the sidecar is reseeded, so
 * the chain self-heals. The size guard is a `statSync` (O(1)), so a long log
 * never pays an O(N) read per append.
 */
function reconciledTip(db: Database.Database, filePath: string): ChainTip {
  const row = db.prepare('SELECT lastSeq, lastHash, byteLen FROM audit_tip WHERE id = 1').get() as
    | { lastSeq: number; lastHash: string; byteLen: number }
    | undefined;
  const actualSize = existsSync(filePath) ? statSync(filePath).size : 0;
  if (row !== undefined && row.byteLen === actualSize) {
    return { lastSeq: row.lastSeq, lastHash: row.lastHash, byteLen: row.byteLen };
  }
  const jsonlTip = recoverTip(filePath);
  db.prepare(
    'INSERT INTO audit_tip (id, lastSeq, lastHash, byteLen) VALUES (1, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET lastSeq = excluded.lastSeq, ' +
      'lastHash = excluded.lastHash, byteLen = excluded.byteLen',
  ).run(jsonlTip.lastSeq, jsonlTip.lastHash, jsonlTip.byteLen);
  return jsonlTip;
}

/**
 * Build the next envelope for `tip`, keyed under the store's keyring when one
 * is configured. Runs inside the append's write lock: for a keyed store it
 * ensures this chain is registered in the keyring (generating the keyring on a
 * fresh install, recording this chain's cutover seq the first time) and HMACs
 * under the current epoch's key; for an unkeyed store it builds a legacy
 * plain-SHA envelope, byte-identical to a pre-keying chain.
 */
function buildNextEnvelope(
  store: AuditStore,
  tip: ChainTip,
  event: { type: string; payload: JsonValue },
): AuditEnvelope {
  const base = {
    seq: tip.lastSeq + 1,
    ts: store.clock().toISOString(),
    type: event.type,
    payload: event.payload,
    prevHash: tip.lastHash,
  };
  if (store.keyringPath === undefined) return buildEnvelope(base);
  const keyring = ensureChainKeyed(store.keyringPath, store.filePath, base.seq, store.warn);
  const key = getEpochKey(keyring, keyring.currentEpoch);
  return buildEnvelope({ ...base, keyEpoch: keyring.currentEpoch, key });
}

/**
 * Append one event to the chain (spec §3.1) — Cross-process-safe (CLM-0127,
 * #244). The seq/prevHash source and the JSONL append run inside a
 * `BEGIN IMMEDIATE` critical section on the SQLite sidecar, so concurrent
 * appenders — even in separate OS processes on one overlay — serialize and
 * never collide on a seq. The tip is read from the sidecar (reconciled against
 * the JSONL record of truth) under the lock, the next envelope is built
 * (monotonic `seq`, `prevHash` linking to the tip), the line is appended, and
 * the sidecar tip is updated before COMMIT releases the lock; a throw rolls
 * back. The log stays append-only JSONL and `verifyChain` is unchanged.
 *
 * Synchronous by design: an audit append must complete (or throw) before the
 * action it records proceeds — no silent actions (constitutional rule 7).
 *
 * @param store - handle from {@link createAuditStore}
 * @param event - `type` (non-empty string) and JSON-serializable `payload`
 * @returns the persisted envelope
 * @throws AuditStoreError if the existing log tip is unreadable;
 *   ZodError/CanonicalizationError if `event` is malformed.
 */
export function appendEvent(
  store: AuditStore,
  event: { type: string; payload: JsonValue },
): AuditEnvelope {
  const db = openSidecar(store);
  db.exec('BEGIN IMMEDIATE');
  try {
    const tip = reconciledTip(db, store.filePath);
    const envelope = buildNextEnvelope(store, tip, event);
    const line = JSON.stringify(envelope) + '\n';
    appendFileSync(store.filePath, line, 'utf8');
    db.prepare('UPDATE audit_tip SET lastSeq = ?, lastHash = ?, byteLen = ? WHERE id = 1').run(
      envelope.seq,
      envelope.hash,
      tip.byteLen + Buffer.byteLength(line, 'utf8'),
    );
    db.exec('COMMIT');
    return envelope;
  } catch (err) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw err;
  }
}
