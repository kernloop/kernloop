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
  /**
   * Panel decision under the strategy. `escalate` (#192) is emitted ONLY when
   * `escalateOnNoConsensus` is on AND the panel deadlocks (neither the approve
   * bar nor the symmetric reject bar clears); with the flag off the deadlock
   * resolves to `reject` exactly as before.
   */
  readonly result: 'approve' | 'reject' | 'abstain' | 'escalate';
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
 * The SYMMETRIC mirror of {@link clears} for the reject side (#192): does the
 * reject count clear the same bar approvals must? Used only to tell a decisive
 * reject from a genuine DEADLOCK — when neither side clears, the panel reached
 * no consensus. By construction `clears` and `clearsReject` are never both true
 * for the same tally, so the deadlock band (`!clears && !clearsReject`) is the
 * exact, non-overlapping middle: an exact tie under `simple_majority`, a sub-2/3
 * split either way under `supermajority`, any approve+reject mix under
 * `unanimous` (mirror of "zero rejections + ≥1 approval").
 */
function clearsReject(strategy: VoteStrategy, counts: Tally): boolean {
  const nonAbstain = counts.approve + counts.reject;
  switch (strategy) {
    case 'simple_majority':
      return counts.reject * 2 > nonAbstain;
    case 'supermajority':
      return counts.reject * 3 >= nonAbstain * 2;
    case 'unanimous':
      return counts.approve === 0 && counts.reject >= 1;
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
 *
 * `escalateOnNoConsensus` (#192, default false) is the ONLY way `escalate` is
 * produced: when neither the approve bar nor the symmetric reject bar clears (a
 * genuine deadlock), the panel ASKS a human instead of defaulting to `reject`.
 * With the flag off the deadlock band still resolves to `reject` — byte-identical
 * to the prior behavior across every strategy.
 */
export function aggregateVotes(
  strategy: VoteStrategy,
  votes: readonly BallotVote[],
  escalateOnNoConsensus = false,
): VoteOutcome {
  const counts = tally(votes);
  const nonAbstain = counts.approve + counts.reject;
  if (nonAbstain === 0) {
    return { result: 'abstain', confidence: 0 };
  }
  const confidence = counts.approve / nonAbstain;
  if (clears(strategy, counts)) {
    return { result: 'approve', confidence };
  }
  if (escalateOnNoConsensus && !clearsReject(strategy, counts)) {
    return { result: 'escalate', confidence };
  }
  return { result: 'reject', confidence };
}
