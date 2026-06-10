/**
 * `brief` — compile context without executing (spec §3.4): TaskContract →
 * Brief. A dry-run of the compiler over real gathered sources — overlay
 * claims registry, semantic recall on the goal, episodic summaries, live
 * git probes, and the skills index (see gather.ts). The Brief is published
 * on the bus (audited) and returned; nothing runs.
 */
import { z } from 'zod';
import { TierSchema, type Brief } from '@kernloop/contracts';
import type { Kernloop } from '../kernel.js';
import { assembleBrief } from '../gather.js';
import { RunInputSchema, buildTask } from './run.js';

/** Input to the `brief` tool — the run input minus execution concerns. */
export const BriefInputSchema = z.strictObject({
  goal: z.string().min(1),
  id: z.string().min(1).optional(),
  constraints: z.array(z.string().min(1)).default([]),
  authorityCeiling: TierSchema.default('advisory'),
  overlay: z.string().min(1).optional(),
});
export type BriefInput = z.input<typeof BriefInputSchema>;

/** The `brief` tool. See module docs. */
export async function briefTool(kern: Kernloop, input: BriefInput): Promise<Brief> {
  const parsed = BriefInputSchema.parse(input);
  // Reuse the run tool's TaskContract assembly; capability is irrelevant to
  // a dry-run compile but the schema requires one shape — build directly.
  const task = buildTask(kern, RunInputSchema.parse({ ...parsed, capability: 'brief.compile' }));
  return assembleBrief(kern, task);
}
