/**
 * ChildResult's checkpointed `writtenPaths` (#543, CLM-0199) — schema-level
 * proof that the field round-trips through the same JSON-serialize path a
 * real checkpoint takes (structuredClone in the engine, JSON.stringify in the
 * jsonl store), so a durable resume can trust what it reads back.
 */
import { describe, expect, it } from 'vitest';
import { ChildResultSchema, RunStateSchema, type ChildResult, type RunState } from './state.js';

const child: ChildResult['child'] = {
  id: 'task-1.c1',
  parent: 'task-1',
  goal: 'implement the thing',
  constraints: [],
  budget: { tokens: 100, usd: 1, wallClockMin: 5 },
  evidence: [],
  definitionOfDone: [],
  authorityCeiling: 'suggest',
  overlay: 'repo',
};

describe('ChildResult.writtenPaths (#543, CLM-0199)', () => {
  it('round-trips a present writtenPaths set through the schema and a JSON hop', () => {
    const result: ChildResult = {
      child,
      iteration: 1,
      findings: [],
      writtenPaths: ['src/a.ts', 'src/b.ts'],
    };
    const parsed = ChildResultSchema.parse(JSON.parse(JSON.stringify(result)) as unknown);
    expect(parsed.writtenPaths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('is absent (never defaulted to []) when the field was never set — distinct from "wrote nothing"', () => {
    const parsed = ChildResultSchema.parse({ child, iteration: 0, findings: [] });
    expect(parsed.writtenPaths).toBeUndefined();
  });

  it('rejects an empty-string path — a checkpointed path is never blank', () => {
    const invalid = { child, iteration: 0, findings: [], writtenPaths: [''] };
    expect(ChildResultSchema.safeParse(invalid).success).toBe(false);
  });

  it('the full RunState carries writtenPaths through its childResults on a JSON round-trip', () => {
    const state: RunState = {
      task: child, // any valid TaskContract shape works as the run task too
      status: 'running',
      cursor: { phase: 'fanout', childIndex: 0, sub: 0 },
      iteration: 0,
      values: {},
      findings: [],
      children: [child],
      childResults: [{ child, iteration: 2, findings: [], writtenPaths: ['src/a.ts'] }],
      trace: [],
      observedMaxNodeSpend: { tokens: 0, usd: 0 },
    };
    const parsed = RunStateSchema.parse(JSON.parse(JSON.stringify(state)) as unknown);
    expect(parsed.childResults[0]?.writtenPaths).toEqual(['src/a.ts']);
  });
});
