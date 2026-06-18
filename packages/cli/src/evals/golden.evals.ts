/**
 * GOLDEN QUALITY EVAL-SET (#226 item 4, EPIC #47 P1) — makes "VETTED" MEASURABLE.
 * Ratified Option A (consensus_vote 7/7): a hermetic, MODEL-FREE benchmark that
 * drives the REAL canonical loop with a SCRIPTED invoke (the existing
 * {@link scriptedInvoke} double — no live model, fully deterministic) and reads
 * the Outcome to decide whether the loop VETTED (accepted), REJECTED, or FLAGGED a
 * deliverable. Each fixture is a goal + a scripted deliverable + the kind of
 * variant it is:
 *  - GOOD variants MUST be vetted clean (recall=1, zero false rejects, no flag);
 *  - MECHANICALLY-WRONG variants (a real gate catches them — here a tsc failure)
 *    MUST be rejected;
 *  - GOAL-FIDELITY-WRONG variants (compile + pass the mechanical gates but
 *    implement the WRONG thing) are now SURFACED as a non-blocking needs-review
 *    signal (advisory — status stays success) by the #226-item-3 groundedness
 *    reviewer; the count left UNDETECTED is pinned to {@link
 *    BASELINE_UNDETECTED_GOAL_FIDELITY} (= 0).
 *
 * HONESTY BOUNDARY (#287): the goal-fidelity case is a WIRING measure — the eval
 * SCRIPTS the groundedness reviewer's reject (the verdict a correct reviewer
 * WOULD return) and asserts the loop SURFACES it as needs-review. It does NOT
 * prove the real model produces that verdict; the model's precision is the
 * separate on-demand LIVE eval, never trusted blind. The corpus grows (distinct
 * rejection paths, more goals) in follow-ups (#285).
 *
 * @module cli/evals/golden
 */
import { describe, expect, it } from 'vitest';
import { runTool } from '../tools/run.js';
import type { LoopReport } from '../loop/index.js';
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
 * The count of GOAL-FIDELITY-WRONG fixtures the loop leaves UNDETECTED — vetted
 * (status success) with NO needs-review flag. Now 0: the groundedness reviewer
 * (#226 item 3) rejects a goal-mismatch and that reject SURFACES as a needs-review
 * signal (advisory — status stays success). NOTE (the honesty boundary): this is a
 * WIRING measure. The hermetic eval SCRIPTS the groundedness reviewer's reject (the
 * verdict a correct reviewer WOULD return) and asserts the loop SURFACES it — it
 * does NOT prove the real model produces that verdict; that is the separate live
 * eval (#287). Pinned: if this rises above 0, a goal-fidelity-wrong variant slipped
 * the wiring and the fixture must be fixed (do NOT raise the baseline to silence it).
 */
const BASELINE_UNDETECTED_GOAL_FIDELITY = 0;

/** One loop outcome for a fixture: vetted = status success; flagged = a needs-review signal surfaced. */
interface EvalResult {
  readonly vetted: boolean;
  readonly flagged: boolean;
}

/** The overlay that OPTS IN to the goal-fidelity (groundedness) review — default off (#226 item 3). */
const GROUNDEDNESS_ON = 'id: eval\ngates:\n  review:\n    groundedness: true\n';

/** Drive the real loop hermetically for one fixture and read its Outcome. */
async function runFixture(scratch: string, fx: EvalFixture): Promise<EvalResult> {
  const repo = fixtureRepo(scratch, `eval-${fx.name}`, GROUNDEDNESS_ON);
  const kern = kernloopFor(repo);
  try {
    const result = await runTool(
      kern,
      {
        goal: fx.goal,
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: `eval-${fx.name}`,
      },
      {
        checks: [typecheck],
        invoke: scriptedInvoke({
          vote: () => 'approve',
          files: [{ path: 'src/greet.ts', content: fx.deliverable }],
          // Script the EXPECTED groundedness verdict for a wrong-feature diff (WIRING test —
          // not real judgment; the live eval measures that, #287).
          groundednessReject: fx.kind === 'goal-fidelity-wrong',
        }),
      },
    );
    if (result.kind !== 'outcome') return { vetted: false, flagged: false };
    // The per-child signals (incl. the #281 needs-review) live on the LoopReport's
    // integrate Outcome — `result.outcome` is the top-level loop wrapper.
    const signals = (result.data as LoopReport).outcome?.signals ?? [];
    return {
      vetted: result.outcome.status === 'success',
      flagged: signals.some((s) => s.name === 'needs-review'),
    };
  } finally {
    kern.close();
  }
}

describe('golden quality eval-set — VETTED is measurable (#226 item 4)', () => {
  const scratch = loopScratch();

  it('vets GOOD, rejects MECHANICALLY-WRONG, and FLAGS goal-fidelity-wrong via needs-review', async () => {
    const results = new Map<string, EvalResult>();
    for (const fx of FIXTURES) results.set(fx.name, await runFixture(scratch, fx));

    // (1) recall=1: every good deliverable is vetted clean (vetted, no needs-review flag).
    for (const fx of FIXTURES.filter((f) => f.kind === 'good')) {
      expect(results.get(fx.name)?.vetted, `${fx.name} (good) must be vetted`).toBe(true);
      expect(results.get(fx.name)?.flagged, `${fx.name} (good) must not be flagged`).toBe(false);
    }

    // (2) every mechanically-wrong deliverable is rejected by a real gate today.
    for (const fx of FIXTURES.filter((f) => f.kind === 'mechanically-wrong'))
      expect(results.get(fx.name)?.vetted, `${fx.name} (mechanically-wrong) must be rejected`).toBe(
        false,
      );

    // (3) every goal-fidelity-wrong variant is now SURFACED as a needs-review signal
    // (advisory — the run still 'succeeds' mechanically). This is the item-3 WIRING flip.
    for (const fx of FIXTURES.filter((f) => f.kind === 'goal-fidelity-wrong'))
      expect(
        results.get(fx.name)?.flagged,
        `${fx.name} (goal-fidelity-wrong) must surface a needs-review signal`,
      ).toBe(true);

    // (4) the pinned gap: goal-fidelity-wrong variants left UNDETECTED (vetted AND unflagged).
    const undetected = FIXTURES.filter(
      (f) =>
        f.kind === 'goal-fidelity-wrong' &&
        results.get(f.name)?.vetted === true &&
        results.get(f.name)?.flagged === false,
    ).length;
    expect(
      undetected,
      `goal-fidelity-wrong variants the wiring fails to surface — if this rises, fix the fixture/wiring, do NOT raise the baseline`,
    ).toBe(BASELINE_UNDETECTED_GOAL_FIDELITY);
  });
});
