import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Outcome } from '@kernloop/contracts';
import { createMemory } from './index.js';

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
