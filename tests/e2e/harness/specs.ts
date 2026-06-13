/**
 * Shared story-spec fixtures for the e2e pipeline scenarios. A two-node program
 * (one `coder` story, one `documenter` story) — small, within the default
 * overlay budget, and exercising two distinct `agent:<t>` label mappings so the
 * emit assertions can prove the per-node label set is real, not hard-coded.
 */

/** One PM-authored story spec (the `--spec` file is a JSON array of these). */
interface StorySpecFixture {
  readonly goal: string;
  readonly budget: { readonly tokens: number; readonly usd: number; readonly wallClockMin: number };
  readonly assignTo: 'pm' | 'coder' | 'reviewer' | 'documenter' | 'researcher';
  readonly altitude: 'epic' | 'story' | 'task';
  readonly track?: string;
  readonly sprint?: string;
}

/** The canonical two-node spec used across the pipeline + invariants scenarios. */
export const TWO_NODE_SPEC: readonly StorySpecFixture[] = [
  {
    goal: 'Build the auth module',
    budget: { tokens: 1_000, usd: 0.1, wallClockMin: 5 },
    assignTo: 'coder',
    altitude: 'story',
  },
  {
    goal: 'Document the auth module',
    budget: { tokens: 1_000, usd: 0.1, wallClockMin: 5 },
    assignTo: 'documenter',
    altitude: 'story',
  },
];

/** The program goal driven through the pipeline (never appears verbatim in audit). */
export const PROGRAM_GOAL = 'Ship the authentication feature';
