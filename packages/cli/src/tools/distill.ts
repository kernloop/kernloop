/**
 * `distill` — episodic trace → skill proposal at suggest tier (spec §3.4
 * distill row) [CLM-0049, CLM-0058]. A thin kernel-tool wrapper over
 * {@link distillFromTrace}: zod-validates the wire input and forwards to the
 * library function, which gathers the REAL recorded trace, invokes the
 * model through the loop's one adapter seam, and writes the proposal under
 * `skills/proposed/<name>/` — never the live library [CLM-0050].
 */
import { z } from 'zod';
import type { Kernloop } from '../kernel.js';
import { distillFromTrace, type SkillProposal } from '../distill.js';
import type { LoopInvoke } from '../loop/invoke.js';

/** Input to the `distill` tool. */
export const DistillInputSchema = z.strictObject({
  /** Task id of the recorded trace; also probed as a loop run id. */
  trace: z.string().min(1),
  /** Adapter the distill call flows through (spec §3.1); default claude. */
  adapter: z.string().min(1).default('claude'), // CLI name OR registered endpoint id (#395)
});
export type DistillInput = z.input<typeof DistillInputSchema>;

/** The `distill` tool. See module docs. */
export async function distillTool(
  kern: Kernloop,
  input: DistillInput,
  options: { invoke?: LoopInvoke } = {},
): Promise<SkillProposal> {
  const parsed = DistillInputSchema.parse(input);
  return distillFromTrace({
    kern,
    trace: parsed.trace,
    adapter: parsed.adapter,
    ...(options.invoke === undefined ? {} : { invoke: options.invoke }),
  });
}

/** A distill NOMINATION — a trace the loop mechanically flagged distill-worthy. */
export interface DistillNomination {
  readonly taskId: string;
  readonly traceRef: string;
  readonly summary: string;
  readonly createdAt: number;
}

/** Bounded read so the nomination surface can't grow into a wall of text (#228 P3·4 vote). */
const DISTILL_CANDIDATE_LIMIT = 50;

/**
 * The distill-candidate NOMINATION list (#228 P3·4, CLM-0142): the recent
 * episodic traces the loop FLAGGED distill-worthy (`Outcome.distillCandidates`,
 * a mechanical "successful loop run" heuristic), newest-first and bounded. This
 * is `distillCandidates`' first OPERATIONAL consumer — it drives a list a human
 * reviews BEFORE choosing what to distill (the old prompt memo only showed it
 * AFTER a trace was already picked). A human then runs `distill --trace
 * <taskId>`; skills go live only via the human-PR ratification path (CLM-0050).
 * Reads-only — no model call, no auto-distill. The recency-only ranking is
 * deliberately mechanical; a smarter ranker is deferred (#313).
 */
export function listDistillCandidates(kern: Kernloop): DistillNomination[] {
  return kern.memory
    .listSummaries({ limit: DISTILL_CANDIDATE_LIMIT })
    .filter((s) => s.distillCandidates.length > 0)
    .map((s) => ({
      taskId: s.taskId,
      traceRef: s.traceRef,
      summary: s.summary,
      createdAt: s.createdAt,
    }));
}
