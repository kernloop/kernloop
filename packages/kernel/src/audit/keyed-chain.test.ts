/**
 * HMAC-keyed audit chain — the #280 part-1 evidence suite ([CLM-0146]).
 *
 * Proves the security property the design exists for: a keyed chain cannot be
 * forged by an attacker who can rewrite the JSONL but cannot write the keyring.
 * The headline case is the DOWNGRADE attack the consensus review caught — a
 * from-genesis all-epoch-0 rehash of a keyed store must FAIL, because the
 * keyring's per-chain cutover (which the attacker cannot forge) asserts the
 * chain is keyed from seq N. Plus monotonic epochs, no-silent-fallback on a
 * missing key, byte-identical legacy verification, perms enforcement, and the
 * never-re-key durability rule.
 */

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hmacSha256Canonical } from './canonical.js';
import { buildEnvelope, type AuditEnvelope } from './envelope.js';
import { AuditKeyringError, ensureChainKeyed, getEpochKey, loadKeyring } from './keyring.js';
import { appendEvent, createAuditStore, type AuditStore } from './store.js';
import { verifyChain } from './verify.js';

let dir: string;
let file: string;
let keyringPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-keyed-'));
  file = join(dir, 'audit.jsonl');
  keyringPath = join(dir, 'audit.key');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Deterministic clock: one second per tick, fixed epoch. No Date.now. */
function fixedClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 5, 17, 0, 0, tick++));
}

function keyedStore(): AuditStore {
  return createAuditStore(file, { clock: fixedClock(), keyringPath });
}

function legacyStore(): AuditStore {
  return createAuditStore(file, { clock: fixedClock() });
}

function appendN(store: AuditStore, n: number): AuditEnvelope[] {
  const out: AuditEnvelope[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(appendEvent(store, { type: `evt.${i}`, payload: { n: i, v: `x-${i}` } }));
  }
  return out;
}

function readLines(): string[] {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

function writeLines(lines: string[]): void {
  writeFileSync(file, lines.map((l) => l + '\n').join(''), 'utf8');
}

/**
 * The downgrade attacker: re-stamp every envelope as legacy/epoch-0 and
 * recompute the PLAIN SHA-256 chain from genesis, so the result is an
 * internally-consistent unkeyed chain. This is exactly the forgery the keyring
 * floor must reject.
 */
function forgeAllEpoch0(originals: AuditEnvelope[]): void {
  let prevHash = '0'.repeat(64);
  const forged = originals.map((env) => {
    const line = buildEnvelope({
      seq: env.seq,
      ts: env.ts,
      type: env.type,
      payload: env.payload,
      prevHash,
    });
    prevHash = line.hash;
    return JSON.stringify(line);
  });
  writeLines(forged);
}

describe('keyed audit chain (#280 [CLM-0146])', () => {
  it('a keyed store appends HMAC envelopes and verifyChain accepts them', () => {
    const store = keyedStore();
    const envs = appendN(store, 4);
    expect(envs.every((e) => e.keyEpoch === 1)).toBe(true);
    const keyring = loadKeyring(keyringPath);
    expect(keyring?.currentEpoch).toBe(1);
    // The hash is a real HMAC under the epoch key, not the plain SHA-256.
    const key = getEpochKey(keyring!, 1);
    const e1 = envs[0]!;
    const expected = hmacSha256Canonical(key, {
      seq: e1.seq,
      ts: e1.ts,
      contractsVersion: e1.contractsVersion,
      type: e1.type,
      payload: e1.payload,
      prevHash: e1.prevHash,
      keyEpoch: 1,
    });
    expect(e1.hash).toBe(expected);
    expect(verifyChain(store)).toEqual({ ok: true, length: 4 });
  });

  it('an all-epoch-0 rehash of a keyed store fails with downgrade_detected', () => {
    const store = keyedStore();
    const envs = appendN(store, 4); // firstKeyedSeq = 1
    forgeAllEpoch0(envs); // attacker downgrades the whole chain to plain SHA-256
    const result = verifyChain(store); // keyring still asserts "keyed from seq 1"
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('downgrade_detected');
      expect(result.seq).toBe(1);
    }
  });

  it('a keyEpoch regression fails with epoch_regression', () => {
    const store = keyedStore();
    const [e1] = appendN(store, 1); // seq 1, epoch 1
    // Forge seq 2 as a legacy (epoch-0) line linked to the keyed seq 1.
    const forged = buildEnvelope({
      seq: 2,
      ts: e1!.ts,
      type: 'evt.2',
      payload: { n: 2 },
      prevHash: e1!.hash,
    });
    writeLines([...readLines(), JSON.stringify(forged)]);
    const result = verifyChain(store);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('epoch_regression');
  });

  it('a tampered keyed payload fails with hash_mismatch', () => {
    const store = keyedStore();
    appendN(store, 3);
    const lines = readLines();
    const env = JSON.parse(lines[1]!) as AuditEnvelope & { payload: { v: string } };
    env.payload.v = 'tampered';
    lines[1] = JSON.stringify(env); // edit payload, do NOT recompute the HMAC
    writeLines(lines);
    const result = verifyChain(store);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('hash_mismatch');
      expect(result.seq).toBe(2);
    }
  });

  it('a keyed line without an available keyring fails with missing_key (no silent fallback)', () => {
    appendN(keyedStore(), 2); // a genuine keyed chain
    // A reader with NO keyring must NOT fall back to unkeyed verification.
    const result = verifyChain(legacyStore());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing_key');
      expect(result.seq).toBe(1);
    }
  });

  it('a legacy unkeyed chain verifies unchanged with no keyring', () => {
    const store = legacyStore();
    appendN(store, 3);
    expect(verifyChain(store)).toEqual({ ok: true, length: 3 });
    // Legacy lines carry NO keyEpoch field — byte-identical to pre-keying.
    expect(readLines().some((l) => l.includes('keyEpoch'))).toBe(false);
  });

  it('keyed appends are byte-identical-shaped: every keyed line carries keyEpoch ≥ 1', () => {
    appendN(keyedStore(), 3);
    expect(readLines().every((l) => (JSON.parse(l) as AuditEnvelope).keyEpoch === 1)).toBe(true);
  });

  it('erasing a keyed chain below its cutover fails with truncated_below_floor', () => {
    const store = keyedStore();
    appendN(store, 4); // firstKeyedSeq = 1
    writeFileSync(file, '', 'utf8'); // attacker erases the whole keyed JSONL
    const result = verifyChain(store); // keyring still asserts "keyed from seq 1"
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('truncated_below_floor');
      expect(result.seq).toBe(0);
    }
  });

  it('a keyring that cannot be loaded fails closed (keyring_unavailable), never throws', () => {
    const store = keyedStore();
    appendN(store, 2);
    chmodSync(keyringPath, 0o644); // perms widened — loadKeyring would throw
    // verifyChain must DEGRADE to a typed failure, not crash a reader (doctor).
    const result = verifyChain(store);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('keyring_unavailable');
  });
});

describe('audit keyring (#280 [CLM-0146])', () => {
  it('loadKeyring refuses a keyring whose perms are looser than 0600', () => {
    ensureChainKeyed(keyringPath, file, 1); // generate at 0600
    chmodSync(keyringPath, 0o644); // operator/attacker widened it
    expect(() => loadKeyring(keyringPath)).toThrow(AuditKeyringError);
  });

  it('ensureChainKeyed never re-keys over an existing keyring', () => {
    const first = ensureChainKeyed(keyringPath, file, 1);
    const key1 = first.keys['1'];
    // A second call (even for a different chain/seq) must NOT mint a new key.
    const second = ensureChainKeyed(keyringPath, join(dir, 'other.jsonl'), 9);
    expect(second.keys['1']).toBe(key1);
    expect(second.currentEpoch).toBe(1);
    expect(second.chains[file]?.firstKeyedSeq).toBe(1);
    expect(second.chains[join(dir, 'other.jsonl')]?.firstKeyedSeq).toBe(9);
  });

  it('loadKeyring returns null when absent (legacy/unkeyed) and never re-keys', () => {
    expect(loadKeyring(keyringPath)).toBeNull();
  });

  it('getEpochKey throws AuditKeyringError for an epoch with no key', () => {
    const keyring = ensureChainKeyed(keyringPath, file, 1);
    expect(() => getEpochKey(keyring, 2)).toThrow(AuditKeyringError);
  });

  it('loadKeyring throws on a keyring that is not valid JSON', () => {
    writeFileSync(keyringPath, 'not json', { mode: 0o600 });
    expect(() => loadKeyring(keyringPath)).toThrow(/not valid JSON/);
  });

  it('loadKeyring throws on a malformed keyring (schema violation)', () => {
    writeFileSync(keyringPath, JSON.stringify({ currentEpoch: 0, keys: {}, chains: {} }), {
      mode: 0o600,
    });
    expect(() => loadKeyring(keyringPath)).toThrow(AuditKeyringError);
  });

  it('loadKeyring rejects a partial keyring missing its currentEpoch key (no re-key)', () => {
    // currentEpoch 2 but only epoch 1's key present — a typed failure, never a
    // licence to mint a replacement (the vote's key-durability condition).
    writeFileSync(
      keyringPath,
      JSON.stringify({ currentEpoch: 2, keys: { '1': '0'.repeat(64) }, chains: {} }),
      { mode: 0o600 },
    );
    expect(() => loadKeyring(keyringPath)).toThrow(/no key for its currentEpoch/);
  });
});

describe('hmacSha256Canonical (#280 [CLM-0146])', () => {
  it('hmacSha256Canonical is pinned and key-sorts identically to sha256Canonical', () => {
    // Pinned fixture: a canonicalization change MUST break this (one canonical
    // form shared by the keyed and unkeyed audit hashes).
    const key = Buffer.alloc(32, 1);
    expect(hmacSha256Canonical(key, { z: 'x', a: 1, b: [2, 3] })).toBe(
      '5bb3cce4c724834d46e69df22f20a1b8c43aa8e5e96053e4969e4f3bdf6d5518',
    );
  });
});
