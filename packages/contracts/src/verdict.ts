import { z } from 'zod';
import { CostSchema, FindingSchema } from './common.js';
import { ModelIdentitySchema } from './model.js';

/**
 * Verdict result (spec §4): voting gates use `approve`/`reject`/`abstain`;
 * checking gates use `pass`/`fail`. All gates are uniform Verdict emitters
 * (spec §5.3).
 *
 * `escalate` (#192, ≈ ASK) is the human-decision disposition: "I will NEITHER
 * approve NOR block — a human must rule." It is NOT a synchronous
 * human-in-the-loop prompt: an autonomous loop has no human present at the
 * moment a gate escalates, so the canonical loop routes `escalate` to its
 * EXISTING escalated outcome — it HALTS as `escalated` and surfaces the run to
 * the operator on the next interaction (never a silent pass, never an automatic
 * reject). Purely additive: existing Verdicts never carry it, so a consumer
 * compiled before #192 sees byte-identical values (see MIGRATIONS.md).
 */
export const VerdictResultSchema = z.enum([
  'approve',
  'reject',
  'abstain',
  'pass',
  'fail',
  'escalate',
]);
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
  /**
   * The normalized model CLASS that cast this ballot (#369) — present when a
   * provider-DIVERSE panel routed each voter to a distinct adapter, so the system
   * can VERIFY the panel was not one model role-playing N personas (the
   * correlated-oracle weakness). Absent on a single-adapter panel (every voter
   * shares one model). Same additive pattern as `Outcome.served` (#229/#5).
   */
  served: ModelIdentitySchema.optional(),
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
 * - `result` — `approve | reject | abstain | pass | fail | escalate`
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
