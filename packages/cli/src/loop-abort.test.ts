/**
 * Cooperative mid-run abort (#304·P5, CLM-0143). When an injected AbortSignal
 * fires, the engine halts at the NEXT node boundary (CLM-0044) and the run is
 * reported as a CLEAN, resumable CANCEL — Outcome status 'cancelled', LoopReport
 * status 'escalated' + haltReason 'aborted' — carrying the spend-so-far, NOT a
 * dirty failure. The SIGINT trigger that fires this in production is a tracked
 * fast-follow (#317); here the signal is injected, the real invocable seam.
 *
 * NOTE (inherited from CLM-0044): abort takes effect only at a node BOUNDARY — a
 * runaway INSIDE a single long node won't stop until that node returns.
 */
import { existsSync, rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyChain } from '@kernloop/kernel';
import { checkpointFile, type LoopInvoke, type LoopReport } from './loop/index.js';
import { runTool } from './tools/run.js';
import { readEnvelopes } from './tools/audit.js';
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

const greet = () =>
  scriptedInvoke({ vote: () => 'approve', files: [{ path: 'src/greet.ts', content: GREET_TS }] });

describe('cooperative mid-run abort (#304, CLM-0143)', () => {
  it('halts cleanly on an injected abort: cancelled Outcome, spend preserved + reconciled, resumable', async () => {
    const repo = makeFixtureRepo(scratch, 'abort');
    const kern = kernloopFor(repo);
    const controller = new AbortController();
    let calls = 0;
    const base = greet();
    const invoke: LoopInvoke = (prompt, opts) => {
      calls += 1;
      if (calls === 1) controller.abort(); // fire during research → halt at the next node boundary
      return base(prompt, opts);
    };

    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'abort-run',
      },
      { checks: [typecheck], invoke, signal: controller.signal },
    );

    // The run-tool Outcome is an honest CANCEL (not failure, not partial), with spend-so-far.
    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.status).toBe('cancelled');
    expect(result.outcome.cost.tokens).toBeGreaterThan(0); // the in-memory meter survived the abort

    // The loop report is a clean, resumable halt — escalated, not a dirty 'failed'.
    const report = result.data as LoopReport;
    expect(report.status).toBe('escalated');
    expect(report.haltReason).toBe('aborted');

    // COST RECONCILIATION (#304 vote condition): the flushed Outcome.cost EQUALS the
    // sum of the persisted per-node loop.spend deltas — the two meters never diverge.
    const spent = readEnvelopes(kern.paths.audit)
      .filter((e) => e.type === 'loop.spend')
      .reduce((acc, e) => acc + (e.payload as { nodeTokens: number }).nodeTokens, 0);
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBe(result.outcome.cost.tokens);

    // The audit chain still verifies end to end, and the checkpoint is resumable.
    expect(verifyChain(kern.store).ok).toBe(true);
    expect(existsSync(checkpointFile(kern.paths.dir, report.runId))).toBe(true);
    kern.close();
  }, 120_000);

  it('a vote/budget escalate (NO haltReason) still maps to partial, not cancelled — regression guard', async () => {
    const repo = makeFixtureRepo(scratch, 'escalate');
    const kern = kernloopFor(repo);
    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'esc-run',
      },
      { checks: [typecheck], invoke: scriptedInvoke({ vote: () => 'reject', files: [] }) },
    );
    // A vote escalate is a needs-human ESCALATION (resume to edit) — NOT a cancel.
    expect(result.kind).toBe('escalated');
    if (result.kind !== 'escalated') throw new Error('expected escalated');
    expect(result.outcome.status).toBe('partial'); // the new abort branch must NOT capture it
    expect((result.data as LoopReport).haltReason).toBeUndefined();
    kern.close();
  }, 120_000);

  it('a non-aborted run is unaffected: completes normally with no haltReason', async () => {
    const repo = makeFixtureRepo(scratch, 'no-abort');
    const kern = kernloopFor(repo);
    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'ok-run',
      },
      { checks: [typecheck], invoke: greet() },
    );
    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.status).toBe('success');
    expect((result.data as LoopReport).status).toBe('completed');
    expect((result.data as LoopReport).haltReason).toBeUndefined();
    kern.close();
  }, 120_000);
});
