/**
 * The Parsimony Ladder [#409, EPIC #407] — the restraint invariant. An ordered
 * preference cascade (cheap mechanical rungs first, the one subjective rung last)
 * that stops at the FIRST rung that holds and names the resolving rung's outcome.
 * The ladder is POLICY DATA (a plain rung table referencing signal names, no
 * closures) so it is overlay-loadable and the evaluator stays a generic, pure,
 * deterministic lookup — it makes no model call, reads no I/O, and never synthesizes
 * an outcome the table did not declare.
 *
 * rung 0  need     does this need to exist?          NO  → skip
 * rung 1  stdlib   stdlib already does it?            yes → reuse_stdlib
 * rung 2  native   a native platform feature does?    yes → reuse_native
 * rung 3  dep      an installed dependency does?      yes → reuse_dep
 * rung 4  oneLine  expressible in one line?           yes → one_line
 * rung 5  minimal  otherwise: the minimum that works  —   → minimal_impl
 *
 * @module parsimony/ladder
 */
import type { ParsimonyOutcome } from './receipt.js';

/** The boolean signals a parsimony decision is evaluated against (one per rung
 * except the always-resolving fallthrough). Every signal is supplied by the
 * caller; the evaluator does not compute them. */
export interface LadderSignals {
  /** Does the thing need to exist at all? `false` resolves rung 0 (skip). */
  readonly need: boolean;
  /** Does the standard library already do it? */
  readonly stdlib: boolean;
  /** Does a native platform feature already do it? */
  readonly native: boolean;
  /** Does an already-installed dependency already do it? */
  readonly dep: boolean;
  /** Is it expressible in one line? */
  readonly oneLine: boolean;
}

/** One rung of the ladder as DATA: resolves when `signal` equals `resolveOn` (or
 * unconditionally when `signal` is null — the fallthrough), yielding `outcome`. */
export interface LadderRung {
  readonly rung: number;
  readonly name: string;
  /** The {@link LadderSignals} key this rung tests, or null for the fallthrough. */
  readonly signal: keyof LadderSignals | null;
  /** The signal value that RESOLVES this rung (rung 0 resolves on `false`). */
  readonly resolveOn: boolean;
  readonly outcome: ParsimonyOutcome;
}

/** The canonical ladder (spec/plan §2.1). Policy data — an overlay may supply its
 * own table; the last rung MUST be an unconditional fallthrough so evaluation
 * always resolves. */
export const PARSIMONY_LADDER: readonly LadderRung[] = [
  { rung: 0, name: 'need', signal: 'need', resolveOn: false, outcome: 'skip' },
  { rung: 1, name: 'stdlib', signal: 'stdlib', resolveOn: true, outcome: 'reuse_stdlib' },
  { rung: 2, name: 'native', signal: 'native', resolveOn: true, outcome: 'reuse_native' },
  { rung: 3, name: 'dep', signal: 'dep', resolveOn: true, outcome: 'reuse_dep' },
  { rung: 4, name: 'oneLine', signal: 'oneLine', resolveOn: true, outcome: 'one_line' },
  { rung: 5, name: 'minimal', signal: null, resolveOn: true, outcome: 'minimal_impl' },
];

/** What the ladder resolved to: the first rung that held and its outcome. */
export interface LadderResult {
  readonly rung: number;
  readonly name: string;
  readonly outcome: ParsimonyOutcome;
}

/**
 * Evaluate `signals` against the ladder top-down, returning the FIRST rung that
 * holds (first-match-wins) and its outcome — the restraint decision the receipt
 * records. Pure and deterministic: identical signals always yield the identical
 * rung. Throws only if a (mis-authored) `ladder` has no resolving rung — never a
 * fabricated outcome.
 */
export function evaluateLadder(
  signals: LadderSignals,
  ladder: readonly LadderRung[] = PARSIMONY_LADDER,
): LadderResult {
  for (const rung of ladder) {
    if (rung.signal === null || signals[rung.signal] === rung.resolveOn) {
      return { rung: rung.rung, name: rung.name, outcome: rung.outcome };
    }
  }
  throw new Error('parsimony ladder has no resolving rung (the table needs a fallthrough)');
}
