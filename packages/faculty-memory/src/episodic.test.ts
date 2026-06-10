import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Outcome } from '@kernloop/contracts';
import { createMemory, InvalidOutcomeError, type Memory } from './index.js';

const T0 = Date.UTC(2026, 0, 1);

function outcome(overrides: Partial<Outcome> = {}): Outcome {
  return {
    taskId: 'task-1',
    status: 'success',
    signals: [{ name: 'tests', passed: true, detail: '212/212 tests' }],
    cost: { tokens: 1200, usd: 0.04 },
    traceRef: 'trace:task-1',
    distillCandidates: ['trace:task-1'],
    ...overrides,
  };
}

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

describe('recordOutcome / getTraceSummary (CLM-0024)', () => {
  it('persists an outcome as summary plus traceRef pointer, retrievable by task id', () => {
    memory.recordOutcome(outcome(), 'wired the audit chain; all gates green');
    const summary = memory.getTraceSummary('task-1');
    expect(summary).toEqual({
      taskId: 'task-1',
      summary: 'wired the audit chain; all gates green',
      traceRef: 'trace:task-1',
      status: 'success',
      distillCandidates: ['trace:task-1'],
      createdAt: T0,
    });
  });

  it('rejects an invalid outcome at the boundary', () => {
    const malformed = { ...outcome(), status: 'victory' } as unknown as Outcome;
    expect(() => memory.recordOutcome(malformed, 'nope')).toThrowError(InvalidOutcomeError);
    expect(memory.getTraceSummary('task-1')).toBeUndefined();
  });

  it('rejects an outcome missing its traceRef', () => {
    const missingTraceRef: Record<string, unknown> = { ...outcome() };
    delete missingTraceRef['traceRef'];
    expect(() => memory.recordOutcome(missingTraceRef as unknown as Outcome, 'nope')).toThrowError(
      InvalidOutcomeError,
    );
  });

  it('returns undefined for an unknown task id', () => {
    expect(memory.getTraceSummary('no-such-task')).toBeUndefined();
  });

  it('re-recording a task outcome replaces its summary instead of duplicating', () => {
    memory.recordOutcome(outcome(), 'first attempt');
    nowMs = T0 + 1000;
    memory.recordOutcome(outcome({ status: 'partial' }), 'second attempt');
    expect(memory.listSummaries()).toHaveLength(1);
    expect(memory.getTraceSummary('task-1')).toMatchObject({
      summary: 'second attempt',
      status: 'partial',
      createdAt: T0 + 1000,
    });
  });
});

describe('listSummaries (CLM-0024)', () => {
  it('lists summaries newest-first', () => {
    memory.recordOutcome(outcome({ taskId: 'task-a', traceRef: 'trace:a' }), 'oldest');
    nowMs = T0 + 1000;
    memory.recordOutcome(outcome({ taskId: 'task-b', traceRef: 'trace:b' }), 'middle');
    nowMs = T0 + 2000;
    memory.recordOutcome(outcome({ taskId: 'task-c', traceRef: 'trace:c' }), 'newest');
    expect(memory.listSummaries().map((s) => s.summary)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('honors the list limit option', () => {
    for (let i = 0; i < 4; i += 1) {
      nowMs = T0 + i;
      memory.recordOutcome(outcome({ taskId: `task-${i}`, traceRef: `trace:${i}` }), `s${i}`);
    }
    const listed = memory.listSummaries({ limit: 2 });
    expect(listed.map((s) => s.taskId)).toEqual(['task-3', 'task-2']);
  });

  it('stores SQL-injection-shaped summaries safely via parameterized statements', () => {
    const hostile = "'; DROP TABLE traces; --";
    memory.recordOutcome(outcome({ taskId: hostile, traceRef: hostile }), hostile);
    expect(memory.getTraceSummary(hostile)).toMatchObject({
      taskId: hostile,
      summary: hostile,
      traceRef: hostile,
    });
    expect(memory.listSummaries()).toHaveLength(1);
  });
});
