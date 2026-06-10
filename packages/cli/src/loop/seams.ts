/**
 * Adapter seams for the model-judged gates — the composition root's
 * bindings of the faculty-gates injected dependencies (`invokeVoter`,
 * `invokeReviewer`) onto the loop's ONE injectable invoke (loop/invoke.ts).
 * Both seams follow the same strict-JSON pattern: the prompt states the
 * output contract, the emission is extracted and zod-parsed by the hardened
 * `parseEmission` (raw output preserved under `<overlay>/checkpoints/` on
 * violation), and a parse failure THROWS — the gate runner records that
 * voter/reviewer as an honest abstain, never a fabricated judgment.
 */
import { z } from 'zod';
import type { Brief } from '@kernloop/contracts';
import {
  ReviewFindingSchema,
  type InvokeReviewer,
  type InvokeVoter,
} from '@kernloop/faculty-gates';
import { BallotEmissionSchema, parseEmission, type LoopInvoke } from './invoke.js';

/** What both seams bind to: the overlay (for violation sinks), the run/task
 * id labelling preserved raw output, and the one metered invoke. */
export interface SeamBindings {
  /** Overlay directory; contract violations preserve raw output under its
   * `checkpoints/`. */
  readonly overlayDir: string;
  /** Run (or gate task) id for the violation file name. */
  readonly runId: string;
  /** The ONE model seam — already metered by the caller. */
  readonly invoke: LoopInvoke;
}

/** Render a Brief's sections as prompt text. */
export function briefText(brief: Brief): string {
  return brief.sections.map((s) => `### ${s.name}\n${s.content}`).join('\n\n');
}

/** One voter's prompt: role + the shared brief + proposal + strict contract. */
function voterPrompt(rolePrompt: string, brief: Brief, proposal: string): string {
  return [
    rolePrompt,
    '## Shared brief',
    briefText(brief),
    '## Proposal under vote',
    proposal,
    'Output contract (STRICT): output ONLY one raw JSON object — no markdown fences, no ' +
      'commentary before or after: {"vote":"approve"|"reject"|"abstain","reasoning":"<why>"}',
  ].join('\n\n');
}

/**
 * Bind `invoke` as the vote gate's voter seam under the strict ballot
 * contract. A malformed ballot throws (raw output preserved for diagnosis),
 * so the gate records an honest abstain for that voter.
 */
export function ballotInvoker(b: SeamBindings): InvokeVoter {
  return async (voter, brief, proposal) => {
    const { output, cost } = await b.invoke(voterPrompt(voter.rolePrompt, brief, proposal));
    const sink = { overlayDir: b.overlayDir, runId: b.runId, node: `vote-${voter.name}` };
    const ballot = parseEmission(output, BallotEmissionSchema, 'ballot', sink);
    return { ...ballot, cost };
  };
}

/** A reviewer's raw report — the strict reviewer output contract. */
export const ReviewEmissionSchema = z.strictObject({
  findings: z.array(ReviewFindingSchema),
  summary: z.string(),
});

/** One reviewer's prompt: lens role + the diff + context + strict contract. */
function reviewerPrompt(rolePrompt: string, diff: string, context?: string): string {
  return [
    rolePrompt,
    ...(context === undefined ? [] : ['## Context', context]),
    '## Diff under review',
    diff,
    'Output contract (STRICT): output ONLY one raw JSON object — no markdown fences, no ' +
      'commentary before or after: {"findings":[{"severity":"info"|"warn"|"error"|"blocker",' +
      '"message":"<finding>","path":"<optional file path>"}],"summary":"<one-paragraph judgment>"}',
  ].join('\n\n');
}

/**
 * Bind `invoke` as the review gate's reviewer seam under the strict report
 * contract. A malformed report throws (raw output preserved), so the gate
 * records that reviewer as an honest abstain — never coerced findings.
 */
export function reviewerInvoker(b: SeamBindings): InvokeReviewer {
  return async (reviewer, diff, context) => {
    const { output, cost } = await b.invoke(reviewerPrompt(reviewer.rolePrompt, diff, context));
    const sink = { overlayDir: b.overlayDir, runId: b.runId, node: `review-${reviewer.name}` };
    const report = parseEmission(output, ReviewEmissionSchema, 'review-report', sink);
    return { ...report, cost };
  };
}
