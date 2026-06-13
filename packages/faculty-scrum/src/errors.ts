/**
 * Typed errors thrown at the scrum faculty's boundaries. Callers discriminate
 * on `name` or `instanceof` — never on message text. Mirrors the shapes of
 * faculty-workforce's decomposition errors (spec §5.4).
 */
import type { Altitude, TaskContract } from '@kernloop/contracts';

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

/**
 * Thrown when a decomposition violates altitude descent (spec §5.4; CLM-0096):
 * an altitude-bearing parent must decompose exactly ONE rung down (epic→story,
 * story→task), and a `task`-altitude parent is a LEAF that cannot decompose at
 * all. (A parent with no altitude — the program root — is the unconstrained
 * entry and is not checked.) Carries the parent + expected/actual child
 * altitudes so a caller can report or replan without parsing text. For a
 * task-parent leaf violation, `expected`/`actual` are omitted.
 */
export class AltitudeDescentError extends Error {
  readonly parentAltitude: Altitude;
  readonly expected?: Altitude;
  readonly actual?: Altitude;
  /** Zero-based index of the offending child, or -1 for a task-leaf parent. */
  readonly index: number;

  constructor(parentAltitude: Altitude, index: number, expected?: Altitude, actual?: Altitude) {
    super(
      expected === undefined
        ? `a "${parentAltitude}" is a leaf and cannot be decomposed (spec §5.4)`
        : `story[${index}]: altitude "${actual ?? '<missing>'}" violates descent — ` +
            `a "${parentAltitude}" parent decomposes to "${expected}" children (spec §5.4)`,
    );
    this.name = 'AltitudeDescentError';
    this.parentAltitude = parentAltitude;
    this.index = index;
    if (expected !== undefined) this.expected = expected;
    if (actual !== undefined) this.actual = actual;
  }
}

/**
 * Thrown by {@link programLabels} when an emitted label would not satisfy the
 * tracker's label charset. Unreachable from valid decomposed input (altitude is
 * an enum; track/sprint/assign are charset-bound upstream) — it is a typed
 * invariant guard so a FUTURE label source that slips an unsafe value surfaces
 * as a clean, discriminable error rather than escaping as a raw throw.
 */
export class UnsafeLabelError extends Error {
  constructor(label: string) {
    super(`program label "${label}" is not tracker-label-safe`);
    this.name = 'UnsafeLabelError';
  }
}
