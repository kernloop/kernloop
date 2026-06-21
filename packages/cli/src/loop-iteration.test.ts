/**
 * Review-driven child iteration + budget mode, end to end [CLM-0043, CLM-0077]:
 * the actor-critic inner loop and the runtime budget guard driven through the
 * real `run` tool over a real git repo with a real tsc quality gate. A child
 * whose quality fails re-runs implement with the findings folded into the coder
 * prompt; a persistently-broken child escalates at the bound without sinking the
 * run; an unlimited run blows the nominal budget yet completes and still reports
 * full cost (recorded honestly); an enforce run halts on overspend and resumes.
 */
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type LoopInvoke, type LoopReport } from './loop/index.js';
import { runTool } from './tools/run.js';
import { readEnvelopes } from './tools/audit.js';
import {
  BROKEN_TS,
  COST,
  GREET_TS,
  fixtureRepo as makeFixtureRepo,
  kernloopFor,
  loopScratch,
  typecheck,
} from './loop-fixtures.js';

const scratch = loopScratch();
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Build a fixture repo under this file's scratch dir. */
const fixtureRepo = (name: string, overlayYaml?: string): string =>
  makeFixtureRepo(scratch, name, overlayYaml);

/**
 * A scripted invoke whose coder serves a BROKEN file on the first attempt and a
 * FIXED file on every later attempt, capturing each coder prompt so a test can
 * assert the quality findings were folded into the re-run [CLM-0043].
 */
/** A clean parsimony assessment (rung 1 stdlib, no applicable floor entry but intent). */
const CLEAN_PARSIMONY = JSON.stringify({
  rung: 1,
  signals: { need: true, stdlib: true, native: false, dep: false, oneLine: false },
  floorContext: {
    crossesTrustBoundary: false,
    risksDataLoss: false,
    enforcesAccess: false,
    hasUserInterface: false,
    acts: false,
    wasRequested: true,
  },
  satisfied: { intent: true },
  rationale: 'a small typed function reusing the stdlib',
});

/** The blind verifier (#413) confirms the claimed-pass guard for the clean diff. */
const CLEAN_VERIFY = JSON.stringify({ status: 'confirmed', refutedChecks: [], reason: 'ok' });

function iteratingInvoke(captured: string[]): LoopInvoke {
  let coderCalls = 0;
  return (prompt) => {
    if (prompt.includes('BLIND PARSIMONY VERIFIER')) {
      return Promise.resolve({ output: CLEAN_VERIFY, cost: COST });
    }
    if (prompt.includes('PARSIMONY ASSESSOR')) {
      return Promise.resolve({ output: CLEAN_PARSIMONY, cost: COST });
    }
    if (prompt.includes('Diff under review')) {
      return Promise.resolve({
        output: JSON.stringify({ findings: [], summary: 'ok' }),
        cost: COST,
      });
    }
    if (prompt.includes('Investigate the prior art')) {
      return Promise.resolve({ output: 'Research: small typed function.', cost: COST });
    }
    if (prompt.includes('Proposal under vote')) {
      return Promise.resolve({
        output: JSON.stringify({ vote: 'approve', reasoning: 'sound plan' }),
        cost: COST,
      });
    }
    if (prompt.includes('"subtasks"')) {
      return Promise.resolve({
        output: JSON.stringify({
          subtasks: [
            {
              goal: 'implement greet',
              budget: { tokens: 1_000, usd: 0.01, wallClockMin: 5 },
              assignTo: 'coder',
            },
          ],
        }),
        cost: COST,
      });
    }
    if (prompt.includes('"files"')) {
      captured.push(prompt);
      coderCalls += 1;
      const content = coderCalls === 1 ? BROKEN_TS : GREET_TS;
      return Promise.resolve({
        output: JSON.stringify({ files: [{ path: 'src/greet.ts', content }], notes: 'greet' }),
        cost: COST,
      });
    }
    return Promise.resolve({ output: 'Plan: add greet().', cost: COST });
  };
}

describe('review-driven child iteration, end to end [CLM-0043]', () => {
  it('a child whose quality fails once then passes re-runs implement with the findings folded into the coder prompt', async () => {
    const repo = fixtureRepo('iterate-pass', 'id: fixture-iterate\nKc: 2\n');
    const kern = kernloopFor(repo);
    const coderPrompts: string[] = [];

    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'task-iter',
      },
      { checks: [typecheck], invoke: iteratingInvoke(coderPrompts) },
    );

    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    // The child recovered: the loop SUCCEEDS after the re-iteration.
    expect(result.outcome.status).toBe('success');
    const report = result.data as LoopReport;
    // implement ran twice for the child before quality finally passed.
    expect(report.nodeTrace.filter((t) => t.node === 'implement')).toHaveLength(2);
    expect(report.nodeTrace.filter((t) => t.node === 'quality')).toHaveLength(2);
    // The first coder prompt had no folded findings; the re-run carried the
    // quality gate's findings under the "fix every one" instruction.
    expect(coderPrompts).toHaveLength(2);
    expect(coderPrompts[0]).not.toContain('previous attempt failed');
    expect(coderPrompts[1]).toContain('Your previous attempt failed these checks — fix every one');
    // The hash chain recorded the single re-entry.
    const iterateEvents = readEnvelopes(kern.paths.audit).filter(
      (e) => e.type === 'loop.child.iterate',
    );
    expect(iterateEvents).toHaveLength(1);
    expect(iterateEvents[0]?.payload).toMatchObject({
      childId: 'task-iter.1',
      iteration: 1,
      gate: 'quality',
    });
    // The fixed file is what landed in the real repo.
    expect(readFileSync(path.join(repo, 'src', 'greet.ts'), 'utf8')).toBe(GREET_TS);
    kern.close();
  }, 120_000);
});

/**
 * A scripted invoke whose PM decomposes into a child with a TINY budget, so a
 * small parent budget still satisfies the decompose budget-sum invariant
 * (CLM-0041) while leaving the RUNTIME metered spend free to exceed it — the
 * setup the runtime budget guard [CLM-0077] is meant to catch.
 */
function smallBudgetInvoke(): LoopInvoke {
  return (prompt) => {
    if (prompt.includes('BLIND PARSIMONY VERIFIER')) {
      return Promise.resolve({ output: CLEAN_VERIFY, cost: COST });
    }
    if (prompt.includes('PARSIMONY ASSESSOR')) {
      return Promise.resolve({ output: CLEAN_PARSIMONY, cost: COST });
    }
    if (prompt.includes('Diff under review')) {
      return Promise.resolve({
        output: JSON.stringify({ findings: [], summary: 'ok' }),
        cost: COST,
      });
    }
    if (prompt.includes('Investigate the prior art')) {
      return Promise.resolve({ output: 'Research: small typed function.', cost: COST });
    }
    if (prompt.includes('Proposal under vote')) {
      return Promise.resolve({
        output: JSON.stringify({ vote: 'approve', reasoning: 'sound plan' }),
        cost: COST,
      });
    }
    if (prompt.includes('"subtasks"')) {
      return Promise.resolve({
        output: JSON.stringify({
          subtasks: [
            {
              goal: 'implement greet',
              budget: { tokens: 5, usd: 0.0005, wallClockMin: 1 },
              assignTo: 'coder',
            },
          ],
        }),
        cost: COST,
      });
    }
    if (prompt.includes('"files"')) {
      return Promise.resolve({
        output: JSON.stringify({
          files: [{ path: 'src/greet.ts', content: GREET_TS }],
          notes: 'g',
        }),
        cost: COST,
      });
    }
    return Promise.resolve({ output: 'Plan: add greet().', cost: COST });
  };
}

describe('budget mode + always-on reporting [CLM-0077]', () => {
  it('an UNLIMITED run that exceeds the nominal budget COMPLETES, still reports full cost, and is recorded as unlimited', async () => {
    // A tiny budget the run will blow past; --unlimited lifts the restriction.
    const repo = fixtureRepo('unlimited', 'id: fixture-unlimited\n');
    const kern = kernloopFor(repo);
    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'task-unlimited',
        // Parent budget large enough for decompose (child = 5 tokens) but far
        // below the run's total metered spend (~10 model calls × 7 tokens).
        budget: { tokens: 30, usd: 0.01, wallClockMin: 10 },
        unlimited: true,
      },
      { checks: [typecheck], invoke: smallBudgetInvoke() },
    );

    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    // The run COMPLETES despite blowing the nominal budget (no halt).
    const report = result.data as LoopReport;
    expect(report.status).toBe('completed');
    expect(report.unlimited).toBe(true);
    // Always-on reporting: full metered cost is present in unlimited mode.
    expect(report.cost.tokens).toBeGreaterThan(1);
    // The Outcome records the unlimited fact honestly.
    expect(result.outcome.signals.some((s) => s.name === 'loop:budget')).toBe(true);
    // The audit chain records the loop.unlimited event.
    const unlimitedEvents = readEnvelopes(kern.paths.audit).filter(
      (e) => e.type === 'loop.unlimited',
    );
    expect(unlimitedEvents).toHaveLength(1);
    expect(unlimitedEvents[0]?.payload).toMatchObject({ taskId: 'task-unlimited' });
    kern.close();
  }, 120_000);

  it('a bounded (enforce) run that exceeds its budget escalates and is resumable, never silently continuing', async () => {
    const repo = fixtureRepo('enforce-halt', 'id: fixture-enforce\n');
    const kern = kernloopFor(repo);
    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'task-enforce',
        // Decompose passes (child = 5 tokens ≤ 30) but the run's metered spend
        // climbs past 30 mid-loop, tripping the enforce-mode halt.
        budget: { tokens: 30, usd: 0.01, wallClockMin: 10 },
      },
      { checks: [typecheck], invoke: smallBudgetInvoke() },
    );

    // The run HALTED as escalated (resumable), not completed.
    expect(result.kind).toBe('escalated');
    if (result.kind !== 'escalated') throw new Error('expected escalation');
    expect(result.findings.some((f) => f.message.includes('exceeded its budget'))).toBe(true);
    const report = result.data as LoopReport;
    expect(report.status).toBe('escalated');
    expect(report.unlimited).toBe(false);
    // Cost is still reported in enforce mode (always-on tracking).
    expect(report.cost.tokens).toBeGreaterThan(0);

    // Resumable: re-running --unlimited from the same checkpoint lifts the halt
    // and the run completes from where spend tripped the limit (no re-run of
    // finished nodes — the engine's checkpoint discipline [CLM-0044]).
    const resumed = await runTool(
      kern,
      {
        capability: 'workflow.canonical',
        resume: report.runId,
        workspaceDir: repo,
        unlimited: true,
      },
      { checks: [typecheck], invoke: smallBudgetInvoke() },
    );
    expect(resumed.kind).toBe('outcome');
    if (resumed.kind !== 'outcome') throw new Error('expected outcome');
    const resumedReport = resumed.data as LoopReport;
    expect(resumedReport.status).toBe('completed');
    expect(resumedReport.unlimited).toBe(true);
    kern.close();
  }, 120_000);
});
