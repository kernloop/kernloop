import { z } from 'zod';
import { CheckSchema, EvidenceRequirementSchema, TierSchema } from './common.js';

/**
 * TaskContract — the unit of work entering the kernel (spec §4). The `run`
 * tool takes a goal/TaskContract and routes it via manifests (spec §3.4);
 * the router matches it to manifests by capability, budget, authority tier,
 * and fitness prior (spec §3.1).
 *
 * Fields (exactly as specified):
 * - `id` / `parent?` — task identity and optional parent task
 * - `goal` — what the task must achieve
 * - `constraints` — restrictions the executor must respect
 * - `budget` — `{ tokens, usd, wallClockMin }` hard resource ceilings
 * - `evidence` — what proves done (EvidenceRequirement[])
 * - `definitionOfDone` — machine-checkable Checks
 * - `authorityCeiling` — max tier any action may use (spec §3.2)
 * - `overlay` — repo overlay id (spec §7: per-repo identity as data)
 */
export const TaskContractSchema = z.strictObject({
  id: z.string().min(1),
  parent: z.string().min(1).optional(),
  goal: z.string().min(1),
  constraints: z.array(z.string().min(1)),
  budget: z.strictObject({
    tokens: z.number().int().nonnegative(),
    usd: z.number().nonnegative(),
    wallClockMin: z.number().nonnegative(),
  }),
  evidence: z.array(EvidenceRequirementSchema),
  definitionOfDone: z.array(CheckSchema),
  authorityCeiling: TierSchema,
  overlay: z.string().min(1),
});

/** Inferred TaskContract type — see {@link TaskContractSchema}. */
export type TaskContract = z.infer<typeof TaskContractSchema>;
