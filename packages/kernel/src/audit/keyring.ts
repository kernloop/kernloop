/**
 * Audit HMAC keyring — the keyed-segment key material and the unforgeable
 * cutover boundary for the audit chain (#280 part 1, [CLM-0146]).
 *
 * THE TRUST ROOT MOVES OUT OF THE LOG. A SHA-256 chain is forgeable by anyone
 * who can rewrite the JSONL: edit the records, recompute the plain hashes, and
 * `verifyChain` accepts the result. Keying the hash with an HMAC closes that —
 * BUT only if `verifyChain` cannot be tricked into the unkeyed branch. The
 * keyring is that anchor: it lives OUTSIDE the overlay (default
 * `~/.config/kernloop/audit.key`, 0600), so an attacker who can rewrite the
 * overlay's JSONL still cannot write the keyring, and therefore cannot forge
 * the assertion "this chain is keyed from seq N" (`chains[id].firstKeyedSeq`).
 * `verifyChain` reads that floor and rejects any unkeyed envelope at/after it
 * (see ./verify.ts), so the all-records-downgraded-to-epoch-0 rewrite fails.
 *
 * THREAT MODEL (stated honestly — this is on-host tamper-EVIDENCE, not
 * tamper-PROOF). HMAC-SHA256 is symmetric: an attacker who can READ the 0600
 * key file (same user, or root) forges freely — this slice defends against an
 * attacker who can rewrite the JSONL but cannot read the key file. It carries
 * no defense against an attacker who can DELETE the keyring: with the keyring
 * absent the chain verifies as a legacy unkeyed chain (downgrade-by-deletion),
 * which is the inherent limit of a single on-host secret with no separate
 * custody or remote witness. Closing that needs a remote/separate-custody
 * verifier — explicitly out of scope here and tracked as a deferred follow-up.
 *
 * KEY DURABILITY. A fresh key is minted ONLY when NO keyring exists; an
 * existing keyring is never re-keyed in place (a silent re-key would orphan the
 * prior keyed segment and be indistinguishable from tampering). Key loss after
 * keyed operation is therefore unrecoverable: the keyed segment becomes
 * permanently unverifiable. The operator MUST back up the key file.
 *
 * @module kernel/audit/keyring
 */

import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Thrown on any keyring failure — never a silent fallback to unkeyed verify. */
export class AuditKeyringError extends Error {
  override readonly name = 'AuditKeyringError';
  constructor(message: string) {
    super(message);
  }
}

/** A 32-byte HMAC key, lowercase hex (64 chars). */
const KeyHexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'epoch key must be 64 lowercase hex chars (32 bytes)');

/** One chain's keyed cutover: the 1-based seq at which keying began. */
const ChainEntrySchema = z.object({ firstKeyedSeq: z.number().int().positive() }).strict();

/**
 * The keyring file contract. `keys` maps a positive epoch (as a decimal
 * string) to its HMAC key; `chains` records each chain's cutover seq, keyed by
 * the chain's JSONL path. `currentEpoch` is the epoch new appends are HMAC'd
 * under and MUST have a key in `keys`.
 */
export const AuditKeyringSchema = z
  .object({
    currentEpoch: z.number().int().positive(),
    keys: z.record(
      z.string().regex(/^[1-9]\d*$/, 'epoch must be a positive integer'),
      KeyHexSchema,
    ),
    chains: z.record(z.string(), ChainEntrySchema),
  })
  .strict();

export type AuditKeyring = z.infer<typeof AuditKeyringSchema>;

/**
 * Default keyring location, OUTSIDE any overlay: `$XDG_CONFIG_HOME/kernloop/
 * audit.key` or `~/.config/kernloop/audit.key`. Placing it off the overlay is
 * what gives the cutover floor its teeth against an overlay-JSONL attacker.
 */
export function defaultAuditKeyringPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg !== undefined && xdg !== '' ? xdg : join(homedir(), '.config');
  return join(base, 'kernloop', 'audit.key');
}

/** Refuse a keyring whose perms are looser than 0600 (any group/world bit). */
function assertSecurePerms(path: string): void {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new AuditKeyringError(
      `audit keyring ${path} has insecure permissions ${mode.toString(8).padStart(4, '0')}; ` +
        `require 0600 (no group/world access) — run: chmod 600 ${path}`,
    );
  }
}

/**
 * Load and validate the keyring at `path`, or return null when it is ABSENT
 * (an unkeyed/legacy chain). Throws — never returns null and never silently
 * re-keys — on insecure perms, malformed content, or a keyring missing the key
 * for its own `currentEpoch` (a partial keyring is a typed failure, not a
 * licence to mint a replacement).
 */
export function loadKeyring(path: string): AuditKeyring | null {
  if (!existsSync(path)) return null;
  assertSecurePerms(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new AuditKeyringError(`audit keyring ${path} is not valid JSON`);
  }
  const result = AuditKeyringSchema.safeParse(parsed);
  if (!result.success) {
    throw new AuditKeyringError(
      `audit keyring ${path} is malformed: ${result.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  const keyring = result.data;
  if (keyring.keys[String(keyring.currentEpoch)] === undefined) {
    throw new AuditKeyringError(
      `audit keyring ${path} has no key for its currentEpoch ${String(keyring.currentEpoch)}`,
    );
  }
  return keyring;
}

/** Atomically write the keyring at 0600 (temp + rename, never a torn file). */
function writeKeyring(path: string, keyring: AuditKeyring): void {
  mkdirSync(dirname(path), { recursive: true });
  // A UNIQUE temp name per write (#358, #372): the keyring is SHARED across chains
  // but the sidecar write-lock is per-chain, so two distinct-chain first-keyed
  // appends can write concurrently. A fixed `${path}.tmp` made them clobber each
  // other — one writer's `renameSync` moved the temp out from under the other's
  // `chmodSync`, an ENOENT crash that flaked CI (e.g. decompose-preview). A
  // per-write random suffix means each writer renames its OWN temp (last wins; a
  // lost keyring write self-heals on the next append, per ensureChainKeyed).
  // `writeFileSync` already creates at 0600 (umask cannot WIDEN 0600), so the
  // separate post-write chmod — the racy step — is dropped as redundant.
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(keyring, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Ensure the chain identified by `chainId` is keyed under `keyringPath`, and
 * return the keyring (#280 [CLM-0146]). Generates a fresh single-epoch keyring (epoch 1, one
 * random 32-byte key) ONLY when no keyring exists; registers `chainId`'s
 * cutover at `firstKeyedSeq` when this chain is not yet recorded. NEVER mints a
 * new key over an existing keyring. `warn` is called once when a key or a chain
 * cutover is first recorded, so neither happens silently.
 *
 * Concurrency: same-chain appends serialize on the chain's sidecar write lock,
 * so the registering write happens once per chain. Concurrent FIRST-keyed
 * appends to DISTINCT chains can race on this shared keyring file (the sidecar
 * lock is per-chain, not over the keyring) — a documented limitation tracked as
 * a deferred follow-up; a lost write self-heals on the next append.
 */
export function ensureChainKeyed(
  keyringPath: string,
  chainId: string,
  firstKeyedSeq: number,
  warn: (msg: string) => void = () => {},
): AuditKeyring {
  const existing = loadKeyring(keyringPath);
  if (existing === null) {
    const keyring: AuditKeyring = {
      currentEpoch: 1,
      keys: { '1': randomBytes(32).toString('hex') },
      chains: { [chainId]: { firstKeyedSeq } },
    };
    writeKeyring(keyringPath, keyring);
    warn(
      `audit keyring generated at ${keyringPath} (epoch 1, ${chainId} keyed from seq ` +
        `${String(firstKeyedSeq)}); BACK IT UP — key loss makes the keyed segment ` +
        `permanently unverifiable`,
    );
    return keyring;
  }
  if (existing.chains[chainId] === undefined) {
    const keyring: AuditKeyring = {
      ...existing,
      chains: { ...existing.chains, [chainId]: { firstKeyedSeq } },
    };
    writeKeyring(keyringPath, keyring);
    warn(
      `audit chain ${chainId} keyed from seq ${String(firstKeyedSeq)} (epoch ${String(keyring.currentEpoch)})`,
    );
    return keyring;
  }
  return existing;
}

/**
 * The HMAC key for `epoch` as a Buffer, or a typed {@link AuditKeyringError}
 * when the keyring lacks it — NEVER a silent fallback to unkeyed verification.
 */
export function getEpochKey(keyring: AuditKeyring, epoch: number): Buffer {
  const hex = keyring.keys[String(epoch)];
  if (hex === undefined) {
    throw new AuditKeyringError(`audit keyring has no key for epoch ${String(epoch)}`);
  }
  return Buffer.from(hex, 'hex');
}

/** The keyed cutover seq for `chainId`, or undefined when this chain is unkeyed. */
export function chainBoundary(keyring: AuditKeyring, chainId: string): number | undefined {
  return keyring.chains[chainId]?.firstKeyedSeq;
}
