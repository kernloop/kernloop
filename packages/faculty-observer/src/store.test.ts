import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { Outcome, Verdict } from '@kernloop/contracts';
import { createObserver } from './index.js';

const DAY_MS = 24 * 60 * 60 * 1000;
function makeVerdict(): Verdict {
  return {
    taskId: 't',
    gate: 'review',
    result: 'approve',
    confidence: 0.9,
    findings: [],
    voters: [{ voter: 'v', vote: 'approve', reasoning: 'ok' }],
    cost: { tokens: 1, usd: 0.1, wallClockMs: 5 },
  };
}

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-observer-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeOutcome(): Outcome {
  return {
    taskId: 'task-1',
    status: 'success',
    signals: [],
    cost: { tokens: 10, usd: 0.1 },
    traceRef: 'trace://task-1',
    distillCandidates: [],
  };
}

/** The memory faculty's table shape, created the way that faculty would. */
const MEMORY_STYLE_DDL = `
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact TEXT NOT NULL UNIQUE,
  provenance TEXT NOT NULL,
  confidence REAL,
  createdAt INTEGER NOT NULL,
  refreshedAt INTEGER NOT NULL
);
`;

describe('observer storage (spec §3.3 — one DB per overlay)', () => {
  it('coexists with another faculty’s tables in the same overlay database file', () => {
    const dbPath = path.join(tmpDir(), 'overlay.sqlite');
    // Another faculty (memory-style) already owns tables in the overlay DB.
    const memoryConn = new Database(dbPath);
    memoryConn.exec(MEMORY_STYLE_DDL);
    memoryConn
      .prepare('INSERT INTO facts (fact, provenance, createdAt, refreshedAt) VALUES (?, ?, ?, ?)')
      .run('node is 22', 'doc:spec', 1, 1);

    // Observer opens the SAME file; table-namespace separation is the boundary.
    const observer = createObserver(dbPath, { clock: () => 1000 });
    observer.ingestOutcome(makeOutcome(), { subject: 'tool-a' });
    expect(observer.fitness('tool-a')?.invocations).toBe(1);

    // The other faculty's data is untouched and still readable on its own connection.
    const fact = memoryConn.prepare('SELECT fact FROM facts').get() as { fact: string };
    expect(fact.fact).toBe('node is 22');

    // The observer created only observer_* tables alongside.
    const tables = memoryConn
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('facts');
    expect(names).toContain('observer_fitness_identity'); // the additive identity series (#66)
    expect(names).toContain('observer_fitness_identity_outcome'); // its deliverable-pass twin (#229/#5)
    expect(names.filter((n) => n.startsWith('observer_'))).toHaveLength(8);
    observer.close();
    memoryConn.close();
  });

  it('deleting the database file and reopening yields a functional empty ledger', () => {
    const dbPath = path.join(tmpDir(), 'overlay.sqlite');
    const first = createObserver(dbPath, { clock: () => 1000 });
    first.ingestOutcome(makeOutcome(), { subject: 'tool-a' });
    first.close();
    fs.rmSync(dbPath);

    const second = createObserver(dbPath, { clock: () => 2000 });
    expect(second.fitnessLedger()).toEqual([]);
    second.ingestOutcome(makeOutcome(), { subject: 'tool-b' });
    expect(second.fitness('tool-b')?.invocations).toBe(1);
    second.close();
  });

  it('reopening an existing database preserves ledger, series, and issues', () => {
    const dbPath = path.join(tmpDir(), 'overlay.sqlite');
    const first = createObserver(dbPath, { clock: () => 1000 });
    first.ingestOutcome(makeOutcome(), { subject: 'tool-a' });
    first.proposeIssue({
      title: 't',
      body: 'b',
      taskShaped: { goal: 'g' },
    });
    first.close();

    const second = createObserver(dbPath, { clock: () => 2000 });
    expect(second.fitness('tool-a')?.invocations).toBe(1);
    expect(second.listIssues()).toHaveLength(1);
    second.close();
  });
});

describe('append-only log retention (#159)', () => {
  it('on open, prunes log rows older than the window relative to the newest row, keeping the keyed ledger', () => {
    const dbPath = path.join(tmpDir(), 'o.sqlite');
    let at = 1_000_000;
    // One session, two verdicts: an OLD one then one 100 days later (the newest).
    const s = createObserver(dbPath, { clock: () => at, retentionMs: 10 * DAY_MS });
    s.ingestOutcome(makeOutcome(), { subject: 'tool-a' }); // fitness (kept) + outcome_log (old)
    s.ingestVerdict(makeVerdict()); // verdict_log at OLD
    at = 1_000_000 + 100 * DAY_MS;
    s.ingestVerdict(makeVerdict()); // verdict_log at NEW (the newest row)
    s.close();
    // Reopen → prune: newest = NEW, cutoff = NEW − 10 days → the OLD rows go, NEW stays.
    const fresh = createObserver(dbPath, { retentionMs: 10 * DAY_MS });
    expect(fresh.costPerGovernedDecision('review')?.decisions).toBe(1); // the old verdict pruned
    expect(fresh.driftSignals()).toEqual([]); // the lone old outcome_log row pruned
    // The KEYED fitness ledger is NOT a log → it survives.
    expect(fresh.fitnessLedger().some((r) => r.subject === 'tool-a')).toBe(true);
    fresh.close();
  });

  it('keeps every log row when all are inside the retention window', () => {
    const dbPath = path.join(tmpDir(), 'o2.sqlite');
    let at = 5_000_000;
    const s = createObserver(dbPath, { clock: () => at, retentionMs: 10 * DAY_MS });
    s.ingestVerdict(makeVerdict());
    at = 5_000_000 + DAY_MS; // 1 day later — within the window
    s.ingestVerdict(makeVerdict());
    s.close();
    const fresh = createObserver(dbPath, { retentionMs: 10 * DAY_MS });
    expect(fresh.costPerGovernedDecision('review')?.decisions).toBe(2); // both kept
    fresh.close();
  });
});
