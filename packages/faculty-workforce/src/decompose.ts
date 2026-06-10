/**
 * PM plan decomposition — the MECHANICAL half (spec §5.4; CLM-0041).
 *
 * The split: a PM model WRITES the subtask specs upstream, through an
 * invoke function the composition root binds to the kernel adapters; this
 * function never calls a model. It takes those specs as plain input and
 * enforces the contract: schema validity, id/parent/overlay derivation,
 * ceiling clamping, and the budget-sum invariant. The invariant is therefore
 * unit-testable without any model in the loop.
 */
import { TaskContractSchema, TierSchema, type TaskContract, type Tier } from '@kernloop/contracts';
import { z } from 'zod';
import { BudgetExceededError, InvalidParentError, InvalidSubtaskError } from './errors.js';
import { SHIPPED_TEMPLATE_NAMES } from './templates.js';

/** Authority ladder, lowest first (spec §3.2). */
const TIER_ORDER: readonly Tier[] = TierSchema.options;

/** The lower of two tiers on the ladder. */
function minTier(a: Tier, b: Tier): Tier {
  return TIER_ORDER.indexOf(a) <= TIER_ORDER.indexOf(b) ? a : b;
}

/**
 * A child budget as the PM proposes it. Stricter than TaskContract's
 * nonnegative budget: a zero or negative slice on any dimension is rejected
 * — a child with nothing to spend is a stub, and stubs are forbidden.
 */
const SubtaskBudgetSchema = z.strictObject({
  tokens: z.number().int().positive(),
  usd: z.number().positive(),
  wallClockMin: z.number().positive(),
});

/**
 * One subtask as proposed by the PM. Identity, overlay, and authority are
 * NOT inputs — they are derived from the parent here, so a PM cannot grant
 * what the parent does not hold.
 */
export const SubtaskSpecSchema = z.strictObject({
  goal: z.string().min(1),
  constraints: z.array(z.string().min(1)).optional(),
  budget: SubtaskBudgetSchema,
  evidence: TaskContractSchema.shape.evidence.optional(),
  definitionOfDone: TaskContractSchema.shape.definitionOfDone.optional(),
  /** Shipped template name this child is assigned to (custom templates: P3). */
  assignTo: z.enum(SHIPPED_TEMPLATE_NAMES),
});
export type SubtaskSpec = z.infer<typeof SubtaskSpecSchema>;

/** Input to {@link decomposePlan}. */
export interface DecomposePlanInput {
  parent: TaskContract;
  subtasks: SubtaskSpec[];
}

/** Parse one subtask spec, wrapping any schema failure as a typed error. */
function parseSubtask(spec: SubtaskSpec, index: number): SubtaskSpec {
  const parsed = SubtaskSpecSchema.safeParse(spec);
  if (!parsed.success) {
    throw new InvalidSubtaskError(index, z.prettifyError(parsed.error));
  }
  return parsed.data;
}

/** Enforce sum(child) ≤ parent independently per budget dimension. */
function checkBudgetInvariant(parent: TaskContract, subtasks: SubtaskSpec[]): void {
  for (const dimension of ['tokens', 'usd', 'wallClockMin'] as const) {
    const childSum = subtasks.reduce((sum, s) => sum + s.budget[dimension], 0);
    if (childSum > parent.budget[dimension]) {
      throw new BudgetExceededError(dimension, parent.budget[dimension], childSum);
    }
  }
}

/**
 * Derive zod-valid child TaskContracts from a parent plus PM-proposed
 * subtask specs, enforcing (CLM-0041):
 *
 * - BUDGET INVARIANT: child budgets sum within the parent's on each of
 *   tokens, usd, and wallClockMin independently; any breach throws
 *   {@link BudgetExceededError} naming the dimension and amounts. An exact
 *   sum is within budget. Zero/negative child slices are rejected.
 * - Identity: `child.id = parent.id + '.<n>'` (1-based input order),
 *   `child.parent = parent.id`, `child.overlay = parent.overlay`.
 * - Authority: `child.authorityCeiling = min(parent ceiling, 'suggest')`.
 *   Children NEVER exceed the parent ceiling, and agent work is generative,
 *   so it is additionally clamped at the `suggest` entry tier (spec §3.2);
 *   the spec is silent on per-child explicit ceilings, so none is accepted
 *   — a PM cannot grant authority (narrowest reading, recorded).
 * - Constraints: parent constraints bind children, so each child inherits
 *   them, followed by the subtask's own constraints, followed by a routing
 *   constraint `assign:agent.<template>` naming the assigned template's
 *   capability.
 *
 * Fan-out parallelism is bounded by the parent budget as a consequence: the
 * kernel meters, the PM allocates (spec §5.4).
 */
export function decomposePlan(input: DecomposePlanInput): TaskContract[] {
  const parentResult = TaskContractSchema.safeParse(input.parent);
  if (!parentResult.success) {
    throw new InvalidParentError(z.prettifyError(parentResult.error));
  }
  const parent = parentResult.data;
  const subtasks = input.subtasks.map((spec, i) => parseSubtask(spec, i));
  checkBudgetInvariant(parent, subtasks);
  return subtasks.map((spec, i) =>
    TaskContractSchema.parse({
      id: `${parent.id}.${i + 1}`,
      parent: parent.id,
      goal: spec.goal,
      constraints: [
        ...parent.constraints,
        ...(spec.constraints ?? []),
        `assign:agent.${spec.assignTo}`,
      ],
      budget: spec.budget,
      evidence: spec.evidence ?? [],
      definitionOfDone: spec.definitionOfDone ?? [],
      authorityCeiling: minTier(parent.authorityCeiling, 'suggest'),
      overlay: parent.overlay,
    }),
  );
}
