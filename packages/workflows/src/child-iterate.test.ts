/**
 * Review-driven child iteration [CLM-0043] + runtime budget mode [CLM-0077].
 * The actor-critic inner loop MIRRORS the vote→plan back-edge: a quality
 * reject re-runs implement within Kc, folding findings into the coder's next
 * attempt; at the bound the child escalates WITHOUT failing its siblings or the
 * run. Budget: an enforce-mode run that overspends halts (escalates, resumable);
 * an unlimited run never halts on budget but still tracks/reports cost; Kc still
 * bounds child iteration in unlimited mode. Resume mid-child-iteration re-runs
 * nothing finished.
 */
import { describe, expect, it } from 'vitest';
import type { Finding, TaskContract, Verdict } from '@kernloop/contracts';
import { InMemoryCheckpointStore } from './checkpoints.js';
import { createEngine, type ChildIterateEvent, type NodeExecutor } from './engine.js';
import { counted, names, outcome, scripted, task, verdict } from './engine-testkit.js';

describe('review-driven child iteration [CLM-0043]', () => {
  it('a quality reject re-runs implement once with the findings folded, then passes', async () => {
    const { executors, qualityCalls, implementCtx } = scripted({ 'task-1.c1': ['fail', 'pass'] });
    const iterations: ChildIterateEvent[] = [];
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      onChildIterate: (e) => iterations.push(e),
    }).run(task);

    expect(result.status).toBe('completed');
    // c1 implemented TWICE (re-run on the quality fail), c2 once.
    const c1Implements = implementCtx.filter((c) => c.childId === 'task-1.c1');
    expect(c1Implements).toHaveLength(2);
    // First attempt saw no findings; the re-run saw the quality finding folded.
    expect(c1Implements[0]?.findings).toEqual([]);
    expect(c1Implements[0]?.iteration).toBe(0);
    expect(c1Implements[1]?.findings.map((f) => f.message)).toEqual([
      'quality wants task-1.c1 fixed',
    ]);
    expect(c1Implements[1]?.iteration).toBe(1);
    // The trace shows implement→quality twice for c1 before c2.
    expect(names(result.nodeTrace)).toEqual([
      'frame',
      'research',
      'plan',
      'vote',
      'decompose',
      'implement:task-1.c1',
      'quality:task-1.c1',
      'implement:task-1.c1',
      'quality:task-1.c1',
      'review:task-1.c1',
      'parsimony:task-1.c1',
      'implement:task-1.c2',
      'quality:task-1.c2',
      'review:task-1.c2',
      'parsimony:task-1.c2',
      'integrate',
      'retrospect',
    ]);
    expect(qualityCalls['task-1.c1']).toBe(2);
    // The audit hook recorded the re-entry.
    expect(iterations).toEqual([
      { childId: 'task-1.c1', iteration: 1, gate: 'quality', findingCount: 1 },
    ]);
  });

  it('a child failing Kc times escalates WITHOUT failing its sibling or the run', async () => {
    let integrateInput: unknown;
    const { executors, qualityCalls } = scripted({ 'task-1.c1': ['fail'] }); // always fails
    executors['integrate'] = (input) => {
      integrateInput = input;
      return Promise.resolve(outcome(task.id));
    };
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      config: { Kc: 2 },
    }).run(task);

    // The run COMPLETES (one stuck child does not sink the sprint).
    expect(result.status).toBe('completed');
    // c1: initial implement + Kc=2 re-runs = 3 implement/quality attempts.
    expect(qualityCalls['task-1.c1']).toBe(3);
    const results = integrateInput as Array<{
      child: TaskContract;
      escalated?: boolean;
      findings: Finding[];
      verdict?: Verdict;
    }>;
    const c1 = results.find((r) => r.child.id === 'task-1.c1');
    const c2 = results.find((r) => r.child.id === 'task-1.c2');
    expect(c1?.escalated).toBe(true);
    expect(c1?.findings.length).toBe(3); // one finding per failing attempt
    // The sibling is untouched: it passed normally.
    expect(c2?.escalated).toBeUndefined();
    expect(c2?.verdict?.result).toBe('pass');
  });

  it('a quality `escalate` stops the child for a human IMMEDIATELY — regardless of Kc (#192)', async () => {
    let integrateInput: unknown;
    // The child's quality gate ESCALATES on the first attempt; Kc=3 would allow
    // re-runs, but an escalate verdict asks a human now — no re-iteration.
    const { executors, qualityCalls } = scripted({ 'task-1.c1': ['escalate'] });
    executors['integrate'] = (input) => {
      integrateInput = input;
      return Promise.resolve(outcome(task.id));
    };
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      config: { Kc: 3 },
    }).run(task);

    expect(result.status).toBe('completed'); // one escalated child does not sink the run
    // c1 ran quality exactly ONCE — escalate skipped the Kc=3 re-run headroom.
    expect(qualityCalls['task-1.c1']).toBe(1);
    expect(names(result.nodeTrace).filter((n) => n === 'implement:task-1.c1')).toHaveLength(1);
    const results = integrateInput as Array<{
      child: TaskContract;
      escalated?: boolean;
      verdict?: Verdict;
    }>;
    const c1 = results.find((r) => r.child.id === 'task-1.c1');
    expect(c1?.escalated).toBe(true);
    expect(c1?.verdict?.result).toBe('escalate');
  });

  it('the review gate is advisory: a rejecting review does NOT re-run implement by default', async () => {
    const { executors, qualityCalls } = scripted({ 'task-1.c1': ['pass'] });
    executors['review'] = (_i, ctx) =>
      Promise.resolve(verdict(ctx.child?.id ?? ctx.taskId, 'review', 'reject'));
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
    }).run(task);
    expect(result.status).toBe('completed');
    // Quality passed once; the rejecting review did NOT trigger a re-implement.
    expect(qualityCalls['task-1.c1']).toBe(1);
    expect(names(result.nodeTrace).filter((n) => n === 'implement:task-1.c1')).toHaveLength(1);
  });

  it('review findings fold into the next attempt as hints when quality also rejects', async () => {
    const { executors, implementCtx } = scripted({ 'task-1.c1': ['fail', 'pass'] });
    executors['review'] = (_i, ctx) =>
      Promise.resolve(verdict(ctx.child?.id ?? ctx.taskId, 'review', 'reject'));
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
    }).run(task);
    expect(result.status).toBe('completed');
    // The c1 re-run sees the quality finding (review ran AFTER the re-iterate so
    // it does not appear on THIS attempt — quality drives the re-entry).
    const reRun = implementCtx.filter((c) => c.childId === 'task-1.c1')[1];
    expect(reRun?.findings.map((f) => f.message)).toContain('quality wants task-1.c1 fixed');
  });

  it('with reviewDrivesIteration on (review at enforce), a review reject re-runs implement', async () => {
    const { executors, qualityCalls } = scripted({ 'task-1.c1': ['pass'] });
    let reviews = 0;
    executors['review'] = (_i, ctx) => {
      reviews += 1;
      // First review rejects, second approves.
      return Promise.resolve(
        verdict(ctx.child?.id ?? ctx.taskId, 'review', reviews === 1 ? 'reject' : 'approve'),
      );
    };
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      config: { reviewDrivesIteration: true },
    }).run(task);
    expect(result.status).toBe('completed');
    // Review drove a re-implement: quality ran twice for c1.
    expect(qualityCalls['task-1.c1']).toBe(2);
  });

  it('a review-driven reject SKIPS the downstream parsimony gate on that pass — no wasted assessor call (#427)', async () => {
    // #427: parsimony sits AFTER review in the child sub-chain. When review drives
    // iteration (enforce) and REJECTS, the back-edge re-iterates the child BEFORE the
    // cursor reaches the parsimony sub-node, so parsimony never spends a model call on a
    // child that is about to re-run. It runs ONLY on the passing-review pass.
    const { executors, qualityCalls } = scripted({ 'task-1.c1': ['pass'] });
    let reviews = 0;
    executors['review'] = (_i, ctx) => {
      reviews += 1;
      // c1: first review rejects (→ re-iterate), second approves; c2 approves.
      return Promise.resolve(
        verdict(ctx.child?.id ?? ctx.taskId, 'review', reviews === 1 ? 'reject' : 'approve'),
      );
    };
    let parsimonyCalls = 0;
    executors['parsimony'] = (_i, ctx) => {
      parsimonyCalls += 1;
      return Promise.resolve(verdict(ctx.child?.id ?? ctx.taskId, 'parsimony', 'pass'));
    };
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      config: { reviewDrivesIteration: true },
    }).run(task);

    expect(result.status).toBe('completed');
    expect(qualityCalls['task-1.c1']).toBe(2); // review drove a c1 re-implement
    // The rejected pass spent NO parsimony call: c1 runs parsimony once (the approving
    // pass) + c2 once = 2, never 3.
    expect(parsimonyCalls).toBe(2);
    // The trace proves the skip: the first review:c1 (the reject) is followed directly
    // by implement:c1 (the re-run) — there is NO parsimony:c1 in between.
    const trace = names(result.nodeTrace);
    const firstReviewC1 = trace.indexOf('review:task-1.c1');
    expect(trace[firstReviewC1 + 1]).toBe('implement:task-1.c1');
    // Exactly one parsimony entry per child overall (only the passes that reached it).
    expect(trace.filter((n) => n === 'parsimony:task-1.c1')).toHaveLength(1);
  });

  it('with parsimonyDrivesIteration on (intensity full/ultra), a parsimony reject re-runs implement (#9/#415)', async () => {
    const { executors, qualityCalls } = scripted({ 'task-1.c1': ['pass'] });
    let parsimonies = 0;
    executors['parsimony'] = (_i, ctx) => {
      parsimonies += 1;
      // First parsimony rejects (a refute), second passes.
      return Promise.resolve(
        verdict(ctx.child?.id ?? ctx.taskId, 'parsimony', parsimonies === 1 ? 'reject' : 'pass'),
      );
    };
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      config: { parsimonyDrivesIteration: true },
    }).run(task);
    expect(result.status).toBe('completed');
    // Parsimony drove a re-implement for c1: quality (and the whole sub-chain) ran twice.
    expect(qualityCalls['task-1.c1']).toBe(2);
    // c1 parsimony ran twice (reject then pass) + c2 once = 3 total.
    expect(parsimonies).toBe(3);
  });

  it('with parsimonyDrivesIteration OFF (intensity lite), a parsimony reject does NOT re-run implement', async () => {
    const { executors, qualityCalls } = scripted({ 'task-1.c1': ['pass'] });
    executors['parsimony'] = (_i, ctx) =>
      // A rejecting parsimony verdict — but lite is advisory, so it must NOT re-iterate.
      Promise.resolve(verdict(ctx.child?.id ?? ctx.taskId, 'parsimony', 'reject'));
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      config: { parsimonyDrivesIteration: false },
    }).run(task);
    expect(result.status).toBe('completed');
    // No re-implement: quality ran exactly once for c1 (the parsimony reject folded in as a hint).
    expect(qualityCalls['task-1.c1']).toBe(1);
  });

  it('a persistently-refuting child (YAGNI-dropped AC-3/SI-10 control) FAILS its iteration at Kc [PT-001/CLM-0178]', async () => {
    // The loop-level consequence of the PT-001 attack: a child whose diff drops a
    // control and whose parsimony gate REFUTES on every attempt (never fixed) burns
    // its Kc budget and ESCALATES — it never integrates a control-floor violation.
    // Mirrors the quality-reject Kc-exhaustion pattern; the engine routes parsimony
    // through the SAME child-iterate back-edge when parsimonyDrivesIteration is on.
    let integrateInput: unknown;
    const { executors } = scripted({ 'task-1.c1': ['pass'] }); // quality is clean
    const parsimonies: Record<string, number> = {};
    executors['parsimony'] = (_i, ctx) => {
      const id = ctx.child?.id ?? ctx.taskId;
      parsimonies[id] = (parsimonies[id] ?? 0) + 1;
      // c1 ALWAYS refutes (the dropped AC-3/SI-10 control is never added back); c2 is clean.
      return Promise.resolve(verdict(id, 'parsimony', id === 'task-1.c1' ? 'reject' : 'pass'));
    };
    executors['integrate'] = (input) => {
      integrateInput = input;
      return Promise.resolve(outcome(task.id));
    };
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      config: { Kc: 2, parsimonyDrivesIteration: true },
    }).run(task);

    expect(result.status).toBe('completed'); // one stuck child does not sink the sprint
    // c1 parsimony: initial + Kc=2 re-runs = 3 attempts, all refuting.
    expect(parsimonies['task-1.c1']).toBe(3);
    const results = integrateInput as Array<{
      child: TaskContract;
      escalated?: boolean;
      verdict?: Verdict;
      parsimonyVerdict?: Verdict;
    }>;
    const c1 = results.find((r) => r.child.id === 'task-1.c1');
    const c2 = results.find((r) => r.child.id === 'task-1.c2');
    // The control-violating child FAILED its iteration: escalated, never a clean pass.
    expect(c1?.escalated).toBe(true);
    expect(c1?.parsimonyVerdict?.result).toBe('reject');
    // The clean sibling is untouched.
    expect(c2?.escalated).toBeUndefined();
    expect(c2?.parsimonyVerdict?.result).toBe('pass');
  });

  it('a parsimony escalate verdict halts the child immediately — NOT a re-attempt (#192)', async () => {
    const { executors, qualityCalls, implementCtx } = scripted({ 'task-1.c1': ['pass'] });
    executors['parsimony'] = (_i, ctx) =>
      Promise.resolve(verdict(ctx.child?.id ?? ctx.taskId, 'parsimony', 'escalate'));
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      config: { parsimonyDrivesIteration: true },
    }).run(task);
    // An escalate verdict from a driving gate escalates the child WITHOUT re-running
    // implement (a human ruling is not a re-attempt, #192) — distinct from a reject,
    // which DOES re-iterate. c1 implemented exactly once; an escalated child does not
    // sink its siblings, so the run still finishes.
    expect(implementCtx.filter((c) => c.childId === 'task-1.c1')).toHaveLength(1);
    expect(qualityCalls['task-1.c1']).toBe(1);
    expect(result.status).toBe('completed');
  });
});

describe('resume mid-child-iteration [CLM-0044]', () => {
  it('a kill mid-child-iteration resumes and completes with zero re-executions of finished sub-nodes', async () => {
    const store = new InMemoryCheckpointStore();
    // c1 fails quality once (forcing a re-iterate), then passes. Kill the run on
    // the SECOND implement of c1 (the re-run), then resume.
    const first = scripted({ 'task-1.c1': ['fail', 'pass'] });
    let c1Implements = 0;
    const baseImpl = first.executors['implement'] as NodeExecutor;
    first.executors['implement'] = (input, ctx) => {
      const c = input as TaskContract;
      if (c.id === 'task-1.c1') {
        c1Implements += 1;
        if (c1Implements === 2) {
          const err = new Error('killed mid re-iteration');
          err.name = 'AbortError';
          return Promise.reject(err);
        }
      }
      return baseImpl(input, ctx);
    };
    const killed = await createEngine({ executors: first.executors, checkpoints: store }).run(
      task,
      {
        runId: 'run-iter-kill',
      },
    );
    expect(killed.status).toBe('failed');
    // The last checkpoint is the first quality:c1 (which set the re-iterate cursor).
    const latest = await store.latest('run-iter-kill');
    expect(latest?.state.cursor).toMatchObject({ phase: 'fanout' });
    // The child already recorded its iteration + folded finding before the kill.
    const c1 = latest?.state.childResults.find((r) => r.child.id === 'task-1.c1');
    expect(c1?.iteration).toBe(1);
    expect(c1?.findings).toHaveLength(1);

    const { executors, calls } = counted(scripted({ 'task-1.c1': ['pass'] }).executors);
    const resumed = await createEngine({ executors, checkpoints: store }).resume('run-iter-kill');
    expect(resumed.status).toBe('completed');
    // frame/research/plan/vote/decompose and the FIRST c1 implement+quality did
    // NOT re-run — only the re-iteration implement onward.
    expect(calls['frame']).toBeUndefined();
    expect(calls['decompose']).toBeUndefined();
    // c1 re-implement (1) + c2 implement (1) = 2 implements after resume.
    expect(calls['implement']).toBe(2);
  });
});
