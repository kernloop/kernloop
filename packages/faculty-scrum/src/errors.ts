/**
 * Typed errors thrown at the scrum faculty's boundaries. Callers discriminate
 * on `name` or `instanceof` — never on message text. Mirrors the shapes of
 * faculty-workforce's decomposition errors (spec §5.4).
 */
import type { TaskContract } from '@kernloop/contracts';

/** The three independently-summed budget dimensions of a TaskContract. */
export type BudgetDimension = keyof TaskContract['budget'];

/**
 * Thrown when the sum of child (story) budgets exceeds the parent budget on
 * any dimension (spec §5.4: child TaskContract budgets "must sum within the
 * parent's"; CLM-0096). Carries the offending dimension and both amounts so a
 * caller can report — or replan — without parsing text.
 */
export class ScrumBudgetExceededError extends Error {
  readonly dimension: BudgetDimension;
  readonly parentAmount: number;
  readonly childSum: number;

  constructor(dimension: BudgetDimension, parentAmount: number, childSum: number) {
    super(
      `child budgets exceed parent on ${dimension}: ` +
        `sum ${childSum} > parent ${parentAmount} (spec §5.4)`,
    );
    this.name = 'ScrumBudgetExceededError';
    this.dimension = dimension;
    this.parentAmount = parentAmount;
    this.childSum = childSum;
  }
}

/**
 * Thrown when the parent contract handed to decomposeGoal fails
 * TaskContractSchema validation (charter: zod-validate at every contract
 * boundary).
 */
export class InvalidParentError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'InvalidParentError';
  }
}

/**
 * Thrown when a story spec is malformed for a reason other than the budget-sum
 * invariant: schema violation, zero/negative budget dimension, an `assignTo`
 * naming no shipped template, or an `altitude` outside the enum.
 */
export class InvalidStorySpecError extends Error {
  /** Zero-based index of the offending story in the input array. */
  readonly index: number;

  constructor(index: number, detail: string) {
    super(`story[${index}]: ${detail}`);
    this.name = 'InvalidStorySpecError';
    this.index = index;
  }
}
