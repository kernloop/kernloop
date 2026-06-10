/**
 * Chain verification — the AuditChain `verify` op (spec §3.1). Walks the
 * JSONL log line by line and reports the FIRST tamper signal; one tamper
 * invalidates everything downstream, so verification does not continue past
 * a failure (behavior carried over from the v1 verifier).
 *
 * Detected tamper classes:
 *  - `malformed_line`        line is not parseable JSON (bit-flips that break
 *                            syntax, merged/garbled lines)
 *  - `invalid_envelope`      JSON parses but fails the envelope schema
 *                            (missing fields, bad contractsVersion format,
 *                            bad hash format, extra fields)
 *  - `seq_mismatch`          seq at line k is not k (gaps from deleted lines,
 *                            reordered lines, duplicated lines)
 *  - `prev_hash_mismatch`    broken linkage — prevHash does not equal the
 *                            prior envelope's hash (forged-rehash attacks:
 *                            a record edited AND rehashed still breaks the
 *                            next record's linkage)
 *  - `hash_mismatch`         stored hash does not match a recomputation of
 *                            the envelope content (any in-place field edit)
 *  - `length_mismatch`       chain is internally consistent but its length
 *                            differs from `expectedLength`
 *
 * TRUNCATION CAVEAT (documented limitation): a hash chain cannot detect pure
 * suffix truncation by itself — chopping the last K lines leaves a shorter
 * but internally valid chain. Detecting it requires an external length
 * witness; pass `expectedLength` (e.g. from a count stored out-of-band, as
 * the CI self-test does) and truncation surfaces as `length_mismatch`.
 *
 * @module kernel/audit/verify
 */

import {
  AuditEnvelopeSchema,
  GENESIS_PREV_HASH,
  computeEnvelopeHash,
  type AuditEnvelope,
} from './envelope.js';
import { readChainLines, type AuditStore } from './store.js';

/** Why verification failed; see module docs for the tamper class each names. */
export type VerifyFailureReason =
  | 'malformed_line'
  | 'invalid_envelope'
  | 'seq_mismatch'
  | 'prev_hash_mismatch'
  | 'hash_mismatch'
  | 'length_mismatch';

/**
 * Discriminated verification result. On failure, `seq` is the 1-based chain
 * position where verification stopped: the line number for per-line
 * failures, or the actual chain length for `length_mismatch`.
 */
export type VerifyResult =
  | { ok: true; length: number }
  | { ok: false; reason: VerifyFailureReason; seq: number; detail: string };

/** The failure arm of {@link VerifyResult}. */
type VerifyFailure = Extract<VerifyResult, { ok: false }>;

function fail(reason: VerifyFailureReason, seq: number, detail: string): VerifyFailure {
  return { ok: false, reason, seq, detail };
}

/**
 * Verify one line at 1-based position `seq` against the expected prevHash.
 * Returns the parsed envelope when the line passes, or the failure signal.
 */
function verifyLine(
  line: string,
  seq: number,
  expectedPrevHash: string,
): AuditEnvelope | VerifyFailure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return fail('malformed_line', seq, `line ${seq} is not valid JSON`);
  }
  const result = AuditEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue === undefined ? '' : ` (${issue.path.join('.')}: ${issue.message})`;
    return fail('invalid_envelope', seq, `line ${seq} is not a valid audit envelope${where}`);
  }
  const env = result.data;
  if (env.seq !== seq) {
    return fail('seq_mismatch', seq, `line ${seq} carries seq ${env.seq}; expected ${seq}`);
  }
  if (env.prevHash !== expectedPrevHash) {
    return fail(
      'prev_hash_mismatch',
      seq,
      `seq ${seq} prevHash ${env.prevHash} does not match prior hash ${expectedPrevHash}`,
    );
  }
  if (computeEnvelopeHash(env) !== env.hash) {
    return fail('hash_mismatch', seq, `seq ${seq} stored hash does not match recomputed content`);
  }
  return env;
}

/**
 * Verify the whole chain in a store's JSONL file. An absent or empty file is
 * a valid chain of length 0.
 *
 * @param store - handle from `createAuditStore`
 * @param options.expectedLength - external length witness; when provided,
 *   the chain must contain exactly this many envelopes (detects suffix
 *   truncation — see module docs)
 * @returns `{ok: true, length}` or the first tamper signal
 */
export function verifyChain(
  store: AuditStore,
  options?: { expectedLength?: number },
): VerifyResult {
  const lines = readChainLines(store.filePath);
  let prevHash = GENESIS_PREV_HASH;
  for (let i = 0; i < lines.length; i++) {
    const result = verifyLine(lines[i] ?? '', i + 1, prevHash);
    if ('ok' in result) return result;
    prevHash = result.hash;
  }
  const expected = options?.expectedLength;
  if (expected !== undefined && lines.length !== expected) {
    return fail(
      'length_mismatch',
      lines.length,
      `chain has ${lines.length} envelope(s); expected ${expected}`,
    );
  }
  return { ok: true, length: lines.length };
}
