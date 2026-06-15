/**
 * Per-child spend attribution + per-child budget halt (#56). Children run
 * SEQUENTIALLY, so the engine slices the run-global meter by the child boundary:
 * each child's `spend` is the meter delta across its sub-chain (all Kc
 * iterations). In enforce mode a child that overspends its OWN slice escalates
 * before Kc — sibling-independent, without halting the run; unlimited lifts the
 * per-child halt, mirroring the run-level discipline.
 */
import { describe, expect, it } from 'vitest';
import type { TaskContract, Verdict } from '@kernloop/contracts';
import { InMemoryCheckpointStore } from './checkpoints.js';
import { createEngine, type NodeExecutor } from './engine.js';
import { outcome, scripted, task } from './engine-testkit.js';

/** Two children with explicit slices; a custom decompose so budgets are precise. */
const twoChildren = (c1Budget: number, c2Budget: number): TaskContract[] => [
  {
    ...task,
    id: 'task-1.c1',
    parent: task.id,
    budget: { tokens: c1Budget, usd: 1, wallClockMin: 10 },
  },
  {
    ...task,
    id: 'task-1.c2',
    parent: task.id,
    budget: { tokens: c2Budget, usd: 1, wallClockMin: 10 },
  },
];

/** Wrap scripted executors so implement/quality bump a shared meter (per-child impl cost). */
function metered(
  implCost: (childId: string) => number,
  qualityByChild: Record<string, Array<Verdict['result']>> = {},
  children?: TaskContract[],
) {
  const meter = { tokens: 0, usd: 0 };
  const base = scripted(qualityByChild);
  const ex = base.executors;
  if (children !== undefined) ex['decompose'] = () => Promise.resolve(children);
  const impl = ex['implement'] as NodeExecutor;
  ex['implement'] = (input, ctx) => {
    meter.tokens += implCost((input as TaskContract).id);
    return impl(input, ctx);
  };
  const qual = ex['quality'] as NodeExecutor;
  ex['quality'] = (input, ctx) => {
    meter.tokens += 5;
    return qual(input, ctx);
  };
  return { executors: ex, meter, qualityCalls: base.qualityCalls };
}

describe('per-child budget attribution (#56)', () => {
  it('attributes spend to each child sub-chain, sliced by the sequential boundary', async () => {
    const { executors, meter } = metered((id) => (id.endsWith('c1') ? 10 : 100));
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      meteredSpend: () => ({ ...meter }),
    }).run(task, { runId: 'run-attrib' });
    expect(result.status).toBe('completed');
    const byChild = Object.fromEntries(
      (result.childSpend ?? []).map((e) => [e.childId, e.spend.tokens]),
    );
    // c1: 10 implement + 5 quality; c2: 100 + 5 — each child carries ONLY its own.
    expect(byChild['task-1.c1']).toBe(15);
    expect(byChild['task-1.c2']).toBe(105);
  });

  it('an unmetered run (no meteredSpend seam) attributes nothing — childSpend absent', async () => {
    const { executors } = metered(() => 10);
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
    }).run(task, { runId: 'run-unmetered' });
    expect(result.status).toBe('completed');
    expect(result.childSpend).toBeUndefined();
  });

  it('escalates a child that overspends its OWN slice before Kc; the sibling completes', async () => {
    // c1 (20-token slice) blows its budget on the first implement and its quality
    // rejects → escalate before Kc. c2 (large slice) passes normally. Run-level
    // budget is enforce with a huge limit, so ONLY the per-child slice bites.
    const { executors, meter, qualityCalls } = metered(
      (id) => (id.endsWith('c1') ? 30 : 5),
      { 'task-1.c1': ['fail'] },
      twoChildren(20, 1000),
    );
    let integrateInput: unknown;
    executors['integrate'] = (input) => {
      integrateInput = input;
      return Promise.resolve(outcome(task.id));
    };
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      budget: {
        mode: 'enforce',
        limit: { tokens: 1_000_000, usd: 1_000_000 },
        spent: () => ({ ...meter }),
      },
      meteredSpend: () => ({ ...meter }),
    }).run(task, { runId: 'run-child-slice' });
    expect(result.status).toBe('completed'); // the RUN never halted — only the child
    expect(qualityCalls['task-1.c1']).toBe(1); // escalated on the FIRST reject (slice), not after Kc
    const results = (integrateInput ?? []) as Array<{ child: TaskContract; escalated?: boolean }>;
    expect(results.find((r) => r.child.id === 'task-1.c1')?.escalated).toBe(true);
    expect(results.find((r) => r.child.id === 'task-1.c2')?.escalated).toBeUndefined();
  });

  it('unlimited mode never halts per-child: an over-slice child re-iterates to Kc', async () => {
    // Same over-slice c1, but unlimited mode — the per-child halt is lifted, so c1
    // re-iterates the full Kc (default 3) before escalating at the bound, not the slice.
    const { executors, meter, qualityCalls } = metered(
      () => 30,
      { 'task-1.c1': ['fail'] },
      twoChildren(20, 1000),
    );
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      budget: { mode: 'unlimited', limit: { tokens: 20, usd: 1 }, spent: () => ({ ...meter }) },
      meteredSpend: () => ({ ...meter }),
    }).run(task, { runId: 'run-unlimited-slice' });
    expect(result.status).toBe('completed');
    expect(qualityCalls['task-1.c1']).toBe(4); // Kc(3) re-iterations + the final reject = 4 quality runs
  });
});
