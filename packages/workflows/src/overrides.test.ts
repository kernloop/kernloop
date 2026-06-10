/**
 * Edge-contract enforcement [CLM-0042] and overlay-shaped overrides
 * [CLM-0045]: the SAME frozen CANONICAL_LOOP, different config, different
 * execution trace — the graph is never duplicated.
 */
import { describe, expect, it } from 'vitest';
import type { Brief, Outcome, TaskContract, Verdict } from '@kernloop/contracts';
import { InMemoryCheckpointStore } from './checkpoints.js';
import { createEngine, EngineConfigSchema, type NodeExecutor } from './engine.js';
import { CANONICAL_LOOP } from './graph.js';

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

function scripted(): Record<string, NodeExecutor> {
  return {
    frame: () => Promise.resolve(task),
    research: () => Promise.resolve(brief(task.id)),
    plan: () => Promise.resolve(brief(task.id)),
    vote: (_input, ctx) => Promise.resolve(verdict(ctx.taskId, 'vote', 'approve')),
    decompose: () => Promise.resolve([{ ...task, id: `${task.id}.c1`, parent: task.id }]),
    implement: (input) => Promise.resolve(outcome((input as TaskContract).id)),
    quality: (_input, ctx) =>
      Promise.resolve(verdict(ctx.child?.id ?? ctx.taskId, 'quality', 'pass')),
    integrate: () => Promise.resolve(outcome(task.id)),
    retrospect: (input) => Promise.resolve(input),
  };
}

const names = (trace: readonly { node: string; childId?: string }[]) =>
  trace.map((t) => (t.childId === undefined ? t.node : `${t.node}:${t.childId}`));

describe('edge-contract enforcement [CLM-0042]', () => {
  it('rejects a malformed Verdict at the vote edge with a typed error naming node and contract', async () => {
    const executors = scripted();
    executors['vote'] = () => Promise.resolve({ looksLike: 'a verdict', but: 'is not' });
    const engine = createEngine({ executors, checkpoints: new InMemoryCheckpointStore() });
    const result = await engine.run(task);
    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({
      name: 'WorkflowError',
      code: 'edge_contract',
      node: 'vote',
      contract: 'Verdict',
    });
  });

  it('rejects a malformed child TaskContract at the decompose edge', async () => {
    const executors = scripted();
    executors['decompose'] = () => Promise.resolve([{ id: 'half-a-task' }]);
    const engine = createEngine({ executors, checkpoints: new InMemoryCheckpointStore() });
    const result = await engine.run(task);
    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({
      code: 'edge_contract',
      node: 'decompose',
      contract: 'TaskContract',
    });
  });

  it('rejects a malformed quality Verdict inside the fan-out as a run failure, not a child failure', async () => {
    const executors = scripted();
    executors['quality'] = () => Promise.resolve('LGTM');
    const engine = createEngine({ executors, checkpoints: new InMemoryCheckpointStore() });
    const result = await engine.run(task);
    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({
      code: 'edge_contract',
      node: 'quality',
      contract: 'Verdict',
    });
  });
});

describe('overlay-shaped overrides against the same graph [CLM-0045]', () => {
  it('a gate override changes the executed gate against the same canonical graph', async () => {
    const baseline = scripted();
    baseline['vote'] = (_i, ctx) => Promise.resolve(verdict(ctx.taskId, 'vote', 'reject'));
    const swapped = { ...baseline, ratify: scripted()['vote'] as NodeExecutor };

    const without = await createEngine({
      executors: baseline,
      checkpoints: new InMemoryCheckpointStore(),
      config: { K: 1 },
    }).run(task);
    const withOverride = await createEngine({
      executors: swapped,
      checkpoints: new InMemoryCheckpointStore(),
      config: { K: 1, nodeOverrides: { vote: { gate: 'ratify' } } },
    }).run(task);

    // Same frozen graph object, different config, different execution trace.
    expect(Object.isFrozen(CANONICAL_LOOP)).toBe(true);
    expect(without.status).toBe('escalated');
    expect(withOverride.status).toBe('completed');
    expect(names(without.nodeTrace)).not.toEqual(names(withOverride.nodeTrace));
  });

  it('a specialists override adds fan-out children against the same canonical graph', async () => {
    let integrateInput: unknown;
    const executors = scripted();
    executors['integrate'] = (input) => {
      integrateInput = input;
      return Promise.resolve(outcome(task.id));
    };
    const engine = createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      config: { nodeOverrides: { fanout: { specialists: ['api-designer'] } } },
    });
    const result = await engine.run(task);
    expect(result.status).toBe('completed');
    expect(names(result.nodeTrace)).toContain('implement:task-1.api-designer');
    expect(names(result.nodeTrace)).toContain('quality:task-1.api-designer');
    const results = integrateInput as Array<{ child: TaskContract }>;
    expect(results.map((r) => r.child.id)).toEqual(['task-1.c1', 'task-1.api-designer']);
    // The specialist adds WORK, not budget: the children's budget-sum
    // invariant (PM's job, spec §5.4) survives the overlay addition.
    expect(results[1]?.child.budget).toEqual({ tokens: 0, usd: 0, wallClockMin: 0 });
    expect(results[1]?.child.parent).toBe(task.id);
  });

  it('the same engine without overrides produces the shorter trace (no graph duplication, config-only delta)', async () => {
    const plain = await createEngine({
      executors: scripted(),
      checkpoints: new InMemoryCheckpointStore(),
    }).run(task);
    const withSpecialist = await createEngine({
      executors: scripted(),
      checkpoints: new InMemoryCheckpointStore(),
      config: { nodeOverrides: { fanout: { specialists: ['api-designer'] } } },
    }).run(task);
    expect(withSpecialist.nodeTrace.length).toBe(plain.nodeTrace.length + 2);
  });

  it('EngineConfigSchema mirrors the overlay: K defaults to 3, vote gate defaults, strict keys', () => {
    const parsed = EngineConfigSchema.parse({});
    expect(parsed.K).toBe(3);
    expect(parsed.gates.vote).toEqual({ strategy: 'simple_majority', panel: 3 });
    expect(parsed.nodeOverrides).toEqual({});
    expect(() => EngineConfigSchema.parse({ k: 5 })).toThrow();
    expect(() => EngineConfigSchema.parse({ K: 0 })).toThrow();
    expect(EngineConfigSchema.parse(undefined).K).toBe(3);
  });

  it('vote gate config reaches the gate executor through NodeContext.config', async () => {
    let seen: unknown;
    const executors = scripted();
    const baseVote = scripted()['vote'] as NodeExecutor;
    executors['vote'] = (input, ctx) => {
      seen = ctx.config.gates.vote;
      return baseVote(input, ctx);
    };
    await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      config: { gates: { vote: { strategy: 'unanimous', panel: 7 } } },
    }).run(task);
    expect(seen).toEqual({ strategy: 'unanimous', panel: 7 });
  });
});
