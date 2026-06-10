/**
 * AuditChain append + verify tamper suite (spec §3.1, §10 item 1; seed
 * Step 4). The tamper cases are ported by evidence from v1
 * `audit-chain-verify.test.ts` and re-targeted at the stored JSONL file:
 * bit-flip, truncation, reorder, deletion, payload edit, and forged rehash
 * must all be caught.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contractsVersion } from '@kernloop/contracts';
import { computeEnvelopeHash, type AuditEnvelope } from './envelope.js';
import { AuditStoreError, appendEvent, createAuditStore, type AuditStore } from './store.js';
import { verifyChain } from './verify.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-audit-'));
  file = join(dir, 'audit.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Deterministic clock: one second per tick, fixed epoch. No Date.now. */
function fixedClock(): () => Date {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 5, 9, 0, 0, tick++));
}

function makeStore(): AuditStore {
  return createAuditStore(file, { clock: fixedClock() });
}

function appendN(store: AuditStore, n: number): AuditEnvelope[] {
  const out: AuditEnvelope[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(appendEvent(store, { type: `test.event.${i}`, payload: { n: i, key: `v-${i}` } }));
  }
  return out;
}

function readLines(): string[] {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

function writeLines(lines: string[]): void {
  writeFileSync(file, lines.map((l) => l + '\n').join(''), 'utf8');
}

function expectFailure(result: ReturnType<typeof verifyChain>, reason: string, seq: number): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe(reason);
    expect(result.seq).toBe(seq);
    expect(result.detail).toBeTruthy();
  }
}

describe('appendEvent + verifyChain (happy path)', () => {
  it('appends N events and verifyChain reports ok with length N', () => {
    const store = makeStore();
    appendN(store, 5);
    expect(verifyChain(store)).toEqual({ ok: true, length: 5 });
  });

  it('every stored envelope carries contractsVersion from @kernloop/contracts', () => {
    const store = makeStore();
    appendN(store, 4);
    const envelopes = readLines().map((l) => JSON.parse(l) as AuditEnvelope);
    expect(envelopes).toHaveLength(4);
    for (const env of envelopes) {
      expect(env.contractsVersion).toBe(contractsVersion);
    }
  });

  it('assigns monotonic 1-based seqs and links prevHash to the prior hash', () => {
    const store = makeStore();
    const envs = appendN(store, 3);
    expect(envs.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(envs[0]?.prevHash).toBe('0'.repeat(64));
    expect(envs[1]?.prevHash).toBe(envs[0]?.hash);
    expect(envs[2]?.prevHash).toBe(envs[1]?.hash);
  });

  it('stores each event as one self-contained JSON line (SIEM-compatible)', () => {
    const store = makeStore();
    appendN(store, 3);
    const lines = readLines();
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const env = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(env).sort()).toEqual([
        'contractsVersion',
        'hash',
        'payload',
        'prevHash',
        'seq',
        'ts',
        'type',
      ]);
    }
  });

  it('verifies an absent log as a chain of length 0', () => {
    expect(verifyChain(makeStore())).toEqual({ ok: true, length: 0 });
  });

  it('verifies an empty file as a chain of length 0', () => {
    writeFileSync(file, '', 'utf8');
    expect(verifyChain(makeStore())).toEqual({ ok: true, length: 0 });
  });

  it('passes verification with a matching expectedLength witness', () => {
    const store = makeStore();
    appendN(store, 3);
    expect(verifyChain(store, { expectedLength: 3 })).toEqual({ ok: true, length: 3 });
  });

  it('appends with the default system clock when none is injected', () => {
    // The assertion is clock-independent: whatever ts the system clock
    // produced, the stored chain must verify.
    const store = createAuditStore(file);
    appendEvent(store, { type: 'test.default-clock', payload: null });
    expect(verifyChain(store)).toEqual({ ok: true, length: 1 });
  });

  it('recovers the chain tip across store handles (reopen and extend)', () => {
    appendN(makeStore(), 3);
    const reopened = createAuditStore(file, { clock: fixedClock() });
    const env = appendEvent(reopened, { type: 'test.after-reopen', payload: null });
    expect(env.seq).toBe(4);
    expect(verifyChain(reopened)).toEqual({ ok: true, length: 4 });
  });
});

describe('verifyChain tamper detection', () => {
  it('detects a bit-flip in a stored record and identifies the seq', () => {
    const store = makeStore();
    appendN(store, 5);
    const buf = Buffer.from(readFileSync(file));
    // Flip the low bit of the payload byte 'v' in seq 3's record ('v' -> 'w').
    const offset = buf.indexOf('"v-3"') + 1;
    const target = buf[offset];
    if (target === undefined) throw new Error('offset out of range');
    buf[offset] = target ^ 0x01;
    writeFileSync(file, buf);
    expectFailure(verifyChain(store), 'hash_mismatch', 3);
  });

  it('detects truncation of the log suffix when verified with expectedLength', () => {
    const store = makeStore();
    appendN(store, 5);
    writeLines(readLines().slice(0, 3));
    expectFailure(verifyChain(store, { expectedLength: 5 }), 'length_mismatch', 3);
  });

  it('reports ok after pure suffix truncation without a witness (documented limitation)', () => {
    const store = makeStore();
    appendN(store, 5);
    writeLines(readLines().slice(0, 3));
    // A hash chain alone cannot see suffix truncation; that is exactly why
    // verifyChain accepts an external expectedLength witness (see verify.ts).
    expect(verifyChain(store)).toEqual({ ok: true, length: 3 });
  });

  it('detects reordering of two entries', () => {
    const store = makeStore();
    appendN(store, 4);
    const lines = readLines();
    const [a, b] = [lines[1], lines[2]];
    if (a === undefined || b === undefined) throw new Error('expected 4 lines');
    lines[1] = b;
    lines[2] = a;
    writeLines(lines);
    expectFailure(verifyChain(store), 'seq_mismatch', 2);
  });

  it('detects deletion of a middle line', () => {
    const store = makeStore();
    appendN(store, 4);
    const lines = readLines();
    lines.splice(1, 1);
    writeLines(lines);
    expectFailure(verifyChain(store), 'seq_mismatch', 2);
  });

  it('detects duplication of an entry', () => {
    const store = makeStore();
    appendN(store, 3);
    const lines = readLines();
    const second = lines[1];
    if (second === undefined) throw new Error('expected 3 lines');
    lines.splice(1, 0, second);
    writeLines(lines);
    expectFailure(verifyChain(store), 'seq_mismatch', 3);
  });

  it('detects a payload edit made without recomputing the hash', () => {
    const store = makeStore();
    appendN(store, 3);
    const lines = readLines();
    const env = JSON.parse(lines[1] ?? '') as AuditEnvelope;
    env.payload = { n: 2, key: 'forged' };
    lines[1] = JSON.stringify(env);
    writeLines(lines);
    expectFailure(verifyChain(store), 'hash_mismatch', 2);
  });

  it('detects a forged rehash: payload edited, hash recomputed, downstream linkage breaks', () => {
    const store = makeStore();
    appendN(store, 3);
    const lines = readLines();
    const env = JSON.parse(lines[1] ?? '') as AuditEnvelope;
    env.payload = { n: 2, key: 'forged' };
    env.hash = computeEnvelopeHash(env);
    lines[1] = JSON.stringify(env);
    writeLines(lines);
    // Seq 2 now self-validates, but seq 3's prevHash still names the
    // original hash — the chain breaks one link downstream.
    expectFailure(verifyChain(store), 'prev_hash_mismatch', 3);
  });

  it('rejects a malformed (non-JSON) line', () => {
    const store = makeStore();
    appendN(store, 3);
    const lines = readLines();
    lines[1] = 'this is not json';
    writeLines(lines);
    expectFailure(verifyChain(store), 'malformed_line', 2);
  });

  it('rejects an envelope with a bad contractsVersion format', () => {
    const store = makeStore();
    appendN(store, 3);
    const lines = readLines();
    const env = JSON.parse(lines[1] ?? '') as AuditEnvelope;
    env.contractsVersion = 'banana';
    env.hash = computeEnvelopeHash(env);
    lines[1] = JSON.stringify(env);
    writeLines(lines);
    expectFailure(verifyChain(store), 'invalid_envelope', 2);
  });

  it('rejects a forged genesis: the first envelope must link to GENESIS_PREV_HASH', () => {
    const store = makeStore();
    appendN(store, 2);
    const lines = readLines();
    const env = JSON.parse(lines[1] ?? '') as AuditEnvelope;
    env.seq = 1; // renumber the second record to pose as genesis...
    env.hash = computeEnvelopeHash(env); // ...with a self-consistent hash
    writeLines([JSON.stringify(env)]);
    // ...but its prevHash still names the deleted record, not genesis.
    expectFailure(verifyChain(store), 'prev_hash_mismatch', 1);
  });

  it('reports the first failure only, not subsequent ones', () => {
    const store = makeStore();
    appendN(store, 4);
    const lines = readLines();
    lines[1] = 'garbage';
    lines[2] = 'more garbage';
    writeLines(lines);
    expectFailure(verifyChain(store), 'malformed_line', 2);
  });
});

describe('appendEvent failure modes', () => {
  it('throws AuditStoreError when the existing tail line is not JSON', () => {
    appendN(makeStore(), 2);
    writeFileSync(file, readFileSync(file, 'utf8') + 'garbage tail\n', 'utf8');
    expect(() => appendEvent(makeStore(), { type: 'test.x', payload: null })).toThrow(
      AuditStoreError,
    );
  });

  it('throws AuditStoreError when the existing tail line is not a valid envelope', () => {
    appendN(makeStore(), 2);
    writeFileSync(file, readFileSync(file, 'utf8') + '{"not":"an envelope"}\n', 'utf8');
    expect(() => appendEvent(makeStore(), { type: 'test.x', payload: null })).toThrow(
      AuditStoreError,
    );
  });

  it('rejects a non-JSON payload before writing anything', () => {
    const store = makeStore();
    expect(() =>
      appendEvent(store, { type: 'test.bad', payload: { when: undefined } as never }),
    ).toThrow();
    expect(verifyChain(store)).toEqual({ ok: true, length: 0 });
  });

  it('rejects an empty event type', () => {
    expect(() => appendEvent(makeStore(), { type: '', payload: null })).toThrow();
  });
});
