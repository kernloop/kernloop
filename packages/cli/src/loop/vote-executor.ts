/**
 * The vote-gate loop node and its retrospect-time voter calibration (#369),
 * split from executors.ts for line budget. `voteExecutor` convenes the faculty
 * panel — provider-DIVERSE for a panel-7 ratification vote (Inc1+Inc2) and
 * optionally precision-WEIGHTED (Inc3) — over one shared Brief. `labelVoterOutcomes`
 * is the producer of that precision: at run end it labels each proceeding plan-vote
 * voter against the run's eventual success.
 */
import { BriefSchema, type Brief, type Outcome } from '@kernloop/contracts';
import {
  PANEL_DEFAULT,
  PANEL_RATIFICATION,
  precisionWeight,
  runVoteGate,
  type InvokeVoter,
  type RunVoteGateOptions,
  type VoterTemplate,
} from '@kernloop/faculty-gates';
import type { NodeContext, NodeExecutor } from '@kernloop/workflows';
import { publishVerdict } from '../executors.js';
import { voteInvokerFor } from './vote-diversity.js';
import type { LoopBindings } from './executors.js';

/**
 * Assemble {@link runVoteGate} options from the overlay's `gates.vote.*` knobs:
 * strategy/panel, #192 escalate-on-deadlock, #369 precision weights + correlation
 * awareness, and the #405/#369 Inc5b distinct-class independence quorum — a panel-7
 * RATIFICATION vote DEFAULTS to requiring ≥2 served classes (the human-ratified
 * default-on: a single-oracle ratification escalates rather than auto-approving), and
 * the overlay's `minDistinctClasses` overrides it (set 1 to opt out). Inert on a
 * panel-3 loop vote or a single-adapter / endpoint-only panel (no served identities).
 */
function voteGateOptions(
  b: LoopBindings,
  ctx: NodeContext,
  planBrief: Brief,
  panel: readonly VoterTemplate[],
  isRatification: boolean,
  weights: number[] | undefined,
  invokeVoter: InvokeVoter,
): RunVoteGateOptions {
  const v = ctx.config.gates.vote;
  return {
    taskId: ctx.taskId,
    proposal: planBrief.sections.map((s) => s.content).join('\n\n'),
    brief: b.refs.researchBrief ?? planBrief,
    panel,
    strategy: v.strategy,
    escalateOnNoConsensus: v.escalateOnNoConsensus,
    ...(weights === undefined ? {} : { weights }),
    correlationAware: v.correlationAware,
    correlationForm: v.correlationForm,
    ratificationProfile: isRatification,
    ...(v.minDistinctClasses === undefined ? {} : { minDistinctClasses: v.minDistinctClasses }),
    invokeVoter,
  };
}

/** The vote gate node: faculty panel over ONE shared Brief (spec §8.3). A panel-7
 * RATIFICATION vote convenes a PROVIDER-DIVERSE panel where available (#369). */
export function voteExecutor(b: LoopBindings): NodeExecutor {
  return async (input, ctx) => {
    const planBrief = BriefSchema.parse(input);
    const isRatification = ctx.config.gates.vote.panel === 7;
    const panel = isRatification ? PANEL_RATIFICATION : PANEL_DEFAULT;
    const invokeVoter = voteInvokerFor({
      invoke: b.invokeFor('vote').invoke,
      store: b.kern.store,
      overlayDir: b.kern.paths.dir,
      discovered: b.discovered,
      runId: ctx.runId,
      isRatification,
      ...(b.voteDiversity === undefined ? {} : { voteDiversity: b.voteDiversity }),
    });
    // Precision-weighted voting (#369 Inc3, opt-in): a calibrated voter counts for
    // more. Weights are NEUTRAL until a voter accrues labeled outcomes, so an
    // enabled-but-cold panel is byte-identical. Off ⇒ no weights (equal counts).
    const weights = ctx.config.gates.vote.precisionWeighted
      ? panel.map((v) => {
          const rp = b.kern.observer.runningPrecision(v.name);
          return precisionWeight(rp.precision, rp.labeled);
        })
      : undefined;
    const verdict = await runVoteGate(
      voteGateOptions(b, ctx, planBrief, panel, isRatification, weights, invokeVoter),
    );
    // Stash the proceeding plan-vote verdict so retrospect can label each voter's
    // outcome against the run's eventual success (#369 Inc3a). The LAST vote stashed
    // is the approving one that proceeds (a rejected vote re-plans + re-votes).
    b.refs.planVoteVerdict = verdict;
    await publishVerdict(b.kern, verdict);
    return verdict;
  };
}

/**
 * Label each PLAN-vote voter's outcome (#369 Inc3a) against the run's eventual
 * success — the voter analog of #229/#5 deliverable-pass fitness. A voter is
 * `correct` iff its individual vote matched the result: it APPROVED a plan that
 * fully SUCCEEDED, or REJECTED one that did not. The success threshold is EXPLICIT
 * and load-bearing (the ratified design's condition): ONLY `success` counts —
 * `partial`/`failure`/`cancelled` did not deliver, so approving was not vindicated.
 * This runs only at retrospect, which is reached only after an approving vote
 * PROCEEDED, so the stashed verdict is that proceeding vote; rejected-overall votes
 * (which re-plan, producing no deliverable) are never labeled. ABSTAINING voters
 * are not labeled either — an abstention is "no judgment", not a prediction to be
 * scored. Precision is thus a NOISY PROXY conditioned on proceeded plans — NOT a
 * general voter-quality metric. Labeling happens regardless of the precision-
 * weighting flag, so the data accrues.
 */
export function labelVoterOutcomes(b: LoopBindings, final: Outcome): void {
  const voters = b.refs.planVoteVerdict?.voters;
  if (voters === undefined) return;
  const succeeded = final.status === 'success';
  for (const v of voters) {
    if (v.vote !== 'approve' && v.vote !== 'reject') continue; // abstain ⇒ no prediction
    b.kern.observer.recordVoterOutcome(v.voter, final.taskId, (v.vote === 'approve') === succeeded);
  }
}
