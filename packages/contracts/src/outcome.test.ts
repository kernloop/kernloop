import { describe, expect, it } from 'vitest';
import { OutcomeSchema, OutcomeStatusSchema, type Outcome } from './outcome.js';

const valid: Outcome = {
  taskId: 'task-001',
  status: 'success',
  signals: [
    { name: 'tests', passed: true, detail: '74/74' },
    { name: 'gate:quality', passed: true },
  ],
  cost: {
    tokens: 52_000,
    usd: 1.4,
    wallClockMs: 480_000,
    byAdapter: { claude: { tokens: 52_000, usd: 1.4 } },
  },
  traceRef: 'trace:2026-06-09/task-001',
  distillCandidates: ['trace:2026-06-09/task-001'],
};

describe('OutcomeStatusSchema', () => {
  it('accepts all four status values', () => {
    for (const status of ['success', 'partial', 'failure', 'cancelled']) {
      expect(OutcomeStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects unknown status values', () => {
    for (const bad of ['done', 'SUCCESS', 'canceled', '', null]) {
      expect(OutcomeStatusSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('OutcomeSchema', () => {
  it('parses a valid Outcome', () => {
    expect(OutcomeSchema.parse(valid)).toEqual(valid);
  });

  it('parses with empty signals and distillCandidates', () => {
    const minimal = { ...valid, signals: [], distillCandidates: [] };
    expect(OutcomeSchema.parse(minimal)).toEqual(minimal);
  });

  it('round-trips through JSON serialization', () => {
    expect(OutcomeSchema.parse(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it('rejects when a required field is missing', () => {
    for (const field of ['taskId', 'status', 'signals', 'cost', 'traceRef', 'distillCandidates']) {
      const broken: Record<string, unknown> = { ...valid };
      delete broken[field];
      expect(OutcomeSchema.safeParse(broken).success).toBe(false);
    }
  });

  it('rejects an unknown status enum value', () => {
    expect(OutcomeSchema.safeParse({ ...valid, status: 'mostly-done' }).success).toBe(false);
  });

  it('rejects wrong types: empty traceRef, non-array candidates, bad signals', () => {
    expect(OutcomeSchema.safeParse({ ...valid, traceRef: '' }).success).toBe(false);
    expect(OutcomeSchema.safeParse({ ...valid, distillCandidates: 'trace:1' }).success).toBe(false);
    const badSignals = [{ name: 'tests', passed: 'true' }];
    expect(OutcomeSchema.safeParse({ ...valid, signals: badSignals }).success).toBe(false);
  });

  it('rejects negative cost and unknown keys', () => {
    expect(OutcomeSchema.safeParse({ ...valid, cost: { tokens: 1, usd: -1 } }).success).toBe(false);
    expect(OutcomeSchema.safeParse({ ...valid, score: 10 }).success).toBe(false);
  });
});
