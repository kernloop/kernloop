import { z } from 'zod';
import { CostSchema, SignalSchema } from './common.js';

/**
 * Outcome status (spec §4): how the task ended —
 * `success | partial | failure | cancelled`.
 */
export const OutcomeStatusSchema = z.enum(['success', 'partial', 'failure', 'cancelled']);
export type OutcomeStatus = z.infer<typeof OutcomeStatusSchema>;

/**
 * Outcome — the terminal record of a task (spec §4). The `run` kernel tool
 * returns one (spec §3.4); outcomes feed the fitness ledger and the memory
 * faculty's distillation loop.
 *
 * Fields (exactly as specified):
 * - `taskId` — the TaskContract this outcome closes
 * - `status` — `success | partial | failure | cancelled`
 * - `signals` — Signal[]: tests passed, gates cleared, regressions
 * - `cost` — realized cost, per-adapter per-phase
 * - `traceRef` — pointer to the full episodic trace
 * - `distillCandidates` — traces worth skill distillation (the `distill`
 *   tool proposes SKILL.md from an episodic trace, spec §3.4)
 */
export const OutcomeSchema = z.strictObject({
  taskId: z.string().min(1),
  status: OutcomeStatusSchema,
  signals: z.array(SignalSchema),
  cost: CostSchema,
  traceRef: z.string().min(1),
  distillCandidates: z.array(z.string().min(1)),
});

/** Inferred Outcome type — see {@link OutcomeSchema}. */
export type Outcome = z.infer<typeof OutcomeSchema>;
