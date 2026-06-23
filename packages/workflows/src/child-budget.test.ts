/**
 * Runtime budget enforcement [CLM-0077] — split out of child-iterate.test.ts to
 * keep each test file under the 400-line ceiling. An enforce-mode run that
 * overspends halts (escalates, resumable); an unlimited run never halts on budget
 * but still tracks/reports cost; an over-budget enforce run escalates the child it
 * was on rather than re-iterating it.
 */
import { describe, expect, it } from 'vitest';
import type { TaskContract } from '@kernloop/contracts';
import { InMemoryCheckpointStore } from './checkpoints.js';
import { createEngine, type BudgetGuard } from './engine.js';
import { outcome, scripted, task } from './engine-testkit.js';

describe('runtime budget enforcement [CLM-0077]', () => {
  /** A guard whose spend jumps past the limit after `tripAfter` reads. */
  function guard(mode: 'enforce' | 'unlimited', limit = 100, tripAfter = 0): BudgetGuard {
    let reads = 0;
    return {
      mode,
      limit: { tokens: limit, usd: 1 },
      spent: () => {
        reads += 1;
        return { tokens: reads > tripAfter ? limit + 1 : 0, usd: 0 };
      },
    };
  }

  it('a bounded run that exceeds its budget escalates (resumable), not silently continues', async () => {
    const { executors } = scripted();
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      budget: guard('enforce', 100, 0), // over budget immediately
    }).run(task, { runId: 'run-overbudget' });
    expect(result.status).toBe('escalated');
    expect(result.findings?.some((f) => f.message.includes('exceeded its budget'))).toBe(true);
  });

  it('an unlimited run that exceeds the nominal budget COMPLETES and never halts on budget', async () => {
    const { executors } = scripted();
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      budget: guard('unlimited', 100, 0), // would be over budget in enforce mode
    }).run(task);
    expect(result.status).toBe('completed');
    expect(result.outcome).toBeDefined();
  });

  it('an over-budget enforce run escalates a child before Kc instead of re-iterating', async () => {
    let integrateInput: unknown;
    const { executors } = scripted({ 'task-1.c1': ['fail', 'pass'] });
    executors['integrate'] = (input) => {
      integrateInput = input;
      return Promise.resolve(outcome(task.id));
    };
    // Budget trips only once the fan-out is underway (after several reads) so
    // the run reaches a child quality reject, then the child must escalate.
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      budget: guard('enforce', 100, 6),
    }).run(task);
    // The run halts at the budget; the child it was on is escalated, not looped.
    expect(result.status).toBe('escalated');
    const results = (integrateInput ?? []) as Array<{ child: TaskContract; escalated?: boolean }>;
    // integrate never ran (the run halted first): the escalation is in findings.
    expect(results).toEqual([]);
  });
});
