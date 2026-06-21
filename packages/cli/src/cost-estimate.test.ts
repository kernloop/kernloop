/**
 * Pre-flight call-count estimate (#303, CLM-0138). Two layers of evidence:
 *   1. ARITHMETIC vectors — pin the [min,max] band for explicit shapes (a graph
 *      change that alters the formula breaks these loudly).
 *   2. BOUND TO BEHAVIOR — a REAL hermetic canonical-loop run, counting actual
 *      model calls, must land inside the estimator's band (the #303 vote's
 *      load-bearing condition: prove the estimate matches the loop, not just
 *      itself). The happy path IS the min scenario, so actual === total.min.
 */
import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { estimateLoopCalls, formatEstimate, type LoopShape } from './cost-estimate.js';
import { type LoopInvoke, type LoopReport } from './loop/index.js';
import { runTool } from './tools/run.js';
import {
  GREET_TS,
  fixtureRepo as makeFixtureRepo,
  kernloopFor,
  loopScratch,
  scriptedInvoke,
  typecheck,
} from './loop-fixtures.js';

const DEFAULT: LoopShape = {
  K: 3,
  Kc: 3,
  votePanel: 3,
  reviewPanel: 3,
  reviewDrivesIteration: false,
  parsimonyIntensity: 'full', // the overlay default (#9/#415)
};

describe('estimateLoopCalls — arithmetic band (#303)', () => {
  it('default shape, 1 child: min is the happy path, max assumes full iteration + retry', () => {
    const e = estimateLoopCalls(DEFAULT, { childCount: 1 });
    // min: research1 + plan1 + vote(3×1) + decompose1 + implement(1) + quality0 + review(3×1) + parsimony(2: assessor+verifier) = 12
    expect(e.total.min).toBe(12);
    // max: 1 + plan(K+1=4) + vote(3×4=12) + 1 + implement(2×1×(Kc+1=4)=8) + 0 + review(3×1) + parsimony(at full, 2×(Kc+1=4)=8) = 37
    expect(e.total.max).toBe(37);
    expect(e.perNode.parsimony).toEqual({ min: 2, max: 8 }); // full ENFORCES: re-runs per attempt
    expect(e.perNode.quality).toEqual({ min: 0, max: 0 }); // mechanical, no model call
    expect(e.perNode.vote).toEqual({ min: 3, max: 12 });
  });

  it('scales implement + review linearly with assumed child count', () => {
    const e = estimateLoopCalls(DEFAULT, { childCount: 3 });
    expect(e.perNode.implement).toEqual({ min: 3, max: 24 }); // 3 children × [1, 2×4]
    expect(e.perNode.review).toEqual({ min: 9, max: 9 }); // 3 × 3, review runs once/child
    expect(e.perNode.parsimony).toEqual({ min: 6, max: 24 }); // 3 × [2, 2×(Kc+1=4)] at full
    expect(e.total.min).toBe(24); // 12 happy-path terms but implement+review+parsimony ×3
  });

  it('parsimony intensity gates the parsimony band: off ⇒ 0; lite ⇒ single-pass; full/ultra ⇒ enforce', () => {
    const off = estimateLoopCalls({ ...DEFAULT, parsimonyIntensity: 'off' }, { childCount: 2 });
    expect(off.perNode.parsimony).toEqual({ min: 0, max: 0 }); // the gate does no work
    const lite = estimateLoopCalls({ ...DEFAULT, parsimonyIntensity: 'lite' }, { childCount: 2 });
    expect(lite.perNode.parsimony).toEqual({ min: 4, max: 4 }); // 2/child, single-pass advisory
    const full = estimateLoopCalls({ ...DEFAULT, parsimonyIntensity: 'full' }, { childCount: 2 });
    expect(full.perNode.parsimony).toEqual({ min: 4, max: 16 }); // 2 × [2, 2×(Kc+1=4)]
    const ultra = estimateLoopCalls({ ...DEFAULT, parsimonyIntensity: 'ultra' }, { childCount: 2 });
    expect(ultra.perNode.parsimony).toEqual({ min: 4, max: 16 }); // ultra also enforces
  });

  it('a panel-7 ratification vote widens the vote band', () => {
    const e = estimateLoopCalls({ ...DEFAULT, votePanel: 7 }, { childCount: 1 });
    expect(e.perNode.vote).toEqual({ min: 7, max: 28 }); // 7 × [1, K+1]
  });

  it('groundedness adds a 4th reviewer; reviewDrives multiplies review by Kc+1', () => {
    const grounded = estimateLoopCalls({ ...DEFAULT, reviewPanel: 4 }, { childCount: 1 });
    expect(grounded.perNode.review).toEqual({ min: 4, max: 4 });
    const drives = estimateLoopCalls(
      { ...DEFAULT, reviewDrivesIteration: true },
      { childCount: 2 },
    );
    expect(drives.perNode.review).toEqual({ min: 6, max: 24 }); // 2 × 3 × [1, Kc+1=4]
  });

  it('NEVER invents a dollar figure — the band is calls only, with an explicit-rate note', () => {
    const e = estimateLoopCalls(DEFAULT, { childCount: 1 });
    const text = formatEstimate(e);
    expect(text).toContain('model calls');
    expect(text).toMatch(/no \$ shown/);
    expect(JSON.stringify(e)).not.toMatch(/usd|dollar/i);
  });
});

describe('estimateLoopCalls — BOUND TO real loop behavior (#303 vote condition)', () => {
  const scratch = loopScratch();
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it('a real happy-path canonical-loop run makes exactly total.min model calls, ≤ total.max', async () => {
    const repo = makeFixtureRepo(scratch, 'estimate-bind');
    const kern = kernloopFor(repo);
    let calls = 0;
    const base = scriptedInvoke({
      vote: () => 'approve',
      files: [{ path: 'src/greet.ts', content: GREET_TS }],
    });
    const counting: LoopInvoke = (prompt, options) => {
      calls += 1;
      return base(prompt, options);
    };

    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'est',
      },
      { checks: [typecheck], invoke: counting },
    );
    expect(result.kind).toBe('outcome');
    const report = result.data as LoopReport;
    const childCount = (report.outcome?.signals ?? []).filter((s) =>
      s.name.startsWith('child:'),
    ).length;
    expect(childCount).toBe(1);

    // The default-overlay shape, 1 realized child. The happy path = the MIN row.
    const e = estimateLoopCalls(DEFAULT, { childCount });
    expect(calls).toBe(e.total.min); // exact: research+plan+vote(3)+decompose+implement+review(3)+parsimony(assessor+verifier=2)
    expect(calls).toBeLessThanOrEqual(e.total.max);
    kern.close();
  }, 120_000);
});
