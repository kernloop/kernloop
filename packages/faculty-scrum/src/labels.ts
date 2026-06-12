/**
 * The constraint-tag → GitHub-label map + issue-body rendering for program
 * emission (spec §5.4; CLM-0097). The half of `kernloop program emit` that is
 * PURE and GitHub-free: it turns a decomposed child TaskContract into the
 * label set and issue body the CLI will hand to the hardened @kernloop/tracker.
 *
 * Faculty isolation (constitutional rule 5): this module imports ONLY
 * @kernloop/contracts and zod — never the tracker and never the CLI. The label
 * charset it must satisfy (the tracker's `LabelSchema`) is therefore asserted
 * here with an inlined copy of the same regex, not by importing the tracker.
 */
import { parseConstraintTags, type TaskContract } from '@kernloop/contracts';
import { z } from 'zod';
import { UnsafeLabelError } from './errors.js';

/**
 * The tracker `LabelSchema` charset, INLINED (faculty-scrum must not import the
 * tracker — constitutional rule 5). Kept byte-identical to
 * `@kernloop/tracker`'s `LabelSchema` regex (leading alphanumeric, then the
 * `[A-Za-z0-9 _.\-/:]` charset, ≤80, no leading `-`) so a label this module
 * emits is provably accepted at the sink. {@link assertLabelSafe} applies it.
 */
const LABEL_SAFE = /^[A-Za-z0-9][A-Za-z0-9 _.\-/:]*$/;

/**
 * Assert an emitted label satisfies the tracker's label charset (≤80, leading
 * alphanumeric). Every value `programLabels` emits is already charset-bound
 * upstream — altitude is the `epic|story|task` enum; track/sprint/assign are
 * validated by `parseConstraintTags` against `[A-Za-z0-9._-]` — so this is
 * defense in depth: a future tag source that slips an unsafe value cannot
 * escape to `gh` as a flag-shaped label.
 */
function assertLabelSafe(label: string): void {
  if (label.length > 80 || !LABEL_SAFE.test(label)) {
    throw new UnsafeLabelError(label);
  }
}

/**
 * THE ONE MAP: how a single program constraint tag becomes a GitHub label.
 * Keyed by the {@link parseConstraintTags} field, each entry renders the
 * typed value to a label string. This is the single source of truth so the
 * GitHub view and future loop routing can never diverge on the spelling.
 *
 * Note the `assign` transform: `assign:agent.<t>` (the constraint carrier) maps
 * to the label `agent:<t>` — the key changes from `assign` to `agent` and the
 * `agent.<t>` value's `.` becomes `:`. The other three keys pass through.
 *
 * INCREMENT 4 (#52) NOTE: the REVERSE direction (label → tag, for loop
 * routing) is a trivial later addition over this same table, and when the
 * kernel/router needs it the table moves to a shared home. For now
 * faculty-scrum is the only consumer.
 */
const LABEL_MAP: {
  readonly altitude: (v: string) => string;
  readonly track: (v: string) => string;
  readonly sprint: (v: string) => string;
  readonly assign: (v: string) => string | undefined;
} = {
  altitude: (v) => `altitude:${v}`,
  track: (v) => `track:${v}`,
  sprint: (v) => `sprint:${v}`,
  // `assign:agent.<t>` → `agent:<t>` (drop the `assign:` prefix, `.` → `:`).
  // Anything not of the `agent.<t>` shape produces no label (skipped).
  assign: (v) => (v.startsWith('agent.') ? `agent:${v.slice('agent.'.length)}` : undefined),
};

/**
 * Map a TaskContract's constraint tags to GitHub labels through the one
 * `LABEL_MAP` table — so the GitHub view and future loop routing never
 * diverge [CLM-0097]. Emits `altitude:<a>`, `track:<t>`, `sprint:<s>`, and
 * `agent:<t>` (from `assign:agent.<t>`); free-form/unknown constraints (the
 * `other` bucket) produce NO label. Output is deduped and every label is
 * asserted tracker-label-safe ({@link assertLabelSafe}) before return.
 */
export function programLabels(constraints: readonly string[]): string[] {
  const tags = parseConstraintTags(constraints);
  const out: string[] = [];
  if (tags.altitude !== undefined) out.push(LABEL_MAP.altitude(tags.altitude));
  if (tags.track !== undefined) out.push(LABEL_MAP.track(tags.track));
  if (tags.sprint !== undefined) out.push(LABEL_MAP.sprint(tags.sprint));
  if (tags.assign !== undefined) {
    const label = LABEL_MAP.assign(tags.assign);
    if (label !== undefined) out.push(label);
  }
  const deduped = [...new Set(out)];
  for (const label of deduped) assertLabelSafe(label);
  return deduped;
}

/** The replayable, task-shaped payload embedded in a program issue body. */
const PayloadSchema = z.strictObject({
  id: z.string(),
  parent: z.string().optional(),
  goal: z.string(),
  constraints: z.array(z.string()),
  budget: z.object({
    tokens: z.number(),
    usd: z.number(),
    wallClockMin: z.number(),
  }),
});

/**
 * Render the GitHub issue body for a decomposed child node (CLM-0097): the
 * node goal as prose, then the replayable task-shaped payload (id, parent,
 * goal, constraints, budget) as a fenced JSON block a human or `kernloop run`
 * can pick up. Pure — no secrets, no tracker, no model. Mirrors the spirit of
 * faculty-observer's `issueBody`.
 */
export function programIssueBody(node: TaskContract): string {
  const payload = PayloadSchema.parse({
    id: node.id,
    ...(node.parent !== undefined ? { parent: node.parent } : {}),
    goal: node.goal,
    constraints: node.constraints,
    budget: node.budget,
  });
  const json = JSON.stringify(payload, null, 2);
  return `${node.goal}\n\n---\nTask-shaped payload — feed to \`kernloop run\` (no privileged path):\n\n\`\`\`json\n${json}\n\`\`\``;
}
