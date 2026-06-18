/**
 * GOLDEN QUALITY EVAL-SET (#226 item 4, EPIC #47 P1) — makes "VETTED" MEASURABLE.
 * Ratified Option A (consensus_vote 7/7): a hermetic, MODEL-FREE benchmark that
 * drives the REAL canonical loop with a SCRIPTED invoke (the existing
 * {@link scriptedInvoke} double — no live model, fully deterministic) and reads
 * the Outcome to decide whether the loop VETTED (accepted) or REJECTED a
 * deliverable. Each fixture is a goal + a scripted deliverable + the kind of
 * variant it is. Three assertions, two HARD + one baseline-pinned:
 *  - GOOD variants MUST be vetted (recall=1, zero false rejects — non-negotiable);
 *  - MECHANICALLY-WRONG variants (a real gate catches them today — here a tsc
 *    failure) MUST be rejected;
 *  - GOAL-FIDELITY-WRONG variants (compile + pass the mechanical gates but
 *    implement the WRONG thing) are the gap item 3 (the groundedness reviewer)
 *    must close. The loop CANNOT detect them today, so the COUNT it currently
 *    fails to detect is PINNED to a baseline — the assertion fails on ANY drift
 *    (up OR down), so when item 3 lands and the count drops, this test forces the
 *    fixture to flip from baseline-recorded to hard-asserted-rejected. This is a
 *    MEASUREMENT of the goal-fidelity gap, NOT a claim that the loop enforces it.
 *
 * This is increment 1 (harness + format + 3 representative fixtures + the gate);
 * the corpus grows (distinct rejection paths, more goals) in follow-ups (#226).
 *
 * @module cli/evals/golden
 */
import { describe, expect, it } from 'vitest';
import { runTool } from '../tools/run.js';
import {
  GREET_TS,
  BROKEN_TS,
  fixtureRepo,
  kernloopFor,
  loopScratch,
  scriptedInvoke,
  typecheck,
} from '../loop-fixtures.js';

/** A greet impl that COMPILES and passes tsc but returns the WRONG word — goal-fidelity-wrong. */
const WRONG_GREET_TS =
  'export function greet(name: string): string {\n  return `goodbye ${name}`;\n}\n';

/** One golden fixture: a goal, the scripted deliverable, and the kind of variant. */
interface EvalFixture {
  readonly name: string;
  readonly goal: string;
  readonly deliverable: string;
  readonly kind: 'good' | 'mechanically-wrong' | 'goal-fidelity-wrong';
}

const FIXTURES: readonly EvalFixture[] = [
  {
    name: 'greet-good',
    goal: 'add a greet feature that returns a hello greeting',
    deliverable: GREET_TS,
    kind: 'good',
  },
  {
    name: 'greet-broken',
    goal: 'add a greet feature that returns a hello greeting',
    deliverable: BROKEN_TS, // does not compile → the real tsc gate rejects it
    kind: 'mechanically-wrong',
  },
  {
    name: 'greet-wrong-word',
    goal: 'add a greet feature that returns a hello greeting',
    deliverable: WRONG_GREET_TS, // compiles + passes tsc, but says "goodbye" — wrong feature
    kind: 'goal-fidelity-wrong',
  },
];

/**
 * The count of GOAL-FIDELITY-WRONG fixtures the loop currently FAILS to vet-reject
 * (it accepts them because no goal-fidelity check exists yet). Pinned so the test
 * fails on ANY drift: when #226 item 3 (the groundedness reviewer) starts catching
 * one, this number must drop AND the fixture flip to a hard reject-assertion.
 */
const BASELINE_UNDETECTED_GOAL_FIDELITY = 1;

/** Drive the real loop hermetically for one fixture; true when the loop VETTED (accepted). */
async function vetted(scratch: string, fx: EvalFixture): Promise<boolean> {
  const repo = fixtureRepo(scratch, `eval-${fx.name}`);
  const kern = kernloopFor(repo);
  try {
    const result = await runTool(
      kern,
      { goal: fx.goal, capability: 'workflow.canonical', workspaceDir: repo, id: `eval-${fx.name}` },
      { checks: [typecheck], invoke: scriptedInvoke({ vote: () => 'approve', files: [{ path: 'src/greet.ts', content: fx.deliverable }] }) },
    );
    return result.kind === 'outcome' && result.outcome.status === 'success';
  } finally {
    kern.close();
  }
}

describe('golden quality eval-set — VETTED is measurable (#226 item 4)', () => {
  const scratch = loopScratch();

  it('vets GOOD variants and rejects MECHANICALLY-WRONG ones; pins the goal-fidelity gap', async () => {
    const results = new Map<string, boolean>();
    for (const fx of FIXTURES) results.set(fx.name, await vetted(scratch, fx));

    // (1) recall=1: every good deliverable is vetted — zero false rejects, non-negotiable.
    for (const fx of FIXTURES.filter((f) => f.kind === 'good'))
      expect(results.get(fx.name), `${fx.name} (good) must be vetted`).toBe(true);

    // (2) every mechanically-wrong deliverable is rejected by a real gate today.
    for (const fx of FIXTURES.filter((f) => f.kind === 'mechanically-wrong'))
      expect(results.get(fx.name), `${fx.name} (mechanically-wrong) must be rejected`).toBe(false);

    // (3) the goal-fidelity gap, MEASURED not enforced: the count the loop currently
    // FAILS to detect is pinned — drift either way fails, forcing the item-3 ratchet.
    const undetected = FIXTURES.filter(
      (f) => f.kind === 'goal-fidelity-wrong' && results.get(f.name) === true,
    ).length;
    expect(
      undetected,
      `goal-fidelity-wrong variants the loop currently fails to detect (item 3 target) — ` +
        `if this changed, update BASELINE_UNDETECTED_GOAL_FIDELITY and flip the now-detected fixture to a hard reject`,
    ).toBe(BASELINE_UNDETECTED_GOAL_FIDELITY);
  });
});
