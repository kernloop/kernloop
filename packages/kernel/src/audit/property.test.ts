/**
 * Property-style tamper test (seed Step 4: "N random events appended →
 * verify passes; any single-byte mutation → verify fails").
 *
 * Determinism contract: all randomness comes from a seeded mulberry32 PRNG
 * and the clock is fixed — no Date.now / Math.random in any assertion path,
 * so every run exercises exactly the same chains and mutations.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type JsonValue } from './canonical.js';
import { appendEvent, createAuditStore, type AuditStore } from './store.js';
import { verifyChain } from './verify.js';

/** mulberry32 — tiny deterministic PRNG, returns floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rand: () => number, maxExclusive: number): number {
  return Math.floor(rand() * maxExclusive);
}

/** Random JSON payload: strings, numbers, booleans, arrays, nested objects. */
function randPayload(rand: () => number, depth = 0): JsonValue {
  const pick = randInt(rand, depth >= 2 ? 4 : 6);
  if (pick === 0) return `s-${String(randInt(rand, 1_000_000))}`;
  if (pick === 1) return randInt(rand, 1_000_000) / 100;
  if (pick === 2) return rand() < 0.5;
  if (pick === 3) return null;
  if (pick === 4) {
    return Array.from({ length: randInt(rand, 4) }, () => randPayload(rand, depth + 1));
  }
  const obj: Record<string, JsonValue> = {};
  for (let i = 0, n = 1 + randInt(rand, 3); i < n; i++) {
    obj[`k${String(randInt(rand, 10))}`] = randPayload(rand, depth + 1);
  }
  return obj;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-audit-prop-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function buildRandomChain(seed: number): { store: AuditStore; file: string; length: number } {
  const rand = mulberry32(seed);
  const file = join(dir, `audit-${String(seed)}.jsonl`);
  let tick = 0;
  const store = createAuditStore(file, {
    clock: () => new Date(Date.UTC(2026, 5, 9, 0, 0, 0, tick++)),
  });
  const length = 10 + randInt(rand, 15);
  for (let i = 0; i < length; i++) {
    appendEvent(store, {
      type: `prop.event.${String(randInt(rand, 5))}`,
      payload: randPayload(rand),
    });
  }
  return { store, file, length };
}

/** Substitute the byte at `offset` with a different byte (guaranteed change). */
function mutateByteAt(file: string, offset: number): void {
  const buf = Buffer.from(readFileSync(file));
  const original = buf[offset];
  if (original === undefined) throw new Error('offset out of range');
  buf[offset] = original === 0x61 /* 'a' */ ? 0x62 /* 'b' */ : 0x61;
  writeFileSync(file, buf);
}

const SEEDS = [1, 2, 3, 42, 1337];
const MUTATIONS_PER_SEED = 25;

describe('property: seeded random chains survive verification, any byte mutation fails it', () => {
  it.each(SEEDS)('seed %i: N random events verify ok with the expected length', (seed) => {
    const { store, length } = buildRandomChain(seed);
    expect(verifyChain(store)).toEqual({ ok: true, length });
    expect(verifyChain(store, { expectedLength: length })).toEqual({ ok: true, length });
  });

  it.each(SEEDS)('seed %i: every single-byte mutation is detected by verifyChain', (seed) => {
    const { store, file, length } = buildRandomChain(seed);
    const pristine = readFileSync(file);
    const rand = mulberry32(seed ^ 0x5eed);
    for (let i = 0; i < MUTATIONS_PER_SEED; i++) {
      mutateByteAt(file, randInt(rand, pristine.length));
      const result = verifyChain(store, { expectedLength: length });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.seq).toBeGreaterThanOrEqual(1);
        expect(result.seq).toBeLessThanOrEqual(length);
      }
      writeFileSync(file, pristine); // restore before the next mutation
    }
  });
});
