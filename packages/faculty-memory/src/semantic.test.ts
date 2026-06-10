import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMemory,
  DECAY_HALF_LIFE_MS,
  InvalidFactError,
  ProvenanceRequiredError,
  type Memory,
} from './index.js';

const T0 = Date.UTC(2026, 0, 1);

let dir: string;
let nowMs: number;
let memory: Memory;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-memory-'));
  nowMs = T0;
  memory = createMemory(path.join(dir, 'memory.sqlite'), { clock: () => nowMs });
});

afterEach(() => {
  memory.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('rememberFact — provenance is mandatory (CLM-0022)', () => {
  it('rejects a fact write with missing provenance', () => {
    expect(() => memory.rememberFact({ fact: 'the build uses turborepo' } as never)).toThrowError(
      ProvenanceRequiredError,
    );
  });

  it('rejects a fact write with empty provenance', () => {
    expect(() => memory.rememberFact({ fact: 'the build uses turborepo', provenance: '' })).toThrow(
      ProvenanceRequiredError,
    );
  });

  it('rejects a fact write with whitespace-only provenance', () => {
    expect(() =>
      memory.rememberFact({ fact: 'the build uses turborepo', provenance: '   ' }),
    ).toThrowError(ProvenanceRequiredError);
  });

  it('rejects an empty fact', () => {
    expect(() => memory.rememberFact({ fact: '', provenance: 'trace:t-1' })).toThrowError(
      InvalidFactError,
    );
  });

  it('rejects an out-of-range confidence', () => {
    expect(() =>
      memory.rememberFact({ fact: 'x', provenance: 'trace:t-1', confidence: 1.5 }),
    ).toThrowError(InvalidFactError);
  });

  it('stores a provenance-tagged fact and returns the record', () => {
    const record = memory.rememberFact({
      fact: 'coverage thresholds are 80 percent',
      provenance: 'doc:AGENTS.md#definition-of-done',
      confidence: 0.9,
    });
    expect(record).toMatchObject({
      fact: 'coverage thresholds are 80 percent',
      provenance: 'doc:AGENTS.md#definition-of-done',
      confidence: 0.9,
      createdAt: T0,
      refreshedAt: T0,
    });
  });
});

describe('recallFacts — relevance × provenance × recency (CLM-0023)', () => {
  it('recalls facts by token overlap with the query', () => {
    memory.rememberFact({ fact: 'the kernel audits every action', provenance: 'spec:§1' });
    memory.rememberFact({ fact: 'briefs are reproducible artifacts', provenance: 'spec:§5.1' });
    const hits = memory.recallFacts('how does the kernel audit things', { now: T0 });
    expect(hits.map((h) => h.fact)).toEqual(['the kernel audits every action']);
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it('returns no facts for a query with zero overlap', () => {
    memory.rememberFact({ fact: 'the kernel audits every action', provenance: 'spec:§1' });
    expect(memory.recallFacts('unrelated topic entirely', { now: T0 })).toEqual([]);
  });

  it('ranks an unrefreshed older fact below a fresher equally-relevant one', () => {
    memory.rememberFact({ fact: 'gate panels default to voters three', provenance: 'spec:§5.3' });
    nowMs = T0 + 30 * 24 * 60 * 60 * 1000; // 30 days later
    memory.rememberFact({ fact: 'gate panels share one compiled brief', provenance: 'spec:§8' });
    const hits = memory.recallFacts('gate panels', { now: nowMs });
    expect(hits.map((h) => h.fact)).toEqual([
      'gate panels share one compiled brief',
      'gate panels default to voters three',
    ]);
    expect(hits[1]!.score).toBeLessThan(hits[0]!.score);
  });

  it('re-remembering an identical fact resets its decay clock', () => {
    memory.rememberFact({ fact: 'gate panels default to voters three', provenance: 'spec:§5.3' });
    nowMs = T0 + 30 * 24 * 60 * 60 * 1000;
    memory.rememberFact({ fact: 'gate panels share one compiled brief', provenance: 'spec:§8' });
    // Refresh the older fact at the same instant — it must now outrank or tie.
    const refreshed = memory.rememberFact({
      fact: 'gate panels default to voters three',
      provenance: 'spec:§5.3',
    });
    expect(refreshed.refreshedAt).toBe(nowMs);
    expect(refreshed.createdAt).toBe(T0);
    const hits = memory.recallFacts('gate panels three', { now: nowMs });
    expect(hits[0]?.fact).toBe('gate panels default to voters three');
  });

  it('decays a fact by half per half-life', () => {
    memory.rememberFact({ fact: 'decay clock fades', provenance: 'spec:§5.2' });
    const fresh = memory.recallFacts('decay clock fades', { now: T0 });
    const stale = memory.recallFacts('decay clock fades', { now: T0 + DECAY_HALF_LIFE_MS });
    expect(stale[0]!.score).toBeCloseTo(fresh[0]!.score / 2, 10);
  });

  it('does not duplicate a re-remembered fact', () => {
    memory.rememberFact({ fact: 'only one of me', provenance: 'trace:t-1' });
    memory.rememberFact({ fact: 'only one of me', provenance: 'trace:t-2' });
    const hits = memory.recallFacts('only one of me', { now: T0 });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.provenance).toBe('trace:t-2');
  });

  it('honors the recall limit option', () => {
    for (let i = 0; i < 5; i += 1) {
      memory.rememberFact({ fact: `shared topic variant ${i}`, provenance: 'trace:t-1' });
    }
    expect(memory.recallFacts('shared topic', { now: T0, limit: 2 })).toHaveLength(2);
  });

  it('stores SQL-injection-shaped fact text safely via parameterized statements', () => {
    const hostile = "'); DROP TABLE facts; --";
    memory.rememberFact({ fact: hostile, provenance: "x' OR '1'='1" });
    memory.rememberFact({ fact: 'facts table still here', provenance: 'trace:t-1' });
    // The hostile text was stored verbatim as data, not executed as SQL …
    const hits = memory.recallFacts('DROP TABLE facts', { now: T0 });
    expect(hits[0]?.fact).toBe(hostile);
    // … and the facts table itself survived and keeps serving other facts.
    const survivors = memory.recallFacts('facts table still here', { now: T0 });
    expect(survivors[0]?.fact).toBe('facts table still here');
  });
});
