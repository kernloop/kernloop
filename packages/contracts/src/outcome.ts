import { z } from 'zod';
import { CostSchema, SignalSchema } from './common.js';
import { ModelIdentitySchema } from './model.js';

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
 * - `served` — OPTIONAL normalized ModelIdentity of the model that produced
 *   this outcome (#229/#5). Present only when ONE model is unambiguously
 *   responsible — a per-child (coder) outcome carries the served identity of
 *   the iteration that PASSED; a multi-node run outcome leaves it absent. Lets
 *   fitness attribute DELIVERABLE-PASS (not just call-success) to a model class.
 */
export const OutcomeSchema = z.strictObject({
  taskId: z.string().min(1),
  status: OutcomeStatusSchema,
  signals: z.array(SignalSchema),
  cost: CostSchema,
  traceRef: z.string().min(1),
  distillCandidates: z.array(z.string().min(1)),
  served: ModelIdentitySchema.optional(),
});

/** Inferred Outcome type — see {@link OutcomeSchema}. */
export type Outcome = z.infer<typeof OutcomeSchema>;
