/**
 * `gate` — invoke any gate uniformly (spec §3.4): proposal + gate name →
 * Verdict. All three spec §5.3 gates are wired: `quality` (mechanical
 * checks over a workspace), `vote` (a voter panel over one shared compiled
 * Brief through the adapter ballot seam), and `review` (an adversarial
 * reviewer panel over a diff through the adapter reviewer seam). An unknown
 * gate name is a typed error naming what exists. Every emitted Verdict is
 * published on the bus (audited [CLM-0032]), ingested by the observer
 * (spec §5.5), and recorded as `cli.gate.verdict` telemetry.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Verdict } from '@kernloop/contracts';
import {
  PANEL_DEFAULT,
  PANEL_RATIFICATION,
  runReviewGate,
  runVoteGate,
  type QualityCheck,
} from '@kernloop/faculty-gates';
import type { Kernloop } from '../kernel.js';
import { executeQualityGate, publishVerdict } from '../executors.js';
import { type LoopInvoke } from '../loop/invoke.js';
import { resolveStandaloneInvoke } from '../loop/standalone-invoke.js';
import { ballotInvoker, reviewerInvoker, withReviewTruncationFinding } from '../loop/seams.js';
import { VOTE_STRATEGIES } from '../overlay.js';
import { briefTool } from './brief.js';

/** The three spec §5.3 gates the `gate` tool can invoke. */
export const GATE_NAMES = ['quality', 'vote', 'review'] as const;

/** `gate quality`: mechanical checks over a workspace. */
const QualityInputSchema = z.strictObject({
  gateName: z.literal('quality'),
  taskId: z.string().min(1),
  workspaceDir: z.string().min(1),
});

/** `gate vote`: a voter panel over one shared compiled Brief (spec §8.3). */
const VoteInputSchema = z.strictObject({
  gateName: z.literal('vote'),
  taskId: z.string().min(1).optional(),
  /** The proposal text the panel votes on. */
  proposal: z.string().min(1),
  /** Goal the shared Brief is compiled for; defaults to the proposal. */
  briefGoal: z.string().min(1).optional(),
  /** 3 by default; 7 only at plan ratification (spec §5.3). */
  panel: z.union([z.literal(3), z.literal(7)]).default(3),
  strategy: z.enum(VOTE_STRATEGIES).default('simple_majority'),
  adapter: z.string().min(1).default('claude'), // CLI name OR registered endpoint id (#395)
});

/** `gate review`: an adversarial reviewer panel over a unified diff. */
const ReviewInputSchema = z
  .strictObject({
    gateName: z.literal('review'),
    taskId: z.string().min(1).optional(),
    /** The unified diff under review, inline… */
    diff: z.string().min(1).optional(),
    /** …or read from a file (exactly one of the two). */
    diffFile: z.string().min(1).optional(),
    /** Optional repo/task context shared by every reviewer. */
    context: z.string().min(1).optional(),
    adapter: z.string().min(1).default('claude'), // CLI name OR registered endpoint id (#395)
  })
  .refine((v) => (v.diff === undefined) !== (v.diffFile === undefined), {
    message: 'provide exactly one of diff or diffFile',
  });

/** Input to the `gate` tool — discriminated on the gate name. */
export const GateInputSchema = z.discriminatedUnion('gateName', [
  QualityInputSchema,
  VoteInputSchema,
  ReviewInputSchema,
]);
export type GateInput = z.input<typeof GateInputSchema>;

/** Typed rejection for a gate that does not exist. */
export class UnknownGateError extends Error {
  readonly code = 'unknown_gate';
  constructor(gateName: string) {
    super(`unknown gate "${gateName}" — the gates are ${GATE_NAMES.join(', ')} (spec §5.3)`);
    this.name = 'UnknownGateError';
  }
}

/** Injectable seams (tests script them); the defaults are real. */
export interface GateToolOptions {
  /** Quality-check override (tests only). */
  checks?: readonly QualityCheck[];
  /** Model seam for vote/review panels; default: the chosen kernel adapter. */
  invoke?: LoopInvoke;
}

/** The chosen invoke, or the real adapter — a CLI name OR a registered endpoint (#395). */
function resolveInvoke(kern: Kernloop, adapter: string, invoke?: LoopInvoke): LoopInvoke {
  if (invoke !== undefined) return invoke;
  return resolveStandaloneInvoke(kern, adapter);
}

/** Run the vote gate over one shared compiled Brief (spec §8.3). */
async function voteGate(
  kern: Kernloop,
  input: z.output<typeof VoteInputSchema>,
  invoke?: LoopInvoke,
): Promise<Verdict> {
  const taskId = input.taskId ?? `gate-vote-${randomUUID()}`;
  const brief = await briefTool(kern, { goal: input.briefGoal ?? input.proposal, id: taskId });
  return runVoteGate({
    taskId,
    proposal: input.proposal,
    brief,
    panel: input.panel === 7 ? PANEL_RATIFICATION : PANEL_DEFAULT,
    strategy: input.strategy,
    invokeVoter: ballotInvoker({
      overlayDir: kern.paths.dir,
      runId: taskId,
      invoke: resolveInvoke(kern, input.adapter, invoke),
    }),
  });
}

/** Run the review gate over the diff (inline or read from diffFile). */
async function reviewGate(
  kern: Kernloop,
  input: z.output<typeof ReviewInputSchema>,
  invoke?: LoopInvoke,
): Promise<Verdict> {
  const taskId = input.taskId ?? `gate-review-${randomUUID()}`;
  const diff = input.diff ?? readFileSync(input.diffFile as string, 'utf8');
  const verdict = await runReviewGate({
    taskId,
    diff,
    ...(input.context === undefined ? {} : { context: input.context }),
    invokeReviewer: reviewerInvoker({
      overlayDir: kern.paths.dir,
      runId: taskId,
      invoke: resolveInvoke(kern, input.adapter, invoke),
    }),
  });
  // Truncation is a first-class Verdict signal (#544 part 1), not only prose.
  return withReviewTruncationFinding(verdict, diff, input.context);
}

/** The `gate` tool. See module docs. */
export async function gateTool(
  kern: Kernloop,
  input: GateInput,
  options: GateToolOptions = {},
): Promise<Verdict> {
  const name = (input as { gateName?: unknown }).gateName;
  if (!(GATE_NAMES as readonly unknown[]).includes(name)) {
    throw new UnknownGateError(String(name));
  }
  const parsed = GateInputSchema.parse(input);
  if (parsed.gateName === 'quality') {
    return executeQualityGate(kern, {
      taskId: parsed.taskId,
      workspaceDir: parsed.workspaceDir,
      ...(options.checks === undefined ? {} : { checks: options.checks }),
    });
  }
  const verdict =
    parsed.gateName === 'vote'
      ? await voteGate(kern, parsed, options.invoke)
      : await reviewGate(kern, parsed, options.invoke);
  await publishVerdict(kern, verdict);
  return verdict;
}
