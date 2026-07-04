/**
 * Checkpointed child written-paths (#543, CLM-0199): the engine's
 * `childWrittenPaths` pull-seam (mirrors `meteredSpend`, #56) is called right
 * after a child's implement sub-node completes, and its result is persisted
 * onto that child's checkpointed `ChildResult.writtenPaths` — so a
 * `--resume` can rebuild the scoped quality-gate union from durable state
 * instead of the whole-workspace sticky taint (CLM-0189).
 */
import { describe, expect, it } from 'vitest';
import { InMemoryCheckpointStore } from './checkpoints.js';
import { createEngine } from './engine.js';
import { scripted, task } from './engine-testkit.js';

describe('childWrittenPaths persists to the checkpointed ChildResult (#543, CLM-0199)', () => {
  it('an implement emission persists the CURRENT written-paths union into ChildResult.writtenPaths', async () => {
    const { executors } = scripted();
    const store = new InMemoryCheckpointStore();
    const seen: Record<string, readonly string[]> = {
      'task-1.c1': ['src/a.ts'],
      'task-1.c2': ['src/x.ts'],
    };
    const result = await createEngine({
      executors,
      checkpoints: store,
      childWrittenPaths: (childId) => seen[childId],
    }).run(task, { runId: 'run-wp-1' });

    expect(result.status).toBe('completed');
    const latest = await store.latest('run-wp-1');
    const c1 = latest?.state.childResults.find((r) => r.child.id === 'task-1.c1');
    const c2 = latest?.state.childResults.find((r) => r.child.id === 'task-1.c2');
    expect(c1?.writtenPaths).toEqual(['src/a.ts']);
    expect(c2?.writtenPaths).toEqual(['src/x.ts']);
  });

  it('accumulates across iterations — the LATER union persists, never narrower than an earlier write', async () => {
    // c1's quality fails once, forcing a re-iterate (a second implement).
    const { executors } = scripted({ 'task-1.c1': ['fail', 'pass'] });
    const store = new InMemoryCheckpointStore();
    let c1Implements = 0;
    // The resolver stands in for the CLI's own union-across-iterations stash:
    // iteration 1 wrote a.ts; iteration 2 (the re-run) re-emitted only b.ts,
    // but the REAL stash unions — so the resolver hands back the full union
    // on the second call, never just the latest emission.
    const childWrittenPaths = (childId: string): readonly string[] | undefined => {
      if (childId !== 'task-1.c1') return ['src/x.ts'];
      c1Implements += 1;
      return c1Implements === 1 ? ['src/a.ts'] : ['src/a.ts', 'src/b.ts'];
    };
    const result = await createEngine({
      executors,
      checkpoints: store,
      childWrittenPaths,
    }).run(task, { runId: 'run-wp-2' });

    expect(result.status).toBe('completed');
    expect(c1Implements).toBe(2); // the fail really did force a re-iteration
    const latest = await store.latest('run-wp-2');
    const c1 = latest?.state.childResults.find((r) => r.child.id === 'task-1.c1');
    // The FINAL checkpoint carries the union of BOTH iterations' writes — the
    // second implement's checkpoint update did not narrow past the first.
    expect(c1?.writtenPaths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('with no childWrittenPaths seam injected, writtenPaths is never set — byte-identical to pre-#543', async () => {
    const { executors } = scripted();
    const store = new InMemoryCheckpointStore();
    const result = await createEngine({ executors, checkpoints: store }).run(task, {
      runId: 'run-wp-3',
    });
    expect(result.status).toBe('completed');
    const latest = await store.latest('run-wp-3');
    for (const r of latest?.state.childResults ?? []) {
      expect(r.writtenPaths).toBeUndefined();
    }
  });
});
