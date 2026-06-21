/**
 * Parsimony Ladder evaluator [#409, CLM-0169] — a truth table per rung proves
 * first-match-wins, the data-driven (no-closure) lookup, and the
 * always-resolves invariant.
 */
import { describe, expect, it } from 'vitest';
import { PARSIMONY_LADDER, evaluateLadder, type LadderRung, type LadderSignals } from './ladder.js';

/** Signals with every rung's predicate FALSE except as overridden (so the bare
 * call falls through to rung 5). */
function sig(over: Partial<LadderSignals> = {}): LadderSignals {
  return { need: true, stdlib: false, native: false, dep: false, oneLine: false, ...over };
}

describe('evaluateLadder — truth table, first-match-wins (#409, CLM-0169)', () => {
  it('rung 0: need=false ⇒ skip — and short-circuits even if lower rungs would hold', () => {
    expect(evaluateLadder(sig({ need: false, stdlib: true }))).toEqual({
      rung: 0,
      name: 'need',
      outcome: 'skip',
    });
  });

  it('rung 1: stdlib ⇒ reuse_stdlib (wins over native/dep/oneLine also true)', () => {
    expect(evaluateLadder(sig({ stdlib: true, native: true, dep: true, oneLine: true }))).toEqual({
      rung: 1,
      name: 'stdlib',
      outcome: 'reuse_stdlib',
    });
  });

  it('rung 2: native (no stdlib) ⇒ reuse_native', () => {
    expect(evaluateLadder(sig({ native: true, dep: true })).outcome).toBe('reuse_native');
  });

  it('rung 3: dep (no stdlib/native) ⇒ reuse_dep', () => {
    expect(evaluateLadder(sig({ dep: true, oneLine: true })).outcome).toBe('reuse_dep');
  });

  it('rung 4: oneLine (nothing reusable) ⇒ one_line', () => {
    expect(evaluateLadder(sig({ oneLine: true })).outcome).toBe('one_line');
  });

  it('rung 5: nothing holds ⇒ minimal_impl (the unconditional fallthrough)', () => {
    expect(evaluateLadder(sig())).toEqual({ rung: 5, name: 'minimal', outcome: 'minimal_impl' });
  });

  it('is deterministic — identical signals always resolve the identical rung', () => {
    const s = sig({ native: true });
    expect(evaluateLadder(s)).toEqual(evaluateLadder(s));
  });

  it('the canonical ladder ends in an unconditional fallthrough (always resolves)', () => {
    const last = PARSIMONY_LADDER[PARSIMONY_LADDER.length - 1];
    expect(last?.signal).toBeNull();
  });

  it('THROWS on a mis-authored ladder with no fallthrough — never a fabricated outcome', () => {
    const broken: LadderRung[] = [
      { rung: 1, name: 'stdlib', signal: 'stdlib', resolveOn: true, outcome: 'reuse_stdlib' },
    ];
    expect(() => evaluateLadder(sig(), broken)).toThrow(/no resolving rung/);
  });

  it('accepts an overlay-supplied ladder (policy data, not code)', () => {
    const custom: LadderRung[] = [
      { rung: 0, name: 'need', signal: 'need', resolveOn: false, outcome: 'skip' },
      { rung: 5, name: 'minimal', signal: null, resolveOn: true, outcome: 'minimal_impl' },
    ];
    expect(evaluateLadder(sig({ stdlib: true }), custom).outcome).toBe('minimal_impl'); // no stdlib rung → falls through
  });
});
