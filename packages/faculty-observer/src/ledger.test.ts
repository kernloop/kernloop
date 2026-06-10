import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Outcome, OutcomeStatus } from '@kernloop/contracts';
import { createObserver, InvalidOutcomeError, type Observer } from './index.js';

const tmpDirs: string[] = [];
function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-observer-'));
  tmpDirs.push(dir);
  return path.join(dir, 'overlay.sqlite');
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeOutcome(overrides: Partial<Outcome> = {}): Outcome {
  return {
    taskId: 'task-1',
    status: 'success',
    signals: [],
    cost: { tokens: 100, usd: 0.5, wallClockMs: 1000 },
    traceRef: 'trace://task-1',
    distillCandidates: [],
    ...overrides,
  };
}

/** Observer with a deterministic ms clock advancing by 1 per call. */
function observerWithTicker(): { observer: Observer; tick: () => number } {
  let now = 1000;
  const observer = createObserver(tmpDb(), { clock: () => ++now });
  return { observer, tick: () => now };
}

function feed(observer: Observer, subject: string, statuses: OutcomeStatus[]): void {
  for (const [i, status] of statuses.entries()) {
    observer.ingestOutcome(makeOutcome({ taskId: `task-${String(i)}`, status }), { subject });
  }
}

describe('fitness ledger (CLM-0055)', () => {
  it('accumulates invocations, successes, cost, and lastUsedAt per subject', () => {
    const { observer } = observerWithTicker();
    observer.ingestOutcome(makeOutcome(), { subject: 'tool-a' });
    observer.ingestOutcome(
      makeOutcome({ taskId: 'task-2', status: 'failure', cost: { tokens: 50, usd: 0.25 } }),
      { subject: 'tool-a' },
    );
    const record = observer.fitness('tool-a');
    expect(record).toMatchObject({
      subject: 'tool-a',
      invocations: 2,
      successRate: 0.5,
      cost: { tokens: 150, usd: 0.75, wallClockMs: 1000 },
      lastUsedAt: 1002,
    });
    observer.close();
  });

  it('tracks subjects independently and lists the ledger most recently used first', () => {
    const { observer } = observerWithTicker();
    observer.ingestOutcome(makeOutcome(), { subject: 'tool-a' });
    observer.ingestOutcome(makeOutcome({ status: 'partial' }), { subject: 'tool-b' });
    const ledger = observer.fitnessLedger();
    expect(ledger.map((r) => r.subject)).toEqual(['tool-b', 'tool-a']);
    expect(observer.fitness('tool-b')?.successRate).toBe(0);
    expect(observer.fitness('never-seen')).toBeUndefined();
    observer.close();
  });

  it('rejects an invalid outcome and an empty subject at the boundary', () => {
    const { observer } = observerWithTicker();
    const bad = { ...makeOutcome(), status: 'great' } as unknown as Outcome;
    expect(() => observer.ingestOutcome(bad, { subject: 'tool-a' })).toThrow(InvalidOutcomeError);
    expect(() => observer.ingestOutcome(makeOutcome(), { subject: '  ' })).toThrow(
      InvalidOutcomeError,
    );
    expect(observer.fitnessLedger()).toEqual([]);
    observer.close();
  });

  it('treats a SQL-injection-shaped subject as ordinary data', () => {
    const { observer } = observerWithTicker();
    const hostile = "x'; DROP TABLE observer_fitness;--";
    observer.ingestOutcome(makeOutcome(), { subject: hostile });
    expect(observer.fitness(hostile)?.invocations).toBe(1);
    // The table survived and stays writable.
    observer.ingestOutcome(makeOutcome({ taskId: 'task-2' }), { subject: 'tool-a' });
    expect(observer.fitnessLedger()).toHaveLength(2);
    observer.close();
  });
});

describe('drift signals (CLM-0055)', () => {
  it('flags subjects whose recent window drops below lifetime success rate', () => {
    const { observer } = observerWithTicker();
    // Lifetime 0.5, last-10 window 0.0 → drop 0.5 ≥ default 0.2.
    feed(observer, 'drifting', [
      ...Array<OutcomeStatus>(10).fill('success'),
      ...Array<OutcomeStatus>(10).fill('failure'),
    ]);
    // Uniformly healthy → no drop.
    feed(observer, 'steady', Array<OutcomeStatus>(20).fill('success'));
    const signals = observer.driftSignals();
    expect(signals).toEqual([
      {
        subject: 'drifting',
        windowRate: 0,
        lifetimeRate: 0.5,
        drop: 0.5,
        windowN: 10,
      },
    ]);
    observer.close();
  });

  it('never assesses a subject with fewer outcomes than the window', () => {
    const { observer } = observerWithTicker();
    feed(observer, 'young', Array<OutcomeStatus>(5).fill('failure'));
    expect(observer.driftSignals()).toEqual([]);
    observer.close();
  });

  it('honors injected windowN and minDrop', () => {
    const { observer } = observerWithTicker();
    // Lifetime 0.5 over 8; last-4 window 0.0 → drop 0.5.
    feed(observer, 'tool-a', [
      'success',
      'success',
      'success',
      'success',
      'failure',
      'failure',
      'failure',
      'failure',
    ]);
    expect(observer.driftSignals({ windowN: 4 })).toHaveLength(1);
    // A stricter threshold than the actual drop stays quiet.
    expect(observer.driftSignals({ windowN: 4, minDrop: 0.6 })).toEqual([]);
    // A window the subject cannot fill stays quiet.
    expect(observer.driftSignals({ windowN: 9 })).toEqual([]);
    observer.close();
  });
});
