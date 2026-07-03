/**
 * Finding dedup on the child iteration back-edge (#535) [CLM-0190]. All three
 * fold sites — reiterateChild (driving-gate reject), escalateChild (the
 * Kc/budget bound), foldHints (non-driving advisory findings) — drop findings
 * whose full contract identity (severity + message + optional path) is already
 * accumulated, so a gate re-emitting the same still-unfixed set neither grows
 * the coder-hint set nor inflates the audited per-iteration findingCount (the
 * June-13 dogfood runs stacked one identical set 113→221→329). Genuinely new
 * findings still accumulate — the intentional hints design is unchanged.
 */
import { describe, expect, it } from 'vitest';
import type { Finding } from '@kernloop/contracts';
import { InMemoryCheckpointStore } from './checkpoints.js';
import { escalateChild, foldHints, reiterateChild } from './child-iterate.js';
import { createEngine, type ChildIterateEvent } from './engine.js';
import { scripted, task } from './engine-testkit.js';
import { ChildResultSchema, RunStateSchema, type ChildResult, type RunState } from './state.js';

describe('finding dedup on the child back-edge (#535) [CLM-0190]', () => {
  const finding = (message: string, extra: Partial<Finding> = {}): Finding => ({
    severity: 'error',
    message,
    ...extra,
  });
  const freshResult = (): ChildResult =>
    ChildResultSchema.parse({ child: task, iteration: 0, findings: [] });
  const fanoutState = (): RunState =>
    RunStateSchema.parse({
      task,
      status: 'running',
      cursor: { phase: 'fanout', childIndex: 0, sub: 2 },
      iteration: 0,
      values: {},
      findings: [],
      children: [task],
      childResults: [],
      trace: [],
    });

  it('re-appending an identical finding set does not grow the accumulated findings (#535)', () => {
    const result = freshResult();
    const state = fanoutState();
    const set = [finding('undocumented export "a"'), finding('undocumented export "b"')];
    reiterateChild(state, result, set);
    expect(result.findings).toHaveLength(2);
    // The gate re-emits the SAME still-unfixed set on the next two iterations —
    // the June-13 failure stacked 113→221→329; deduped, the set stays put.
    state.cursor = { phase: 'fanout', childIndex: 0, sub: 2 };
    reiterateChild(state, result, set);
    state.cursor = { phase: 'fanout', childIndex: 0, sub: 2 };
    reiterateChild(state, result, [...set]);
    expect(result.findings).toHaveLength(2);
    expect(result.iteration).toBe(3); // iteration still counts every re-entry
  });

  it('genuinely new findings still accumulate alongside deduped repeats (#535)', () => {
    const result = freshResult();
    const state = fanoutState();
    reiterateChild(state, result, [finding('missing doc'), finding('missing test')]);
    // Next iteration: one repeat, one genuinely new finding, and two near-misses
    // that differ ONLY in path or severity — all three distinct ones must land.
    state.cursor = { phase: 'fanout', childIndex: 0, sub: 2 };
    reiterateChild(state, result, [
      finding('missing doc'), // exact repeat → dropped
      finding('lint error'), // new → kept
      finding('missing doc', { path: 'src/a.ts' }), // same message, new path → kept
      { severity: 'warn', message: 'missing test' }, // same message, new severity → kept
    ]);
    expect(result.findings.map((f) => f.message)).toEqual([
      'missing doc',
      'missing test',
      'lint error',
      'missing doc',
      'missing test',
    ]);
    // foldHints (non-driving gate) and escalateChild (the bound) dedupe the same way.
    foldHints(result, [finding('lint error'), finding('review nit')]);
    expect(result.findings.filter((f) => f.message === 'lint error')).toHaveLength(1);
    expect(result.findings.some((f) => f.message === 'review nit')).toBe(true);
    const atBound = result.findings.length;
    escalateChild(result, [finding('missing doc'), finding('review nit')]);
    expect(result.findings).toHaveLength(atBound);
    expect(result.escalated).toBe(true);
  });

  it('the audited findingCount reflects the DEDUPED accumulated set, not re-appended repeats (#535)', async () => {
    // c1's quality gate fails twice with the IDENTICAL finding, then passes. The
    // onChildIterate audit hook must see findingCount 1 on BOTH re-entries — not
    // the pre-fix cumulative 1, 2 (the false "regressing child" signal).
    const { executors } = scripted({ 'task-1.c1': ['fail', 'fail', 'pass'] });
    const iterations: ChildIterateEvent[] = [];
    const result = await createEngine({
      executors,
      checkpoints: new InMemoryCheckpointStore(),
      config: { Kc: 3 },
      onChildIterate: (e) => iterations.push(e),
    }).run(task);
    expect(result.status).toBe('completed');
    expect(iterations).toEqual([
      { childId: 'task-1.c1', iteration: 1, gate: 'quality', findingCount: 1 },
      { childId: 'task-1.c1', iteration: 2, gate: 'quality', findingCount: 1 },
    ]);
  });
});
