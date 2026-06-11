import { describe, expect, it } from 'vitest';
import type { Brief, Finding, Outcome, TaskContract, Verdict } from '@kernloop/contracts';
import { InMemoryCheckpointStore } from './checkpoints.js';
import { createEngine, type NodeContext, type NodeExecutor } from './engine.js';
import { WorkflowError } from './state.js';

// ── scripted fixtures: honest doubles for the injected work ────────────────

const task: TaskContract = {
  id: 'task-1',
  goal: 'ship the feature',
  constraints: [],
  budget: { tokens: 1000, usd: 1, wallClockMin: 10 },
  evidence: [],
  definitionOfDone: [],
  authorityCeiling: 'suggest',
  overlay: 'repo',
};

const brief = (taskId: string): Brief => ({
  taskId,
  sections: [],
  budget: { allotted: 10, used: 0 },
  compilerVersion: 'scripted-1',
});

const verdict = (taskId: string, gate: string, result: Verdict['result']): Verdict => ({
  taskId,
  gate,
  result,
  confidence: 1,
  findings:
    result === 'approve' || result === 'pass'
      ? []
      : [{ severity: 'error', message: `${gate} found the plan wanting` } satisfies Finding],
  cost: { tokens: 0, usd: 0 },
});

const outcome = (taskId: string): Outcome => ({
  taskId,
  status: 'success',
  signals: [],
  cost: { tokens: 0, usd: 0 },
  traceRef: `trace-${taskId}`,
  distillCandidates: [],
});

const child = (parent: TaskContract, n: number): TaskContract => ({
  ...parent,
  id: `${parent.id}.c${String(n)}`,
  parent: parent.id,
});

/** Scripted executor set: vote follows `voteSeq` (last entry repeats). */
function scripted(voteSeq: Array<Verdict['result']> = ['approve']) {
  let votes = 0;
  const executors: Record<string, NodeExecutor> = {
    frame: () => Promise.resolve(task),
    research: () => Promise.resolve(brief(task.id)),
    plan: () => Promise.resolve(brief(task.id)),
    vote: (_input, ctx) => {
      const result = voteSeq[Math.min(votes, voteSeq.length - 1)] ?? 'approve';
      votes += 1;
      return Promise.resolve(verdict(ctx.taskId, 'vote', result));
    },
    decompose: () => Promise.resolve([child(task, 1), child(task, 2)]),
    implement: (input) => Promise.resolve(outcome((input as TaskContract).id)),
    quality: (_input, ctx) =>
      Promise.resolve(verdict(ctx.child?.id ?? ctx.taskId, 'quality', 'pass')),
    review: (_input, ctx) =>
      Promise.resolve(verdict(ctx.child?.id ?? ctx.taskId, 'review', 'approve')),
    integrate: () => Promise.resolve(outcome(task.id)),
    retrospect: (input) => Promise.resolve(input),
  };
  return executors;
}

/** Wrap executors so every invocation is counted by key. */
function counted(executors: Record<string, NodeExecutor>) {
  const calls: Record<string, number> = {};
  const wrapped = Object.fromEntries(
    Object.entries(executors).map(([key, fn]) => [
      key,
      (input: unknown, ctx: NodeContext) => {
        calls[key] = (calls[key] ?? 0) + 1;
        return fn(input, ctx);
      },
    ]),
  );
  return { executors: wrapped, calls };
}

const names = (trace: readonly { node: string; childId?: string }[]) =>
  trace.map((t) => (t.childId === undefined ? t.node : `${t.node}:${t.childId}`));

// ── the loop ────────────────────────────────────────────────────────────────

describe('the canonical loop, end to end', () => {
  it('runs the full happy path in canonical order and returns the Outcome', async () => {
    const engine = createEngine({
      executors: scripted(),
      checkpoints: new InMemoryCheckpointStore(),
    });
    const result = await engine.run(task);
    expect(result.status).toBe('completed');
    expect(result.outcome).toEqual(outcome(task.id));
    expect(names(result.nodeTrace)).toEqual([
      'frame',
      'research',
      'plan',
      'vote',
      'decompose',
      'implement:task-1.c1',
      'quality:task-1.c1',
      'review:task-1.c1',
      'implement:task-1.c2',
      'quality:task-1.c2',
      'review:task-1.c2',
      'integrate',
      'retrospect',
    ]);
    expect(result.nodeTrace.map((t) => t.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('fan-out trace order is deterministic regardless of executor timing', async () => {
    const slowFirst = scripted();
    slowFirst['implement'] = async (input) => {
      const c = input as TaskContract;
      await new Promise((r) => setTimeout(r, c.id.endsWith('c1') ? 30 : 0));
      return outcome(c.id);
    };
    const engine = createEngine({
      executors: slowFirst,
      checkpoints: new InMemoryCheckpointStore(),
    });
    const first = await engine.run(task);
    const second = await engine.run(task);
    expect(names(first.nodeTrace)).toEqual(names(second.nodeTrace));
    expect(names(first.nodeTrace).indexOf('quality:task-1.c1')).toBeLessThan(
      names(first.nodeTrace).indexOf('implement:task-1.c2'),
    );
  });

  it('aggregates a failed child honestly into integrate input instead of failing the run', async () => {
    let integrateInput: unknown;
    const executors = scripted();
    executors['implement'] = (input) => {
      const c = input as TaskContract;
      if (c.id.endsWith('c1')) return Promise.reject(new Error('sandbox exploded'));
      return Promise.resolve(outcome(c.id));
    };
    executors['integrate'] = (input) => {
      integrateInput = input;
      return Promise.resolve(outcome(task.id));
    };
    const engine = createEngine({ executors, checkpoints: new InMemoryCheckpointStore() });
    const result = await engine.run(task);
    expect(result.status).toBe('completed');
    const results = integrateInput as Array<{
      child: TaskContract;
      verdict?: Verdict;
      error?: string;
    }>;
    expect(results).toHaveLength(2);
    expect(results[0]?.error).toContain('sandbox exploded');
    expect(results[0]?.verdict).toBeUndefined();
    expect(results[1]?.verdict?.result).toBe('pass');
    // The failed child's quality gate never ran — no verdict was fabricated.
    expect(names(result.nodeTrace)).toContain('implement:task-1.c1');
    expect(names(result.nodeTrace)).not.toContain('quality:task-1.c1');
  });
});

describe('the K-bounded vote-iterate cycle [CLM-0043]', () => {
  it('a rejected vote re-enters plan with findings and an incremented iteration, then completes on approval', async () => {
    const findingsSeen: Array<readonly Finding[]> = [];
    const iterations: number[] = [];
    const executors = scripted(['reject', 'approve']);
    const basePlan = executors['plan'];
    executors['plan'] = (input, ctx) => {
      findingsSeen.push(ctx.findings);
      iterations.push(ctx.iteration);
      if (basePlan === undefined) throw new Error('unreachable');
      return basePlan(input, ctx);
    };
    const engine = createEngine({ executors, checkpoints: new InMemoryCheckpointStore() });
    const result = await engine.run(task);
    expect(result.status).toBe('completed');
    expect(names(result.nodeTrace).slice(0, 6)).toEqual([
      'frame',
      'research',
      'plan',
      'vote',
      'plan',
      'vote',
    ]);
    expect(iterations).toEqual([0, 1]);
    expect(findingsSeen[0]).toEqual([]);
    expect(findingsSeen[1]?.map((f) => f.message)).toEqual(['vote found the plan wanting']);
  });

  it('escalates after exhausting K=1 with the accumulated findings', async () => {
    const engine = createEngine({
      executors: scripted(['reject']),
      checkpoints: new InMemoryCheckpointStore(),
      config: { K: 1 },
    });
    const result = await engine.run(task);
    expect(result.status).toBe('escalated');
    expect(result.outcome).toBeUndefined();
    expect(names(result.nodeTrace)).toEqual(['frame', 'research', 'plan', 'vote', 'plan', 'vote']);
    expect(result.findings?.map((f) => f.message)).toEqual([
      'vote found the plan wanting',
      'vote found the plan wanting',
    ]);
  });

  it('escalates after exhausting K=3 re-entries (the spec §6 default)', async () => {
    const { executors, calls } = counted(scripted(['reject']));
    const engine = createEngine({ executors, checkpoints: new InMemoryCheckpointStore() });
    const result = await engine.run(task);
    expect(result.status).toBe('escalated');
    // Initial plan/vote plus exactly K=3 rejected re-entries.
    expect(calls['plan']).toBe(4);
    expect(calls['vote']).toBe(4);
    expect(result.findings).toHaveLength(4);
  });

  it('an abstaining panel does not approve — the rejected edge is taken', async () => {
    const engine = createEngine({
      executors: scripted(['abstain']),
      checkpoints: new InMemoryCheckpointStore(),
      config: { K: 1 },
    });
    const result = await engine.run(task);
    expect(result.status).toBe('escalated');
  });
});

describe('wiring and input validation', () => {
  it('createEngine throws unwired_node when an executable node has no executor', () => {
    const executors = scripted();
    delete executors['integrate'];
    let caught: unknown;
    try {
      createEngine({ executors, checkpoints: new InMemoryCheckpointStore() });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkflowError);
    expect(caught).toMatchObject({ code: 'unwired_node', node: 'integrate' });
  });

  it('run() rejects a non-TaskContract input with a typed invalid_task error', async () => {
    const engine = createEngine({
      executors: scripted(),
      checkpoints: new InMemoryCheckpointStore(),
    });
    await expect(engine.run({ id: 'x' } as TaskContract)).rejects.toMatchObject({
      name: 'WorkflowError',
      code: 'invalid_task',
    });
  });

  it('a failing executor outside the fan-out fails the run with the last checkpoint intact', async () => {
    const store = new InMemoryCheckpointStore();
    const executors = scripted();
    executors['research'] = () => Promise.reject(new Error('search backend down'));
    const engine = createEngine({ executors, checkpoints: store });
    const result = await engine.run(task, { runId: 'run-fail' });
    expect(result.status).toBe('failed');
    expect(result.error).toBeInstanceOf(WorkflowError);
    expect(result.error?.code).toBe('executor_failed');
    expect(result.error?.node).toBe('research');
    expect((await store.latest('run-fail'))?.node).toBe('frame');
  });

  it('a rejected checkpoint save fails the run as checkpoint_failed — resumability is never silently lost', async () => {
    const store = new InMemoryCheckpointStore();
    let saves = 0;
    const failing = {
      save: (record: Parameters<InMemoryCheckpointStore['save']>[0]) => {
        saves += 1;
        return saves > 2 ? Promise.reject(new Error('disk full')) : store.save(record);
      },
      latest: store.latest.bind(store),
      list: store.list.bind(store),
    };
    const engine = createEngine({ executors: scripted(), checkpoints: failing });
    const result = await engine.run(task);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('checkpoint_failed');
    expect(result.nodeTrace).toHaveLength(3);
  });
});
