import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Outcome } from '@kernloop/contracts';
import { createMemory } from './index.js';
import { openStore } from './store.js';

const T0 = Date.UTC(2026, 0, 1);

const sampleOutcome: Outcome = {
  taskId: 'task-1',
  status: 'success',
  signals: [],
  cost: { tokens: 10, usd: 0 },
  traceRef: 'trace:task-1',
  distillCandidates: [],
};

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-memory-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('repo-local SQLite lifecycle (CLM-0025)', () => {
  it('creates the database file on first open', () => {
    const dbPath = path.join(dir, 'memory.sqlite');
    expect(fs.existsSync(dbPath)).toBe(false);
    const memory = createMemory(dbPath, { clock: () => T0 });
    expect(fs.existsSync(dbPath)).toBe(true);
    memory.close();
  });

  it('reopening an existing database preserves stored facts and traces', () => {
    const dbPath = path.join(dir, 'memory.sqlite');
    const first = createMemory(dbPath, { clock: () => T0 });
    first.rememberFact({ fact: 'persistence survives reopen', provenance: 'trace:t-1' });
    first.recordOutcome(sampleOutcome, 'a kept summary');
    first.close();

    const second = createMemory(dbPath, { clock: () => T0 });
    expect(second.recallFacts('persistence survives reopen', { now: T0 })).toHaveLength(1);
    expect(second.getTraceSummary('task-1')?.summary).toBe('a kept summary');
    second.close();
  });

  it('deleting the database file and reopening yields a functional empty store', () => {
    const dbPath = path.join(dir, 'memory.sqlite');
    const before = createMemory(dbPath, { clock: () => T0 });
    before.rememberFact({ fact: 'doomed fact', provenance: 'trace:t-1' });
    before.recordOutcome(sampleOutcome, 'doomed summary');
    before.close();

    fs.rmSync(dbPath);
    expect(fs.existsSync(dbPath)).toBe(false);

    const after = createMemory(dbPath, { clock: () => T0 });
    // Empty: nothing recalled, nothing listed.
    expect(after.recallFacts('doomed fact', { now: T0 })).toEqual([]);
    expect(after.getTraceSummary('task-1')).toBeUndefined();
    expect(after.listSummaries()).toEqual([]);
    // Functional: both stores accept writes and serve reads again.
    after.rememberFact({ fact: 'fresh start fact', provenance: 'trace:t-2' });
    after.recordOutcome(sampleOutcome, 'fresh summary');
    expect(after.recallFacts('fresh start fact', { now: T0 })).toHaveLength(1);
    expect(after.getTraceSummary('task-1')?.summary).toBe('fresh summary');
    after.close();
  });
});

describe('concurrent-reader safety — WAL + busy_timeout (#157)', () => {
  it('opens in WAL journal mode with a 5s busy timeout', () => {
    const db = openStore(path.join(dir, 'memory.sqlite'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    db.close();
  });

  it('a separate reader proceeds while a writer holds an open transaction (no SQLITE_BUSY)', () => {
    const dbPath = path.join(dir, 'memory.sqlite');
    const writer = openStore(dbPath);
    writer
      .prepare(
        "INSERT INTO facts (fact, provenance, createdAt, refreshedAt) VALUES ('seed','p',1,1)",
      )
      .run();
    // Hold an uncommitted write transaction — the contention the model assumes
    // away (single writer) but the readers must survive.
    writer.exec('BEGIN IMMEDIATE');
    writer
      .prepare(
        "INSERT INTO facts (fact, provenance, createdAt, refreshedAt) VALUES ('pending','p',2,2)",
      )
      .run();
    // A second connection reads the last COMMITTED snapshot without blocking or
    // throwing — this is what WAL buys over the default rollback journal.
    const reader = openStore(dbPath);
    const facts = (
      reader.prepare('SELECT fact FROM facts ORDER BY id').all() as Array<{ fact: string }>
    ).map((r) => r.fact);
    expect(facts).toEqual(['seed']); // the pending tx is invisible until it commits
    reader.close();
    writer.exec('COMMIT');
    writer.close();
  });
});
