import { z } from 'zod';
import { CostSchema, FindingSchema } from './common.js';

/**
 * Verdict result (spec §4): voting gates use `approve`/`reject`/`abstain`;
 * checking gates use `pass`/`fail`. All gates are uniform Verdict emitters
 * (spec §5.3).
 */
export const VerdictResultSchema = z.enum(['approve', 'reject', 'abstain', 'pass', 'fail']);
export type VerdictResult = z.infer<typeof VerdictResultSchema>;

/**
 * Per-voter record inside a Verdict (spec §4: "per-voter reasoning, for
 * precision tracking"). Precision over a sliding window feeds tier
 * promotion/demotion (spec §3.2).
 */
export const VoterRecordSchema = z.strictObject({
  /** Identifier of the voter (model, gate member, or agent). */
  voter: z.string().min(1),
  /** The individual vote this voter cast. */
  vote: VerdictResultSchema,
  /** The voter's reasoning, kept for precision tracking. */
  reasoning: z.string(),
});
export type VoterRecord = z.infer<typeof VoterRecordSchema>;

/**
 * Verdict — a gate's judgment on a proposal (spec §4). Emitted by the
 * `gate` kernel tool (spec §3.4) and by every gate uniformly (spec §5.3).
 * Whether a Verdict can block depends on the gate's authority tier
 * (spec §3.2: `advisory` casts non-blocking Verdicts; `enforce` may block).
 *
 * Fields (exactly as specified):
 * - `taskId` / `gate` — what was judged and by which gate
 * - `result` — `approve | reject | abstain | pass | fail`
 * - `confidence` — the gate's confidence in its result, 0..1
 * - `findings` — structured, severity-tagged Findings
 * - `voters?` — per-voter reasoning, for precision tracking
 * - `cost` — what the verdict cost to produce
 */
export const VerdictSchema = z.strictObject({
  taskId: z.string().min(1),
  gate: z.string().min(1),
  result: VerdictResultSchema,
  confidence: z.number().min(0).max(1),
  findings: z.array(FindingSchema),
  voters: z.array(VoterRecordSchema).optional(),
  cost: CostSchema,
});

/** Inferred Verdict type — see {@link VerdictSchema}. */
export type Verdict = z.infer<typeof VerdictSchema>;
