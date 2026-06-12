/**
 * @kernloop/faculty-scrum — the scrum/program-decomposition faculty (spec §5.4).
 *
 * Decomposes a program goal into an epic/story TaskContract tree ONE ALTITUDE
 * UP from the PM's plan decomposition: child budgets must sum within the
 * parent's on every dimension (the budget-sum invariant), and each child
 * carries its program altitude/track/sprint as constraint tags (CLM-0096).
 * GitHub-free and model-free — generative work happens elsewhere; this package
 * is pure mechanical enforcement, surfaced through the suggest-tier
 * `kernloop program decompose` CLI. It imports only @kernloop/contracts and
 * external dependencies (constitutional rule 5).
 */
export { decomposeGoal, StorySpecSchema } from './decompose.js';
export type { StorySpec, DecomposeGoalInput } from './decompose.js';
export { programLabels, programIssueBody } from './labels.js';
export {
  InvalidParentError,
  InvalidStorySpecError,
  ScrumBudgetExceededError,
  UnsafeLabelError,
} from './errors.js';
export type { BudgetDimension } from './errors.js';
export { scrumManifest } from './manifest.js';
