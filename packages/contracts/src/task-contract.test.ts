import { describe, expect, it } from 'vitest';
import { TaskContractSchema, type TaskContract } from './task-contract.js';

const valid: TaskContract = {
  id: 'task-001',
  parent: 'task-000',
  goal: 'Build the contracts package',
  constraints: ['no new runtime deps beyond zod'],
  budget: { tokens: 100_000, usd: 5, wallClockMin: 30 },
  evidence: [{ kind: 'test', ref: 'packages/contracts/src/task-contract.test.ts::round-trip' }],
  definitionOfDone: [{ name: 'tests', command: 'pnpm test' }],
  authorityCeiling: 'suggest',
  overlay: 'kernloop',
};

describe('TaskContractSchema', () => {
  it('parses a valid TaskContract', () => {
    expect(TaskContractSchema.parse(valid)).toEqual(valid);
  });

  it('parses without the optional parent field', () => {
    const orphan: Record<string, unknown> = { ...valid };
    delete orphan['parent'];
    expect(TaskContractSchema.parse(orphan)).toEqual(orphan);
  });

  it('round-trips through JSON serialization', () => {
    const parsed = TaskContractSchema.parse(JSON.parse(JSON.stringify(valid)));
    expect(parsed).toEqual(valid);
  });

  it('rejects when a required field is missing', () => {
    for (const field of [
      'id',
      'goal',
      'constraints',
      'budget',
      'evidence',
      'definitionOfDone',
      'authorityCeiling',
      'overlay',
    ]) {
      const broken: Record<string, unknown> = { ...valid };
      delete broken[field];
      expect(TaskContractSchema.safeParse(broken).success).toBe(false);
    }
  });

  it('rejects an unknown authorityCeiling tier', () => {
    expect(TaskContractSchema.safeParse({ ...valid, authorityCeiling: 'root' }).success).toBe(
      false,
    );
  });

  it('rejects wrong field types', () => {
    expect(TaskContractSchema.safeParse({ ...valid, goal: 42 }).success).toBe(false);
    expect(TaskContractSchema.safeParse({ ...valid, constraints: 'be careful' }).success).toBe(
      false,
    );
  });

  it('rejects negative or malformed budgets', () => {
    const bad = [
      { tokens: -1, usd: 5, wallClockMin: 30 },
      { tokens: 100, usd: -0.5, wallClockMin: 30 },
      { tokens: 100, usd: 5, wallClockMin: -1 },
      { tokens: 100.5, usd: 5, wallClockMin: 30 },
      { tokens: 100, usd: 5 },
    ];
    for (const budget of bad) {
      expect(TaskContractSchema.safeParse({ ...valid, budget }).success).toBe(false);
    }
  });

  it('rejects unknown top-level keys (the contract is frozen)', () => {
    expect(TaskContractSchema.safeParse({ ...valid, priority: 'high' }).success).toBe(false);
  });
});
