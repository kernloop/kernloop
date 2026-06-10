/**
 * Typed errors thrown at the workforce faculty's boundaries. Callers
 * discriminate on `name` or `instanceof` — never on message text.
 */
import type { TaskContract } from '@kernloop/contracts';

/** The three independently-summed budget dimensions of a TaskContract. */
export type BudgetDimension = keyof TaskContract['budget'];

/**
 * Thrown when the sum of child budgets exceeds the parent budget on any
 * dimension (spec §5.4: child TaskContract budgets "must sum within the
 * parent's"; CLM-0041). Carries the offending dimension and both amounts so
 * the caller can report — or a PM can replan — without parsing text.
 */
export class BudgetExceededError extends Error {
  readonly dimension: BudgetDimension;
  readonly parentBudget: number;
  readonly childSum: number;

  constructor(dimension: BudgetDimension, parentBudget: number, childSum: number) {
    super(
      `child budgets exceed parent on ${dimension}: ` +
        `sum ${childSum} > parent ${parentBudget} (spec §5.4)`,
    );
    this.name = 'BudgetExceededError';
    this.dimension = dimension;
    this.parentBudget = parentBudget;
    this.childSum = childSum;
  }
}

/**
 * Thrown when a subtask spec is malformed for a reason other than the
 * budget-sum invariant: schema violation, zero/negative budget dimension,
 * or `assignTo` naming no shipped template.
 */
export class InvalidSubtaskError extends Error {
  /** Zero-based index of the offending subtask in the input array. */
  readonly index: number;

  constructor(index: number, message: string) {
    super(`subtask[${index}]: ${message}`);
    this.name = 'InvalidSubtaskError';
    this.index = index;
  }
}

/**
 * Thrown when the parent contract handed to decomposePlan fails
 * TaskContractSchema validation (charter: zod-validate at every contract
 * boundary).
 */
export class InvalidParentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidParentError';
  }
}
