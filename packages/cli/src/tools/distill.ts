/**
 * `distill` — episodic trace → skill proposal at suggest tier (spec §3.4
 * distill row) [CLM-0049, CLM-0058]. A thin kernel-tool wrapper over
 * {@link distillFromTrace}: zod-validates the wire input and forwards to the
 * library function, which gathers the REAL recorded trace, invokes the
 * model through the loop's one adapter seam, and writes the proposal under
 * `skills/proposed/<name>/` — never the live library [CLM-0050].
 */
import { z } from 'zod';
import { ADAPTER_NAMES } from '@kernloop/kernel';
import type { Kernloop } from '../kernel.js';
import { distillFromTrace, type SkillProposal } from '../distill.js';
import type { LoopInvoke } from '../loop/invoke.js';

/** Input to the `distill` tool. */
export const DistillInputSchema = z.strictObject({
  /** Task id of the recorded trace; also probed as a loop run id. */
  trace: z.string().min(1),
  /** Adapter the distill call flows through (spec §3.1); default claude. */
  adapter: z.enum(ADAPTER_NAMES).default('claude'),
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
