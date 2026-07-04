/**
 * Run state, checkpoint record shape, and typed engine errors. The state is
 * deliberately a plain JSON-serializable object validated by zod: a resume
 * trusts nothing it reads back from storage [CLM-0044] — a checkpoint that
 * does not parse is a typed failure, never a silent partial resume.
 */
import { z } from 'zod';
import {
  FindingSchema,
  TaskContractSchema,
  VerdictSchema,
  type Finding,
  type Outcome,
} from '@kernloop/contracts';

/**
 * Where the run is. `main` points at the NEXT main-chain node to execute;
 * `fanout` points at the next (child, sub-node) pair; `done` is terminal.
 * The cursor always names work not yet performed, so resuming from a
 * checkpoint never re-runs a completed node [CLM-0044].
 */
export const CursorSchema = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('main'), node: z.string().min(1) }),
  z.strictObject({
    phase: z.literal('fanout'),
    childIndex: z.number().int().nonnegative(),
    sub: z.number().int().nonnegative(),
  }),
  z.strictObject({ phase: z.literal('done') }),
]);
export type Cursor = z.infer<typeof CursorSchema>;

/** Metered spend attributed to one fan-out child (tokens + usd), #56. */
export const ChildSpendSchema = z.strictObject({
  tokens: z.number().nonnegative(),
  usd: z.number().nonnegative(),
});
export type ChildSpend = z.infer<typeof ChildSpendSchema>;

/**
 * One fan-out child's honest result. A child that fails mid-implement gets
 * `error` and no verdict; a child whose quality gate ran gets its Verdict
 * (pass or fail — a failing verdict is a result, not an engine error). The
 * `reviewVerdict` is the advisory review gate's verdict (recorded, never
 * blocking). All shapes aggregate into integrate's input unfiltered.
 *
 * `iteration` and `findings` carry the per-child actor-critic loop [CLM-0043]:
 * a quality reject re-runs implement, folding the gate's findings into the
 * coder's next attempt, bounded by Kc (and the run budget). They mirror the
 * run-level `iteration`/`findings` but scope to one child, and are
 * checkpointed so a resume mid-child-iteration re-runs nothing finished.
 * `escalated` marks a child that hit the Kc/budget bound still failing — it is
 * recorded, never re-attempted, and does NOT sink its siblings or the run.
 */
export const ChildResultSchema = z.strictObject({
  child: TaskContractSchema,
  output: z.unknown().optional(),
  verdict: VerdictSchema.optional(),
  reviewVerdict: VerdictSchema.optional(),
  /** The parsimony Check-layer gate's verdict (#9/#415): at intensity lite it is
   * advisory (recorded, never blocking, like `reviewVerdict`); at full/ultra a
   * REJECT drives child re-iteration. Kept in its OWN slot so the parsimony gate
   * never clobbers the quality `verdict` (the parsimony node runs after both). */
  parsimonyVerdict: VerdictSchema.optional(),
  error: z.string().min(1).optional(),
  /**
   * Workspace-relative paths this child's implement step has written, the
   * UNION across all of its iterations — PATHS ONLY, never content (#543,
   * CLM-0199): the content is on disk in the workspace, not duplicated into
   * the checkpoint. CHECKPOINTED (unlike the CLI's in-process `writtenByChild`
   * stash, which is process-local), so a `--resume` after a kill can rebuild
   * the scoped child-quality-gate union from durable state instead of falling
   * back to the whole-workspace scan + sticky taint (`scopeTaintedChildren`,
   * still the fallback for a child with neither an in-memory stash NOR a
   * checkpointed set — e.g. a pre-#543 checkpoint). Set (overwritten with the
   * latest full union, never appended-to) each time implement completes.
   */
  writtenPaths: z.array(z.string().min(1)).optional(),
  /** How many times implement has been re-run for this child (0 on first). */
  iteration: z.number().int().nonnegative().default(0),
  /** Gate findings accumulated across this child's iterations, fed to the coder. */
  findings: z.array(FindingSchema).default([]),
  /** Set when the child hit the Kc/budget bound still failing (bounded escalation). */
  escalated: z.boolean().optional(),
  /**
   * Metered model spend ATTRIBUTED to this child's sub-chain (#56): the
   * run-global meter sliced by the SEQUENTIAL child boundary, summed across all
   * of the child's Kc iterations. Set as the fan-out runs the child when the
   * composition root injected a `meteredSpend` seam; absent on an unmetered run.
   * Per-PROCESS, like the meter it reads (#212): a resume re-attributes from the
   * fresh meter and DROPS any pre-resume spend, so a child finished before a
   * resume reports none — keeping the sum within the (also per-process) run cost.
   */
  spend: ChildSpendSchema.optional(),
});
export type ChildResult = z.infer<typeof ChildResultSchema>;

/** One executed node in the run's trace (deterministic order, child-tagged). */
export const TraceEntrySchema = z.strictObject({
  seq: z.number().int().positive(),
  node: z.string().min(1),
  iteration: z.number().int().nonnegative(),
  childId: z.string().min(1).optional(),
});
export type TraceEntry = z.infer<typeof TraceEntrySchema>;

/**
 * The complete serializable state of one run. Self-contained: a checkpoint's
 * state plus the injected executors is everything a resume needs.
 */
export const RunStateSchema = z.strictObject({
  task: TaskContractSchema,
  status: z.enum(['running', 'escalated', 'completed']),
  cursor: CursorSchema,
  /**
   * Why an escalated run halted: `vote` (the K vote-iterate bound — resume
   * re-plans with a fresh K after the human edit [CLM-0043]); `vote-escalation`
   * (a vote gate ruled `escalate` — a deadlocked panel asking a human, #192 —
   * distinct from `vote` so an operator tells a deadlock from K-exhaustion;
   * resume re-plans the same way); or `budget` (the run exceeded its budget in
   * enforce mode — resume continues from the cursor once the human raises the
   * budget or re-runs unlimited [CLM-0077]). Absent while running/completed.
   */
  haltReason: z.enum(['vote', 'vote-escalation', 'budget']).optional(),
  /** Vote-iterate count: how many times the rejected edge re-entered plan. */
  iteration: z.number().int().nonnegative(),
  /** Last emission per node name — the values that flow along edges. */
  values: z.record(z.string(), z.unknown()),
  /** Findings accumulated from rejecting vote Verdicts, fed back to plan. */
  findings: z.array(FindingSchema),
  /** Decomposed (plus overlay-added specialist) children, set at fan-out. */
  children: z.array(TaskContractSchema),
  /** Per-child results accumulated as the fan-out progresses. */
  childResults: z.array(ChildResultSchema),
  trace: z.array(TraceEntrySchema),
  /**
   * Largest single-NODE metered spend seen this run (#342). The pre-node budget
   * guard reserves at least this much so an enforce-mode cap is not overshot by
   * one node's spend. PERSISTED in the checkpoint, so a resume RESTORES the
   * learned max — conservative: the prior worst node still bounds the reserve
   * even though the per-process `spent()` meter restarts. Defaulted so a pre-#342
   * checkpoint (which lacks the field) resumes cleanly.
   */
  observedMaxNodeSpend: ChildSpendSchema.default({ tokens: 0, usd: 0 }),
});
export type RunState = z.infer<typeof RunStateSchema>;

/**
 * One checkpoint row, persisted through the injected store after EVERY node
 * completion [CLM-0044]: `{runId, seq, node, iteration, state}` where `node`
 * is the node that just completed and `state` already points past it.
 */
export const CheckpointRecordSchema = z.strictObject({
  runId: z.string().min(1),
  seq: z.number().int().positive(),
  node: z.string().min(1),
  iteration: z.number().int().nonnegative(),
  state: RunStateSchema,
  createdAt: z.string().min(1),
});
export type CheckpointRecord = z.infer<typeof CheckpointRecordSchema>;

/** Why a run stopped without completing (or could not start/resume). */
export type WorkflowErrorCode =
  | 'unwired_node' // createEngine: a graph node has no executor — wiring-complete or absent
  | 'invalid_task' // run(): the input is not a valid TaskContract
  | 'edge_contract' // a node emitted something that fails its declared contract
  | 'executor_failed' // a node executor threw (non-abort)
  | 'aborted' // AbortError thrown or the injected signal fired mid-node
  | 'checkpoint_failed' // the injected store failed to persist — resumability would be a lie
  | 'no_checkpoint' // resume() found nothing for the runId
  | 'corrupt_checkpoint'; // resume() read state that fails RunStateSchema

/**
 * Typed engine failure. Edge-contract failures name the node and the
 * contract the emission violated [CLM-0042].
 */
export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  /** Node involved, when one is. */
  readonly node?: string;
  /** Contract violated, for `edge_contract`. */
  readonly contract?: string;
  constructor(
    code: WorkflowErrorCode,
    message: string,
    details: { node?: string; contract?: string; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'WorkflowError';
    this.code = code;
    if (details.node !== undefined) this.node = details.node;
    if (details.contract !== undefined) this.contract = details.contract;
  }
}

/** Terminal report of a run (or of a resumed continuation of one). */
export interface RunResult {
  readonly runId: string;
  /**
   * `completed` — retrospect emitted the final Outcome;
   * `escalated` — the vote-iterate bound K was exhausted; the run HALTED
   *   with its findings and resumes from plan after the human edits
   *   [CLM-0043];
   * `failed` — a typed error stopped the run; the last checkpoint is
   *   intact and `resume(runId)` re-attempts from it [CLM-0044].
   */
  readonly status: 'completed' | 'escalated' | 'failed';
  readonly nodeTrace: readonly TraceEntry[];
  /** The final Outcome, on completion. */
  readonly outcome?: Outcome;
  /**
   * Why an escalated run halted, surfaced so an operator can triage: `vote` (the
   * K vote-iterate bound), `vote-escalation` (a vote gate ruled `escalate` — a
   * deadlocked panel asking a human, #192), or `budget`. Present only on
   * `escalated`; the cli maps a cooperative-abort cancel to its own `'aborted'`.
   */
  readonly haltReason?: 'vote' | 'vote-escalation' | 'budget';
  /** Accumulated rejecting-vote findings, on escalation. */
  readonly findings?: readonly Finding[];
  /** The typed error, on failure. */
  readonly error?: WorkflowError;
  /**
   * Per-child metered spend attribution (#56), present when the run was metered
   * (a `meteredSpend` seam was injected) and produced fan-out children. One
   * entry per child whose sub-chain incurred spend.
   */
  readonly childSpend?: readonly { readonly childId: string; readonly spend: ChildSpend }[];
}
