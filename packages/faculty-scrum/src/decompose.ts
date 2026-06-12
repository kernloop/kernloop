/**
 * Program goal decomposition — the MECHANICAL half, ONE ALTITUDE UP from the
 * PM's plan decomposition (spec §5.4; CLM-0096). Where faculty-workforce's
 * `decomposePlan` splits a ratified plan into agent-assigned children, this
 * splits a program GOAL into an epic/story TaskContract tree, tagging each
 * child with its program altitude/track/sprint as constraint tags.
 *
 * No model is ever called here: a PM model WRITES the story specs upstream;
 * this function takes them as plain input and enforces the contract — schema
 * validity, id/parent/overlay derivation, ceiling clamping, the budget-sum
 * invariant, and well-formed constraint tags. The invariant is therefore
 * unit-testable without any model in the loop. This faculty imports only
 * @kernloop/contracts and zod (constitutional rule 5).
 */
import {
  AltitudeSchema,
  TaskContractSchema,
  TierSchema,
  constraintTag,
  parseConstraintTags,
  type TaskContract,
  type Tier,
} from '@kernloop/contracts';
import { z } from 'zod';
import { InvalidParentError, InvalidStorySpecError, ScrumBudgetExceededError } from './errors.js';

/** Authority ladder, lowest first (spec §3.2). */
const TIER_ORDER: readonly Tier[] = TierSchema.options;

/** The lower of two tiers on the ladder. */
function minTier(a: Tier, b: Tier): Tier {
  return TIER_ORDER.indexOf(a) <= TIER_ORDER.indexOf(b) ? a : b;
}

/**
 * The shipped agent-template names a story may be assigned to. Inlined rather
 * than imported from @kernloop/faculty-workforce — a faculty→faculty import is
 * forbidden (constitutional rule 5). Mirrors workforce's `SHIPPED_TEMPLATE_NAMES`;
 * custom templates are a later increment.
 */
const STORY_ASSIGNEES = ['pm', 'coder', 'reviewer', 'documenter', 'researcher'] as const;

/**
 * A child budget as proposed. Stricter than TaskContract's nonnegative budget:
 * a zero or negative slice on any dimension is rejected — a child with nothing
 * to spend is a stub, and stubs are forbidden.
 */
const StoryBudgetSchema = z.strictObject({
  tokens: z.number().int().positive(),
  usd: z.number().positive(),
  wallClockMin: z.number().positive(),
});

/**
 * One story (or sub-epic) as proposed by the PM. Identity, overlay, and
 * authority are NOT inputs — they are derived from the parent here, so a PM
 * cannot grant what the parent does not hold. `altitude` is the child's
 * program rung (e.g. 'epic' or 'story'); optional `track`/`sprint` group it.
 */
export const StorySpecSchema = z.strictObject({
  goal: z.string().min(1),
  constraints: z.array(z.string().min(1)).optional(),
  budget: StoryBudgetSchema,
  evidence: TaskContractSchema.shape.evidence.optional(),
  definitionOfDone: TaskContractSchema.shape.definitionOfDone.optional(),
  /** Shipped template name this child is assigned to (custom templates: later). */
  assignTo: z.enum(STORY_ASSIGNEES),
  /** The child's program altitude — epic | story | task. */
  altitude: AltitudeSchema,
  /** Optional track grouping (safe label charset, enforced on emit). */
  track: z.string().optional(),
  /** Optional sprint grouping (safe label charset, enforced on emit). */
  sprint: z.string().optional(),
});
export type StorySpec = z.infer<typeof StorySpecSchema>;

/** Input to {@link decomposeGoal}. */
export interface DecomposeGoalInput {
  parent: TaskContract;
  subtasks: StorySpec[];
}

/** Parse one story spec, wrapping any schema failure as a typed error. */
function parseStory(spec: StorySpec, index: number): StorySpec {
  const parsed = StorySpecSchema.safeParse(spec);
  if (!parsed.success) {
    throw new InvalidStorySpecError(index, z.prettifyError(parsed.error));
  }
  return parsed.data;
}

/** Enforce sum(child) ≤ parent independently per budget dimension. */
function checkBudgetInvariant(parent: TaskContract, stories: StorySpec[]): void {
  for (const dimension of ['tokens', 'usd', 'wallClockMin'] as const) {
    const childSum = stories.reduce((sum, s) => sum + s.budget[dimension], 0);
    if (childSum > parent.budget[dimension]) {
      throw new ScrumBudgetExceededError(dimension, parent.budget[dimension], childSum);
    }
  }
}

/** Build a child's constraint array: inherited + own + altitude/track/sprint + assignment. */
function childConstraints(parent: TaskContract, spec: StorySpec): string[] {
  return [
    ...parent.constraints,
    ...(spec.constraints ?? []),
    constraintTag('altitude', spec.altitude),
    ...(spec.track !== undefined ? [constraintTag('track', spec.track)] : []),
    ...(spec.sprint !== undefined ? [constraintTag('sprint', spec.sprint)] : []),
    constraintTag('assign', `agent.${spec.assignTo}`),
  ];
}

/** Map one validated story spec to a zod-valid child TaskContract. */
function toChild(parent: TaskContract, spec: StorySpec, index: number): TaskContract {
  const constraints = childConstraints(parent, spec);
  // Defense in depth: the emitted program tags must read back cleanly — an
  // unsafe track/sprint or bad altitude surfaces here as a typed story error.
  try {
    parseConstraintTags(constraints);
  } catch (error) {
    throw new InvalidStorySpecError(index, error instanceof Error ? error.message : String(error));
  }
  return TaskContractSchema.parse({
    id: `${parent.id}.${index + 1}`,
    parent: parent.id,
    goal: spec.goal,
    constraints,
    budget: spec.budget,
    evidence: spec.evidence ?? [],
    definitionOfDone: spec.definitionOfDone ?? [],
    authorityCeiling: minTier(parent.authorityCeiling, 'suggest'),
    overlay: parent.overlay,
  });
}

/**
 * Derive zod-valid child TaskContracts from a program parent plus PM-proposed
 * story specs, ONE ALTITUDE UP from `decomposePlan` (CLM-0096). Enforces:
 *
 * - BUDGET INVARIANT: child budgets sum within the parent's on each of tokens,
 *   usd, and wallClockMin independently; any breach throws
 *   {@link ScrumBudgetExceededError} naming the dimension and amounts. An exact
 *   sum is within budget. Zero/negative child slices are rejected.
 * - Identity: `child.id = parent.id + '.<n>'` (1-based input order),
 *   `child.parent = parent.id`, `child.overlay = parent.overlay`.
 * - Authority: `child.authorityCeiling = min(parent ceiling, 'suggest')` — a PM
 *   cannot grant authority the parent does not hold, and generative program
 *   work enters at `suggest` (spec §3.2).
 * - Constraints: parent constraints bind children, then the story's own, then
 *   the program tags `altitude:<v>` (+ optional `track:`/`sprint:`), then the
 *   routing tag `assign:agent.<template>`. Emitted tags are validated via
 *   {@link parseConstraintTags} so an unsafe value cannot escape.
 */
export function decomposeGoal(input: DecomposeGoalInput): TaskContract[] {
  const parentResult = TaskContractSchema.safeParse(input.parent);
  if (!parentResult.success) {
    throw new InvalidParentError(z.prettifyError(parentResult.error));
  }
  const parent = parentResult.data;
  const stories = input.subtasks.map((spec, i) => parseStory(spec, i));
  checkBudgetInvariant(parent, stories);
  return stories.map((spec, i) => toChild(parent, spec, i));
}
