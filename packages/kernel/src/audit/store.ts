/**
 * JSONL audit store + appendEvent (spec §3.3: "append-only JSONL for the
 * audit chain"; spec §10 item 1). Plain library functions only — the `audit`
 * MCP tool wraps these in P1.
 *
 * The store handle assumes a single exclusive writer per file (local-first,
 * one resident process per session — spec §3.3). The chain tip (last seq +
 * hash) is recovered from the file on first use and cached on the handle;
 * external concurrent writers are out of contract and are caught after the
 * fact by `verifyChain`, not prevented here.
 *
 * @module kernel/audit/store
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type JsonValue } from './canonical.js';
import {
  AuditEnvelopeSchema,
  GENESIS_PREV_HASH,
  buildEnvelope,
  type AuditEnvelope,
} from './envelope.js';

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
  /** Lazily-recovered chain tip; null until first append. */
  tip: ChainTip | null;
}

/**
 * Create a store handle for a JSONL audit log file. The file (and its parent
 * directory) is created on first append; an existing file is extended.
 *
 * @param filePath - path to the `.jsonl` log file
 * @param options.clock - clock used for envelope `ts` (default: system time)
 */
export function createAuditStore(filePath: string, options?: { clock?: () => Date }): AuditStore {
  return { filePath, clock: options?.clock ?? (() => new Date()), tip: null };
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

/** Recover the chain tip from the last line of an existing log. */
function recoverTip(filePath: string): ChainTip {
  const lines = readChainLines(filePath);
  const last = lines.at(-1);
  if (last === undefined) return { lastSeq: 0, lastHash: GENESIS_PREV_HASH };
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
  return { lastSeq: result.data.seq, lastHash: result.data.hash };
}

/**
 * Append one event to the chain (spec §3.1). Builds the next envelope —
 * monotonic `seq`, `prevHash` linking to the current tip, `contractsVersion`
 * stamped from @kernloop/contracts — validates it, and appends it as one
 * self-contained JSON line.
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
  store.tip ??= recoverTip(store.filePath);
  const envelope = buildEnvelope({
    seq: store.tip.lastSeq + 1,
    ts: store.clock().toISOString(),
    type: event.type,
    payload: event.payload,
    prevHash: store.tip.lastHash,
  });
  mkdirSync(dirname(store.filePath), { recursive: true });
  appendFileSync(store.filePath, JSON.stringify(envelope) + '\n', 'utf8');
  store.tip = { lastSeq: envelope.seq, lastHash: envelope.hash };
  return envelope;
}
