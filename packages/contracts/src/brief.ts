import { z } from 'zod';
import { BriefSectionSchema } from './common.js';

/**
 * Brief — compiled context for a task (spec §4). Produced by the Context
 * Compiler (spec §5.1) and by the `brief` kernel tool (spec §3.4: compile
 * context without executing). Briefs are reproducible artifacts: the same
 * task, memory state, and `compilerVersion` yield the same brief.
 *
 * Fields (exactly as specified):
 * - `taskId` — the TaskContract this brief was compiled for
 * - `sections` — BriefSection[]; each `{ name, content, tokens, priority,
 *   provenance: Source[] }`
 * - `budget` — `{ allotted, used }` token budget accounting
 * - `compilerVersion` — version of the compiler that produced the brief
 */
export const BriefSchema = z.strictObject({
  taskId: z.string().min(1),
  sections: z.array(BriefSectionSchema),
  budget: z.strictObject({
    allotted: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
  }),
  compilerVersion: z.string().min(1),
});

/** Inferred Brief type — see {@link BriefSchema}. */
export type Brief = z.infer<typeof BriefSchema>;
