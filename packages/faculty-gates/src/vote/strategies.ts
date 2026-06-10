/**
 * Voting strategies for the vote gate (spec §5.3, §12.3 item 3) — the three
 * strategies actually in use, ported from nexus-agents v1
 * (`src/consensus/strategies.ts`): simple majority, supermajority,
 * unanimous. The weighted/Bayesian strategies (proof_of_learning,
 * opinion_wise, higher_order) stay in the quarry until a claim pulls them
 * (spec §1: second-system restraint). Aggregation is pure and
 * deterministic: the same votes always produce the same outcome (CLM-0037).
 */

/** The consensus strategies in use (spec §12.3 resolution). */
export type VoteStrategy = 'simple_majority' | 'supermajority' | 'unanimous';

/** An individual voter's ballot decision. */
export type BallotVote = 'approve' | 'reject' | 'abstain';

/** Aggregated panel outcome: the gate-level result plus its confidence. */
export interface VoteOutcome {
  /** Panel decision under the strategy. */
  readonly result: 'approve' | 'reject' | 'abstain';
  /**
   * Approve share among non-abstain votes, in [0,1] — the gate's
   * confidence in an `approve` is the size of its majority; in a `reject`
   * it is honestly low. All-abstain panels have no signal: confidence 0.
   */
  readonly confidence: number;
}

/** Vote counts by decision. */
interface Tally {
  readonly approve: number;
  readonly reject: number;
}

function tally(votes: readonly BallotVote[]): Tally {
  let approve = 0;
  let reject = 0;
  for (const vote of votes) {
    if (vote === 'approve') approve += 1;
    else if (vote === 'reject') reject += 1;
  }
  return { approve, reject };
}

/**
 * Does the approve count clear the strategy's bar? Thresholds are evaluated
 * as exact rational comparisons (no floating point):
 * - `simple_majority`: strictly more than half of non-abstain votes approve
 *   (v1: ratio > 0.5 — a tie rejects).
 * - `supermajority`: at least two thirds of non-abstain votes approve
 *   (inclusive: 2-of-3 approves; v1 used `>= 0.67`, which 2/3 narrowly
 *   misses — kernloop uses the exact rational per spec §5.3 "super-majority";
 *   delta recorded in PORT-NOTES.md).
 * - `unanimous`: zero rejections and at least one approval (v1 semantics:
 *   abstentions are allowed and do not block, but cannot carry alone).
 */
function clears(strategy: VoteStrategy, counts: Tally): boolean {
  const nonAbstain = counts.approve + counts.reject;
  switch (strategy) {
    case 'simple_majority':
      return counts.approve * 2 > nonAbstain;
    case 'supermajority':
      return counts.approve * 3 >= nonAbstain * 2;
    case 'unanimous':
      return counts.reject === 0 && counts.approve >= 1;
  }
}

/**
 * Aggregate a panel's ballots into one outcome (CLM-0037). Edge cases,
 * deterministic by construction:
 * - Abstentions never count toward the denominator (v1 semantics).
 * - All-abstain panel → result `abstain`, confidence 0 (the panel rendered
 *   no judgment; v1 returned a generic rejection — delta in PORT-NOTES.md).
 * - Exact tie under `simple_majority` → `reject` (a tie is not a majority).
 * - 2-of-3 under `supermajority` → `approve` (exactly two thirds clears an
 *   inclusive threshold).
 * - `unanimous` with approvals + abstentions but zero rejections →
 *   `approve`; with only abstentions → `abstain` (caught by the all-abstain
 *   guard before the ≥1-approve rule applies).
 */
export function aggregateVotes(strategy: VoteStrategy, votes: readonly BallotVote[]): VoteOutcome {
  const counts = tally(votes);
  const nonAbstain = counts.approve + counts.reject;
  if (nonAbstain === 0) {
    return { result: 'abstain', confidence: 0 };
  }
  return {
    result: clears(strategy, counts) ? 'approve' : 'reject',
    confidence: counts.approve / nonAbstain,
  };
}
