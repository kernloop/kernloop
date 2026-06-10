/**
 * Strategy matrix for the ported consensus strategies (CLM-0037): the
 * v1-derived semantics — abstain-excluded denominators, strict simple
 * majority, inclusive 2/3 supermajority, rejection-vetoed unanimity — each
 * pinned by an explicit vote table.
 */
import { describe, expect, it } from 'vitest';
import { aggregateVotes, type BallotVote, type VoteStrategy } from './strategies.js';

const A: BallotVote = 'approve';
const R: BallotVote = 'reject';
const S: BallotVote = 'abstain';

describe('aggregateVotes — simple_majority', () => {
  it('simple majority approves 2-1 and rejects 1-2', () => {
    expect(aggregateVotes('simple_majority', [A, A, R])).toEqual({
      result: 'approve',
      confidence: 2 / 3,
    });
    expect(aggregateVotes('simple_majority', [A, R, R])).toEqual({
      result: 'reject',
      confidence: 1 / 3,
    });
  });

  it('rejects an exact tie (a tie is not a majority)', () => {
    expect(aggregateVotes('simple_majority', [A, R])).toEqual({
      result: 'reject',
      confidence: 0.5,
    });
    expect(aggregateVotes('simple_majority', [A, A, R, R])).toEqual({
      result: 'reject',
      confidence: 0.5,
    });
  });

  it('excludes abstentions from the denominator', () => {
    // 1 approve, 0 reject, 2 abstain → 1/1 approves.
    expect(aggregateVotes('simple_majority', [A, S, S])).toEqual({
      result: 'approve',
      confidence: 1,
    });
    // 2-2 among non-abstain would reject; the abstain changes nothing.
    expect(aggregateVotes('simple_majority', [A, A, R, R, S])).toEqual({
      result: 'reject',
      confidence: 0.5,
    });
  });
});

describe('aggregateVotes — supermajority', () => {
  it('supermajority approves at exactly two thirds and rejects below', () => {
    expect(aggregateVotes('supermajority', [A, A, R])).toEqual({
      result: 'approve',
      confidence: 2 / 3,
    });
    // 4-of-7 = 57% — a simple majority but not a supermajority.
    expect(aggregateVotes('supermajority', [A, A, A, A, R, R, R])).toEqual({
      result: 'reject',
      confidence: 4 / 7,
    });
  });

  it('approves a 5-2 ratification panel (5/7 ≥ 2/3)', () => {
    expect(aggregateVotes('supermajority', [A, A, A, A, A, R, R])).toEqual({
      result: 'approve',
      confidence: 5 / 7,
    });
  });

  it('counts the two-thirds bar over non-abstain votes only', () => {
    // 2 approve, 1 reject, 4 abstain → 2/3 of the deciders approve.
    expect(aggregateVotes('supermajority', [A, A, R, S, S, S, S])).toEqual({
      result: 'approve',
      confidence: 2 / 3,
    });
  });
});

describe('aggregateVotes — unanimous', () => {
  it('unanimous rejects on any rejection and requires at least one approval', () => {
    expect(aggregateVotes('unanimous', [A, A, A, A, A, A, R]).result).toBe('reject');
    expect(aggregateVotes('unanimous', [A, A, A]).result).toBe('approve');
  });

  it('approves when abstentions accompany approvals and nobody rejects', () => {
    expect(aggregateVotes('unanimous', [A, S, S])).toEqual({
      result: 'approve',
      confidence: 1,
    });
  });

  it('approves a single-approve panel (unanimous edge: n=1)', () => {
    expect(aggregateVotes('unanimous', [A])).toEqual({ result: 'approve', confidence: 1 });
  });
});

describe('aggregateVotes — degenerate panels', () => {
  it('an all-abstain panel abstains under every strategy', () => {
    const strategies: VoteStrategy[] = ['simple_majority', 'supermajority', 'unanimous'];
    for (const strategy of strategies) {
      expect(aggregateVotes(strategy, [S, S, S])).toEqual({ result: 'abstain', confidence: 0 });
    }
  });

  it('is deterministic: the same ballots always aggregate identically', () => {
    const votes: BallotVote[] = [A, R, S, A, R, A, S];
    const first = aggregateVotes('supermajority', votes);
    for (let i = 0; i < 10; i++) {
      expect(aggregateVotes('supermajority', votes)).toEqual(first);
    }
  });
});
