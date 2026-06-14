/**
 * Cross-faculty decomposition-consistency guard (#81).
 *
 * faculty-scrum's `decomposeGoal` deliberately MIRRORS the mechanical core of
 * faculty-workforce's `decomposePlan` — the per-dimension budget-sum invariant
 * and the shipped-assignee list — because a faculty→faculty import is forbidden
 * (constitutional rule 5), so the duplication cannot be deduped by import. The
 * ratified #81 review chose to keep the mirror (not factor a helper into the
 * already-full FROZEN-FIVE contracts) UNTIL a third decomposer or a divergence
 * appears. This test makes any such divergence LOUD instead of silent: it lives
 * in the CLI package — the composition root, NOT a faculty — which legally
 * imports both. If the two budget invariants or the two assignee lists drift,
 * THIS fails, which is the agreed trigger to extract a shared lib.
 */
import { describe, expect, it } from 'vitest';
import { TaskContractSchema, type TaskContract } from '@kernloop/contracts';
import {
  decomposeGoal,
  ScrumBudgetExceededError,
  StorySpecSchema,
  type StorySpec,
} from '@kernloop/faculty-scrum';
import {
  decomposePlan,
  BudgetExceededError,
  SHIPPED_TEMPLATE_NAMES,
  type SubtaskSpec,
} from '@kernloop/faculty-workforce';

/** A program-root parent with NO altitude tag, so scrum's altitude-descent check
 * is skipped and the budget invariant is exercised in isolation. */
function parent(overrides: Partial<TaskContract> = {}): TaskContract {
  return TaskContractSchema.parse({
    id: 'task-1',
    goal: 'Ship the thing',
    constraints: [],
    budget: { tokens: 10_000, usd: 2, wallClockMin: 60 },
    evidence: [],
    definitionOfDone: [],
    authorityCeiling: 'enforce',
    overlay: 'overlay-test',
    ...overrides,
  });
}

/** A story (scrum) and a subtask (workforce) carrying the SAME budget, so the two
 * decomposers receive equivalent per-dimension sums. */
function story(budget: StorySpec['budget']): StorySpec {
  return { goal: 'a child', budget, assignTo: 'coder', altitude: 'epic' };
}
function subtask(budget: SubtaskSpec['budget']): SubtaskSpec {
  return { goal: 'a child', budget, assignTo: 'coder' };
}

describe('decomposition mirror consistency (#81 divergence guard)', () => {
  it('both faculties accept the SAME shipped-assignee set', () => {
    // scrum mirrors workforce's SHIPPED_TEMPLATE_NAMES; if workforce adds a
    // template and scrum is not updated, scrum silently rejects it — caught here.
    const scrumAssignees = [...StorySpecSchema.shape.assignTo.options].sort();
    const workforceTemplates = [...SHIPPED_TEMPLATE_NAMES].sort();
    expect(scrumAssignees).toEqual(workforceTemplates);
  });

  it('both enforce sum(child) <= parent per dimension, with an exact sum allowed', () => {
    // tokens 5_000 + 5_000 == 10_000 (exact), usd 1+1==2, wallClock 30+30==60.
    const b = { tokens: 5_000, usd: 1, wallClockMin: 30 };
    expect(decomposeGoal({ parent: parent(), subtasks: [story(b), story(b)] })).toHaveLength(2);
    expect(decomposePlan({ parent: parent(), subtasks: [subtask(b), subtask(b)] })).toHaveLength(2);
  });

  it('both throw their budget-exceeded error when the TOKEN sum breaches the parent', () => {
    const b = { tokens: 6_000, usd: 0.5, wallClockMin: 10 }; // 6k+6k = 12k > 10k
    expect(() => decomposeGoal({ parent: parent(), subtasks: [story(b), story(b)] })).toThrow(
      ScrumBudgetExceededError,
    );
    expect(() => decomposePlan({ parent: parent(), subtasks: [subtask(b), subtask(b)] })).toThrow(
      BudgetExceededError,
    );
  });

  it('both check EACH dimension independently (usd breaches while tokens fit)', () => {
    // tokens 1_000+1_000 = 2_000 (fits 10k), but usd 1.5+1.5 = 3 > 2 → both breach on usd.
    const b = { tokens: 1_000, usd: 1.5, wallClockMin: 10 };
    expect(() => decomposeGoal({ parent: parent(), subtasks: [story(b), story(b)] })).toThrow(
      ScrumBudgetExceededError,
    );
    expect(() => decomposePlan({ parent: parent(), subtasks: [subtask(b), subtask(b)] })).toThrow(
      BudgetExceededError,
    );
  });
});
