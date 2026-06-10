import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Verdict } from '@kernloop/contracts';
import { createObserver, InvalidVerdictError, type Observer } from './index.js';

const tmpDirs: string[] = [];
function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-observer-'));
  tmpDirs.push(dir);
  return path.join(dir, 'overlay.sqlite');
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    taskId: 'task-1',
    gate: 'review',
    result: 'approve',
    confidence: 0.9,
    findings: [],
    voters: [
      { voter: 'claude', vote: 'approve', reasoning: 'looks correct' },
      { voter: 'codex', vote: 'reject', reasoning: 'missing test' },
    ],
    cost: { tokens: 100, usd: 0.1, wallClockMs: 500 },
    ...overrides,
  };
}

function observerWithTicker(): Observer {
  let now = 1000;
  return createObserver(tmpDb(), { clock: () => ++now });
}

describe('per-voter series (CLM-0055)', () => {
  it('appends one series row per voter record and computes sliding-window precision over labeled votes', () => {
    const observer = observerWithTicker();
    expect(observer.ingestVerdict(makeVerdict())).toBe(2);
    expect(observer.ingestVerdict(makeVerdict({ taskId: 'task-2', result: 'reject' }))).toBe(2);

    const series = observer.voterSeries('claude');
    expect(series).toEqual([
      { voter: 'claude', gate: 'review', vote: 'approve', taskId: 'task-1', at: 1001 },
      { voter: 'claude', gate: 'review', vote: 'approve', taskId: 'task-2', at: 1002 },
    ]);

    // Ground truth arrives later; precision windows over the labels.
    observer.recordVoterOutcome('claude', 'task-1', true);
    observer.recordVoterOutcome('claude', 'task-2', true);
    observer.recordVoterOutcome('claude', 'task-3', false);
    observer.recordVoterOutcome('claude', 'task-4', true);
    expect(observer.runningPrecision('claude')).toEqual({
      voter: 'claude',
      precision: 0.75,
      labeled: 4,
      windowN: 20,
    });
    // Window of 2 sees only the newest two labels: [true, false].
    expect(observer.runningPrecision('claude', { windowN: 2 })).toMatchObject({
      precision: 0.5,
      labeled: 2,
      windowN: 2,
    });
    observer.close();
  });

  it('reports undefined precision for an unlabeled voter — never a stubbed value', () => {
    const observer = observerWithTicker();
    observer.ingestVerdict(makeVerdict());
    expect(observer.runningPrecision('codex')).toEqual({
      voter: 'codex',
      precision: undefined,
      labeled: 0,
      windowN: 20,
    });
    observer.close();
  });

  it('accepts a verdict without voters and rejects invalid input at the boundary', () => {
    const observer = observerWithTicker();
    const noVoters = makeVerdict();
    delete (noVoters as { voters?: unknown }).voters;
    expect(observer.ingestVerdict(noVoters)).toBe(0);

    const bad = { ...makeVerdict(), confidence: 2 } as unknown as Verdict;
    expect(() => observer.ingestVerdict(bad)).toThrow(InvalidVerdictError);
    expect(() => observer.recordVoterOutcome('', 'task-1', true)).toThrow(InvalidVerdictError);
    observer.close();
  });

  it('treats SQL-injection-shaped voter and gate names as ordinary data', () => {
    const observer = observerWithTicker();
    const hostile = "v'; DROP TABLE observer_voter_series;--";
    observer.ingestVerdict(
      makeVerdict({
        gate: "g'; DELETE FROM observer_verdict_log;--",
        voters: [{ voter: hostile, vote: 'approve', reasoning: 'r' }],
      }),
    );
    expect(observer.voterSeries(hostile)).toHaveLength(1);
    observer.recordVoterOutcome(hostile, "t'; --", true);
    expect(observer.runningPrecision(hostile).precision).toBe(1);
    observer.close();
  });
});

describe('cost per governed decision (spec §8 item 7)', () => {
  it('reports mean verdict cost per governed decision for a gate', () => {
    const observer = observerWithTicker();
    observer.ingestVerdict(makeVerdict({ cost: { tokens: 100, usd: 0.1, wallClockMs: 500 } }));
    observer.ingestVerdict(
      makeVerdict({ taskId: 'task-2', cost: { tokens: 200, usd: 0.3, wallClockMs: 1500 } }),
    );
    observer.ingestVerdict(
      makeVerdict({ taskId: 'task-3', gate: 'quality', cost: { tokens: 10, usd: 0 } }),
    );
    expect(observer.costPerGovernedDecision('review')).toEqual({
      gate: 'review',
      decisions: 2,
      meanTokens: 150,
      meanUsd: 0.2,
      meanWallClockMs: 1000,
    });
    // A cost without wallClockMs accumulates honestly as 0.
    expect(observer.costPerGovernedDecision('quality')?.meanWallClockMs).toBe(0);
    observer.close();
  });

  it('returns undefined for a gate that has decided nothing', () => {
    const observer = observerWithTicker();
    expect(observer.costPerGovernedDecision('review')).toBeUndefined();
    observer.close();
  });
});
