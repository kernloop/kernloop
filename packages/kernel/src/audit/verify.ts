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
 *  - `epoch_regression`      a line's keyEpoch is below the prior line's —
 *                            keyEpoch is non-decreasing along the chain
 *  - `downgrade_detected`    a line at/after the keyring's per-chain cutover
 *                            (firstKeyedSeq) is UNKEYED (epoch 0) — the
 *                            wholesale-downgrade-to-plain-SHA forgery (#280)
 *  - `missing_key`           a keyed line's epoch key is absent from the
 *                            keyring — a typed failure, NEVER a silent
 *                            fallback to unkeyed verification
 *  - `truncated_below_floor` the chain is SHORTER than the keyring's per-chain
 *                            cutover (firstKeyedSeq) — the keyed prefix was
 *                            erased (#280; suffix truncation ABOVE the floor
 *                            still needs `expectedLength`, see caveat / #331)
 *  - `keyring_unavailable`   the keyring could not be loaded (insecure perms,
 *                            malformed, partial) — a typed failure so a reader
 *                            surfaces verified:false instead of throwing
 *
 * KEYED CHAINS (#280 [CLM-0146]): when the store has a `keyringPath`, the
 * keyring (which lives OFF the overlay, so an overlay-JSONL attacker cannot
 * write it) supplies each epoch's HMAC key and the per-chain cutover seq. The
 * cutover is the unforgeable anchor: an attacker who re-stamps every record to
 * epoch 0 and recomputes the plain-SHA chain is caught by `downgrade_detected`
 * because the keyring still asserts "keyed from seq N". This is on-host
 * tamper-EVIDENCE, not tamper-PROOF: an attacker who can READ the key file
 * forges, and one who can DELETE the keyring downgrades the whole chain to
 * legacy verification (keyring absent ⇒ unkeyed) — both are out of the threat
 * model and documented in ./keyring.ts.
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
import { chainBoundary, getEpochKey, loadKeyring, type AuditKeyring } from './keyring.js';

/** Why verification failed; see module docs for the tamper class each names. */
export type VerifyFailureReason =
  | 'malformed_line'
  | 'invalid_envelope'
  | 'seq_mismatch'
  | 'prev_hash_mismatch'
  | 'hash_mismatch'
  | 'length_mismatch'
  | 'epoch_regression'
  | 'downgrade_detected'
  | 'missing_key'
  | 'truncated_below_floor'
  | 'keyring_unavailable';

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

/** Parse + schema + seq + prevHash structural checks; the parsed envelope or a failure. */
function parseEnvelopeLine(
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
  return env;
}

/**
 * Enforce the keyed-segment invariants against the keyring (#280): keyEpoch is
 * non-decreasing, and no line at/after this chain's cutover may be unkeyed
 * (the wholesale-downgrade defense). Returns a failure or null (passes).
 */
function checkEpoch(
  env: AuditEnvelope,
  seq: number,
  prevEpoch: number,
  keyring: AuditKeyring | null,
  chainId: string,
): VerifyFailure | null {
  const epoch = env.keyEpoch ?? 0;
  if (epoch < prevEpoch) {
    return fail(
      'epoch_regression',
      seq,
      `seq ${seq} keyEpoch ${epoch} is below the prior epoch ${prevEpoch} (epochs are non-decreasing)`,
    );
  }
  if (keyring === null || epoch !== 0) return null;
  const cutover = chainBoundary(keyring, chainId);
  if (cutover !== undefined && seq >= cutover) {
    return fail(
      'downgrade_detected',
      seq,
      `seq ${seq} is unkeyed but the keyring keys this chain from seq ${cutover} (downgrade)`,
    );
  }
  return null;
}

/**
 * The HMAC key for a keyed line, or a failure. A keyed line with no keyring or
 * no matching key is `missing_key` — NEVER a silent fallback to unkeyed verify.
 * A legacy line (epoch absent) resolves to undefined (plain SHA-256).
 */
function resolveEpochKey(
  env: AuditEnvelope,
  seq: number,
  keyring: AuditKeyring | null,
): Buffer | undefined | VerifyFailure {
  if (env.keyEpoch === undefined) return undefined;
  if (keyring === null) {
    return fail(
      'missing_key',
      seq,
      `seq ${seq} is keyed (epoch ${env.keyEpoch}) but no keyring is available — cannot verify`,
    );
  }
  try {
    return getEpochKey(keyring, env.keyEpoch);
  } catch {
    return fail(
      'missing_key',
      seq,
      `seq ${seq} keyEpoch ${env.keyEpoch} has no key in the keyring`,
    );
  }
}

/**
 * Verify one line at 1-based `seq`: structure, then the keyed-segment
 * invariants and the (keyed or legacy) content hash. Returns the parsed
 * envelope when the line passes, or the first failure signal.
 */
function verifyLine(
  line: string,
  seq: number,
  expectedPrevHash: string,
  prevEpoch: number,
  keyring: AuditKeyring | null,
  chainId: string,
): AuditEnvelope | VerifyFailure {
  const parsed = parseEnvelopeLine(line, seq, expectedPrevHash);
  if ('ok' in parsed) return parsed;
  const epochFail = checkEpoch(parsed, seq, prevEpoch, keyring, chainId);
  if (epochFail !== null) return epochFail;
  const key = resolveEpochKey(parsed, seq, keyring);
  if (key !== undefined && !Buffer.isBuffer(key)) return key;
  if (computeEnvelopeHash(parsed, key) !== parsed.hash) {
    return fail('hash_mismatch', seq, `seq ${seq} stored hash does not match recomputed content`);
  }
  return parsed;
}

/**
 * Verify the whole chain in a store's JSONL file. An absent or empty file is
 * a valid chain of length 0. When the store is keyed (#280 [CLM-0146]) the
 * keyring supplies each epoch's HMAC key and the per-chain cutover, and the
 * no-downgrade floor rejects a wholesale rewrite to plain SHA-256.
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
  // A keyring that cannot be loaded (insecure perms, malformed, partial) is a
  // typed FAILURE, never a throw — a reader (doctor, metrics, observe) must
  // surface `verified:false`, not crash on the exact condition it diagnoses.
  let keyring: AuditKeyring | null;
  try {
    keyring = store.keyringPath === undefined ? null : loadKeyring(store.keyringPath);
  } catch (err) {
    return fail('keyring_unavailable', 0, err instanceof Error ? err.message : String(err));
  }
  const lines = readChainLines(store.filePath);
  let prevHash = GENESIS_PREV_HASH;
  let prevEpoch = 0;
  for (let i = 0; i < lines.length; i++) {
    const result = verifyLine(lines[i] ?? '', i + 1, prevHash, prevEpoch, keyring, store.filePath);
    if ('ok' in result) return result;
    prevHash = result.hash;
    prevEpoch = result.keyEpoch ?? 0;
  }
  // No-downgrade-by-DELETION floor: the off-overlay keyring asserts this chain
  // is keyed from `firstKeyedSeq`, so a chain SHORTER than that floor has had
  // its keyed prefix erased — a forgery (erase-to-empty/below-floor) the
  // per-line floor cannot see because the lines are simply gone. (Suffix
  // truncation ABOVE the floor still needs `expectedLength` — the documented
  // caveat — until the keyring records a high-water seq, #331.)
  if (keyring !== null) {
    const cutover = chainBoundary(keyring, store.filePath);
    if (cutover !== undefined && lines.length < cutover) {
      return fail(
        'truncated_below_floor',
        lines.length,
        `chain has ${lines.length} envelope(s) but the keyring keys it from seq ${cutover} ` +
          `(keyed prefix erased)`,
      );
    }
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
