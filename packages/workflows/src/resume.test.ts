/**
 * Per-node checkpoint/resume [CLM-0044] — the load-bearing proof: a run
 * killed mid-loop resumes from its last checkpoint and completes WITHOUT
 * re-running completed nodes (executor call counts assert zero
 * re-executions). Kill/resume test cases ported from v1's graph-executor
 * suite — see PORT-NOTES.md.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Brief, Outcome, TaskContract, Verdict } from '@kernloop/contracts';
import { InMemoryCheckpointStore, JsonlCheckpointStore } from './checkpoints.js';
import { createEngine, type NodeContext, type NodeExecutor } from './engine.js';
import { CheckpointRecordSchema, type CheckpointRecord } from './state.js';

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
  findings: result === 'approve' || result === 'pass' ? [] : [{ severity: 'error', message: 'no' }],
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

function scripted(voteSeq: Array<Verdict['result']> = ['approve']): Record<string, NodeExecutor> {
  let votes = 0;
  return {
    frame: () => Promise.resolve(task),
    research: () => Promise.resolve(brief(task.id)),
    plan: () => Promise.resolve(brief(task.id)),
    vote: (_input, ctx) => {
      const result = voteSeq[Math.min(votes, voteSeq.length - 1)] ?? 'approve';
      votes += 1;
      return Promise.resolve(verdict(ctx.taskId, 'vote', result));
    },
    decompose: () =>
      Promise.resolve([
        { ...task, id: `${task.id}.c1`, parent: task.id },
        { ...task, id: `${task.id}.c2`, parent: task.id },
      ]),
    implement: (input) => Promise.resolve(outcome((input as TaskContract).id)),
    quality: (_input, ctx) =>
      Promise.resolve(verdict(ctx.child?.id ?? ctx.taskId, 'quality', 'pass')),
    integrate: () => Promise.resolve(outcome(task.id)),
    retrospect: (input) => Promise.resolve(input),
  };
}

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

function abortError(): Error {
  const error = new Error('killed');
  error.name = 'AbortError';
  return error;
}

describe('checkpoint content [CLM-0044]', () => {
  it('persists a checkpoint after every node completion with the spec shape', async () => {
    const store = new InMemoryCheckpointStore();
    const engine = createEngine({ executors: scripted(), checkpoints: store });
    await engine.run(task, { runId: 'run-shape' });
    const records = await store.list('run-shape');
    expect(records).toHaveLength(11);
    for (const record of records) {
      expect(() => CheckpointRecordSchema.parse(record)).not.toThrow();
      expect(record.runId).toBe('run-shape');
    }
    expect(records.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const first = records[0] as CheckpointRecord;
    expect(first.node).toBe('frame');
    expect(first.iteration).toBe(0);
    // The persisted state already points PAST the completed node.
    expect(first.state.cursor).toEqual({ phase: 'main', node: 'research' });
    const last = records[10] as CheckpointRecord;
    expect(last.node).toBe('retrospect');
    expect(last.state.status).toBe('completed');
    expect(last.state.cursor).toEqual({ phase: 'done' });
  });
});

describe('kill and resume [CLM-0044]', () => {
  it('a run killed mid-loop resumes from its last checkpoint and completes with zero re-executions', async () => {
    const store = new InMemoryCheckpointStore();
    const killed = scripted();
    killed['integrate'] = () => Promise.reject(abortError());
    const firstResult = await createEngine({ executors: killed, checkpoints: store }).run(task, {
      runId: 'run-kill',
    });
    expect(firstResult.status).toBe('failed');
    expect(firstResult.error?.code).toBe('aborted');
    // The kill left the last checkpoint intact: the final fan-out child.
    expect((await store.latest('run-kill'))?.node).toBe('quality');

    const { executors, calls } = counted(scripted());
    const resumed = await createEngine({ executors, checkpoints: store }).resume('run-kill');
    expect(resumed.status).toBe('completed');
    expect(resumed.outcome).toEqual(outcome(task.id));
    // Zero re-executions of completed nodes: only the killed node onward ran.
    expect(calls).toEqual({ integrate: 1, retrospect: 1 });
    // The resumed trace is the FULL history: prior nodes kept, none re-run.
    expect(resumed.nodeTrace.map((t) => t.node)).toEqual([
      'frame',
      'research',
      'plan',
      'vote',
      'decompose',
      'implement',
      'quality',
      'implement',
      'quality',
      'integrate',
      'retrospect',
    ]);
  });

  it('an abort signal mid-run leaves the last checkpoint intact and resumable', async () => {
    const store = new InMemoryCheckpointStore();
    const controller = new AbortController();
    const executors = scripted();
    executors['plan'] = () => {
      controller.abort();
      return Promise.resolve(brief(task.id));
    };
    const result = await createEngine({ executors, checkpoints: store }).run(task, {
      runId: 'run-signal',
      signal: controller.signal,
    });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('aborted');
    expect((await store.latest('run-signal'))?.node).toBe('plan');

    const { executors: fresh, calls } = counted(scripted());
    const resumed = await createEngine({ executors: fresh, checkpoints: store }).resume(
      'run-signal',
    );
    expect(resumed.status).toBe('completed');
    expect(calls['frame']).toBeUndefined();
    expect(calls['research']).toBeUndefined();
    expect(calls['plan']).toBeUndefined();
    expect(calls['vote']).toBe(1);
  });

  it('survives a process death: a fresh engine over a fresh jsonl store resumes from disk', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'kernloop-wf-')), 'checkpoints.jsonl');
    const killed = scripted();
    killed['decompose'] = () => Promise.reject(abortError());
    const first = await createEngine({
      executors: killed,
      checkpoints: new JsonlCheckpointStore(file),
    }).run(task, { runId: 'run-disk' });
    expect(first.status).toBe('failed');

    // Everything is rebuilt from the file — nothing shared in memory.
    const { executors, calls } = counted(scripted());
    const resumed = await createEngine({
      executors,
      checkpoints: new JsonlCheckpointStore(file),
    }).resume('run-disk');
    expect(resumed.status).toBe('completed');
    expect(calls['frame']).toBeUndefined();
    expect(calls['vote']).toBeUndefined();
    expect(calls['decompose']).toBe(1);
  });

  it('resuming a completed run returns the same result without executing anything', async () => {
    const store = new InMemoryCheckpointStore();
    const first = await createEngine({ executors: scripted(), checkpoints: store }).run(task, {
      runId: 'run-done',
    });
    const { executors, calls } = counted(scripted());
    const again = await createEngine({ executors, checkpoints: store }).resume('run-done');
    expect(again.status).toBe('completed');
    expect(again.outcome).toEqual(first.outcome);
    expect(calls).toEqual({});
  });

  it('resume of an unknown runId throws a typed no_checkpoint error', async () => {
    const engine = createEngine({
      executors: scripted(),
      checkpoints: new InMemoryCheckpointStore(),
    });
    await expect(engine.resume('never-ran')).rejects.toMatchObject({
      name: 'WorkflowError',
      code: 'no_checkpoint',
    });
  });

  it('resume of a checkpoint whose state does not parse throws corrupt_checkpoint', async () => {
    const store = new InMemoryCheckpointStore();
    await store.save({
      runId: 'run-corrupt',
      seq: 1,
      node: 'frame',
      iteration: 0,
      state: { mangled: true },
      createdAt: new Date().toISOString(),
    } as unknown as CheckpointRecord);
    const engine = createEngine({ executors: scripted(), checkpoints: store });
    await expect(engine.resume('run-corrupt')).rejects.toMatchObject({
      code: 'corrupt_checkpoint',
    });
  });
});

describe('resume after escalation [CLM-0043]', () => {
  it('resume after escalation continues from plan with a fresh iteration budget', async () => {
    const store = new InMemoryCheckpointStore();
    // K=1 and a vote that rejects twice then approves: the run escalates
    // first; after the human edit, resume re-plans and completes.
    const voteSeq: Array<Verdict['result']> = ['reject', 'reject', 'approve'];
    const { executors, calls } = counted(scripted(voteSeq));
    const engine = createEngine({ executors, checkpoints: store, config: { K: 1 } });
    const halted = await engine.run(task, { runId: 'run-esc' });
    expect(halted.status).toBe('escalated');
    expect(halted.findings).toHaveLength(2);
    expect(calls['plan']).toBe(2);

    const iterations: number[] = [];
    const basePlan = executors['plan'] as NodeExecutor;
    executors['plan'] = (input, ctx) => {
      iterations.push(ctx.iteration);
      return basePlan(input, ctx);
    };
    const resumed = await engine.resume('run-esc');
    expect(resumed.status).toBe('completed');
    // Continues from plan: frame/research are NOT re-run.
    expect(calls['frame']).toBe(1);
    expect(calls['research']).toBe(1);
    // Fresh K budget after the human edit: iteration restarts at 0.
    expect(iterations).toEqual([0]);
    expect(resumed.nodeTrace.filter((t) => t.node === 'plan')).toHaveLength(3);
  });
});
