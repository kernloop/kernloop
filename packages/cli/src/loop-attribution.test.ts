/**
 * Per-child spend attribution surfaced end-to-end (#56): the real `run` tool
 * drives the full canonical loop on a real repo and the report carries each
 * fan-out child's OWN metered spend — a slice of the run total, sliced off the
 * sequential child boundary, alongside the per-adapter breakdown.
 */
import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { type LoopReport } from './loop/index.js';
import { runTool } from './tools/run.js';
import {
  GREET_TS,
  fixtureRepo as makeFixtureRepo,
  kernloopFor,
  loopScratch,
  scriptedInvoke,
  typecheck,
} from './loop-fixtures.js';

const scratch = loopScratch();
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('per-child spend attribution in report.childSpend (#56)', () => {
  it('attributes the fan-out child its OWN metered spend, a slice of the run total', async () => {
    const repo = makeFixtureRepo(scratch, 'childspend');
    const kern = kernloopFor(repo);
    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 't-cs',
      },
      {
        checks: [typecheck],
        invoke: scriptedInvoke({
          vote: () => 'approve',
          files: [{ path: 'src/greet.ts', content: GREET_TS }],
        }),
      },
    );
    expect(result.kind).toBe('outcome');
    const report = result.data as LoopReport;
    // The single decomposed child carries the spend its implement/quality/review
    // sub-chain incurred — a real slice of the run total, never more than it.
    expect(report.childSpend).toBeDefined();
    expect(report.childSpend).toHaveLength(1);
    const child = report.childSpend![0]!;
    expect(child.childId).toBe('t-cs.1');
    expect(child.spend.tokens).toBeGreaterThan(0);
    expect(child.spend.tokens).toBeLessThanOrEqual(report.cost.tokens); // a slice, not the whole
    kern.close();
  }, 120_000);
});
