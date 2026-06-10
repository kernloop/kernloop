import { describe, expect, it } from 'vitest';
import { TaskContractSchema, type TaskContract } from '@kernloop/contracts';
import { decomposePlan, type SubtaskSpec } from './decompose.js';
import { BudgetExceededError, InvalidParentError, InvalidSubtaskError } from './errors.js';

function parent(overrides: Partial<TaskContract> = {}): TaskContract {
  return TaskContractSchema.parse({
    id: 'task-7',
    goal: 'Ship the feature',
    constraints: ['no new runtime deps'],
    budget: { tokens: 10_000, usd: 2, wallClockMin: 60 },
    evidence: [],
    definitionOfDone: [],
    authorityCeiling: 'enforce',
    overlay: 'overlay-test',
    ...overrides,
  });
}

function subtask(overrides: Partial<SubtaskSpec> = {}): SubtaskSpec {
  return {
    goal: 'Implement the change',
    budget: { tokens: 4_000, usd: 0.5, wallClockMin: 20 },
    assignTo: 'coder',
    ...overrides,
  };
}

describe('decomposePlan', () => {
  it('derives id, parent, and overlay for each child from the parent', () => {
    const children = decomposePlan({
      parent: parent(),
      subtasks: [subtask(), subtask({ goal: 'Document the change', assignTo: 'documenter' })],
    });
    expect(children.map((c) => c.id)).toEqual(['task-7.1', 'task-7.2']);
    expect(children.every((c) => c.parent === 'task-7')).toBe(true);
    expect(children.every((c) => c.overlay === 'overlay-test')).toBe(true);
  });

  it('emits zod-valid TaskContracts carrying inherited constraints and the assignment', () => {
    const children = decomposePlan({
      parent: parent(),
      subtasks: [subtask({ constraints: ['touch only src/'] })],
    });
    const child = children[0];
    expect(child).toBeDefined();
    expect(TaskContractSchema.safeParse(child).success).toBe(true);
    expect(child?.constraints).toEqual([
      'no new runtime deps',
      'touch only src/',
      'assign:agent.coder',
    ]);
    expect(child?.evidence).toEqual([]);
    expect(child?.definitionOfDone).toEqual([]);
  });

  it('clamps the child authority ceiling at suggest under an enforce parent', () => {
    const children = decomposePlan({ parent: parent(), subtasks: [subtask()] });
    expect(children[0]?.authorityCeiling).toBe('suggest');
  });

  it('a child never exceeds the parent ceiling when the parent is below suggest', () => {
    const children = decomposePlan({
      parent: parent({ authorityCeiling: 'observe' }),
      subtasks: [subtask()],
    });
    expect(children[0]?.authorityCeiling).toBe('observe');
  });

  it('child budgets summing exactly to the parent budget pass on every dimension', () => {
    const children = decomposePlan({
      parent: parent(),
      subtasks: [
        subtask({ budget: { tokens: 6_000, usd: 1.5, wallClockMin: 45 } }),
        subtask({ budget: { tokens: 4_000, usd: 0.5, wallClockMin: 15 } }),
      ],
    });
    expect(children).toHaveLength(2);
    const sum = (dim: 'tokens' | 'usd' | 'wallClockMin'): number =>
      children.reduce((acc, c) => acc + c.budget[dim], 0);
    expect(sum('tokens')).toBe(10_000);
    expect(sum('usd')).toBe(2);
    expect(sum('wallClockMin')).toBe(60);
  });

  it('a token-sum violation throws BudgetExceededError naming the dimension and amounts', () => {
    const run = (): TaskContract[] =>
      decomposePlan({
        parent: parent(),
        subtasks: [
          subtask({ budget: { tokens: 6_000, usd: 0.5, wallClockMin: 10 } }),
          subtask({ budget: { tokens: 4_001, usd: 0.5, wallClockMin: 10 } }),
        ],
      });
    expect(run).toThrow(BudgetExceededError);
    try {
      run();
      expect.unreachable('decomposePlan must throw');
    } catch (error) {
      const e = error as BudgetExceededError;
      expect(e.name).toBe('BudgetExceededError');
      expect(e.dimension).toBe('tokens');
      expect(e.parentBudget).toBe(10_000);
      expect(e.childSum).toBe(10_001);
    }
  });

  it('a usd-sum violation throws BudgetExceededError for the usd dimension', () => {
    expect(() =>
      decomposePlan({
        parent: parent(),
        subtasks: [
          subtask({ budget: { tokens: 1_000, usd: 1.5, wallClockMin: 10 } }),
          subtask({ budget: { tokens: 1_000, usd: 0.75, wallClockMin: 10 } }),
        ],
      }),
    ).toThrow(
      expect.objectContaining({ name: 'BudgetExceededError', dimension: 'usd', childSum: 2.25 }),
    );
  });

  it('a wall-clock-sum violation throws BudgetExceededError for the wallClockMin dimension', () => {
    expect(() =>
      decomposePlan({
        parent: parent(),
        subtasks: [
          subtask({ budget: { tokens: 1_000, usd: 0.1, wallClockMin: 40 } }),
          subtask({ budget: { tokens: 1_000, usd: 0.1, wallClockMin: 21 } }),
        ],
      }),
    ).toThrow(
      expect.objectContaining({ dimension: 'wallClockMin', parentBudget: 60, childSum: 61 }),
    );
  });

  it('rejects zero and negative child budget slices as invalid subtasks', () => {
    for (const budget of [
      { tokens: 0, usd: 0.5, wallClockMin: 10 },
      { tokens: 1_000, usd: 0, wallClockMin: 10 },
      { tokens: 1_000, usd: 0.5, wallClockMin: -1 },
    ]) {
      expect(() => decomposePlan({ parent: parent(), subtasks: [subtask({ budget })] })).toThrow(
        InvalidSubtaskError,
      );
    }
  });

  it('rejects malformed subtasks with a typed error carrying the index', () => {
    const bad = [subtask(), { ...subtask(), goal: '' }] as SubtaskSpec[];
    try {
      decomposePlan({ parent: parent(), subtasks: bad });
      expect.unreachable('decomposePlan must throw');
    } catch (error) {
      const e = error as InvalidSubtaskError;
      expect(e.name).toBe('InvalidSubtaskError');
      expect(e.index).toBe(1);
    }
  });

  it('rejects an assignTo naming no shipped template', () => {
    const bad = subtask({ assignTo: 'wizard' as SubtaskSpec['assignTo'] });
    expect(() => decomposePlan({ parent: parent(), subtasks: [bad] })).toThrow(InvalidSubtaskError);
  });

  it('rejects an invalid parent contract with InvalidParentError', () => {
    const bad = { ...parent(), goal: '' } as TaskContract;
    expect(() => decomposePlan({ parent: bad, subtasks: [subtask()] })).toThrow(InvalidParentError);
  });

  it('an empty subtask list decomposes to an empty child list', () => {
    expect(decomposePlan({ parent: parent(), subtasks: [] })).toEqual([]);
  });
});
