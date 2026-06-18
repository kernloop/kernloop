/**
 * P2 exit criterion, end to end [CLM-0046]: the FULL canonical loop on a
 * real feature in a real repository — a real git repo with a real TypeScript
 * package, driven through the `run` tool with a SCRIPTED invoke (the honest
 * double for the external model CLI; everything downstream is real): plan →
 * 3 voters → PM decompose under the budget invariant → a coder child whose
 * emitted file the cli WRITES into the workspace → the REAL quality gate
 * (real tsc) → integrate → retrospect into SQLite memory. Checkpoints are
 * durable JSONL; the audit chain verifies; escalate/resume is proven at the
 * composition-root level [CLM-0043, CLM-0044].
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyChain } from '@kernloop/kernel';
import { checkpointFile, type LoopInvoke, type LoopReport } from './loop/index.js';
import { runTool } from './tools/run.js';
import { statusTool } from './tools/status.js';
import { readEnvelopes } from './tools/audit.js';
import {
  BROKEN_TS,
  COST,
  GREET_TS,
  fixtureRepo as makeFixtureRepo,
  kernloopFor,
  loopScratch,
  scriptedInvoke,
  typecheck,
} from './loop-fixtures.js';

const scratch = loopScratch();
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Build a fixture repo under this file's scratch dir. */
const fixtureRepo = (name: string, overlayYaml?: string): string =>
  makeFixtureRepo(scratch, name, overlayYaml);

const MAIN_TRACE = [
  'frame',
  'research',
  'plan',
  'vote',
  'decompose',
  'implement',
  'quality',
  'review',
  'integrate',
  'retrospect',
];

describe('P2 exit: the full canonical loop on a real feature in a real repo', () => {
  it('runs the full canonical loop on a real feature in a real repo: vote and quality gates, checkpoints, audit, memory', async () => {
    const repo = fixtureRepo('pass');
    const kern = kernloopFor(repo);
    const invoke = scriptedInvoke({
      vote: () => 'approve',
      files: [{ path: 'src/greet.ts', content: GREET_TS }],
    });

    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'task-loop-pass',
      },
      { checks: [typecheck], invoke },
    );

    // The run completed and the Outcome is an honest success
    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.status).toBe('success');
    expect(result.outcome.cost.tokens).toBeGreaterThan(0); // metered through the one seam
    const report = result.data as LoopReport;
    expect(report.status).toBe('completed');
    expect(report.nodeTrace.map((t) => t.node)).toEqual(MAIN_TRACE);
    expect(report.outcome?.signals).toEqual([
      {
        name: 'child:task-loop-pass.1',
        passed: true,
        detail: 'implement success; quality pass; review approve (advisory)',
      },
    ]);
    expect(report.outcome?.distillCandidates).toEqual([`loop:${report.runId}`]);

    // The real feature file exists in the real repo and compiled under real tsc
    expect(readFileSync(path.join(repo, 'src', 'greet.ts'), 'utf8')).toBe(GREET_TS);

    // #107: the post-loop step wrote a DERIVED API doc from the deliverable's own
    // doc-comments (deterministic, no model) and audited the counts once.
    expect(report.docArtifact?.written).toBe(true);
    expect(report.docArtifact?.symbolCount).toBeGreaterThanOrEqual(1);
    const apiDoc = readFileSync(path.join(repo, 'API.generated.md'), 'utf8');
    expect(apiDoc).toContain('generated from doc-comments');
    expect(apiDoc).toContain('greet'); // the exported (undocumented) deliverable symbol
    const docEvents = readEnvelopes(kern.paths.audit).filter((e) => e.type === 'loop.document');
    expect(docEvents).toHaveLength(1);
    expect((docEvents[0]!.payload as { symbolCount: number }).symbolCount).toBeGreaterThanOrEqual(
      1,
    );

    // Checkpoints: durable JSONL, one line per completed node
    const checkpoints = readFileSync(checkpointFile(kern.paths.dir, report.runId), 'utf8');
    expect(checkpoints.trim().split('\n')).toHaveLength(MAIN_TRACE.length);

    // Audit: the chain verifies and carries all three gate verdicts
    // (vote + quality + the advisory review).
    expect(verifyChain(kern.store).ok).toBe(true);
    const gateEvents = readEnvelopes(kern.paths.audit)
      .filter((e) => e.type === 'cli.gate.verdict')
      .map((e) => e.payload as { gate: string; result: string });
    expect(gateEvents).toEqual([
      {
        gate: 'vote',
        result: 'approve',
        findings: 0,
        taskId: 'task-loop-pass',
        voters: ['architect', 'security', 'scope-steward'],
        wallClockMs: expect.any(Number) as number,
      },
      {
        gate: 'quality',
        result: 'pass',
        findings: 0,
        taskId: 'task-loop-pass.1',
        voters: [],
        wallClockMs: expect.any(Number) as number,
      },
      {
        gate: 'review',
        result: 'approve',
        findings: 0,
        taskId: 'task-loop-pass.1',
        voters: ['correctness', 'security', 'maintainability', 'groundedness'],
        wallClockMs: expect.any(Number) as number,
      },
    ]);

    // Memory: the episodic trace is retrievable and retrospect left semantic facts
    const status = statusTool(kern, { taskId: 'task-loop-pass' });
    expect(status.found).toBe(true);
    const facts = kern.memory.recallFacts('loop task-loop-pass');
    expect(facts.some((f) => f.provenance === 'loop:retrospect')).toBe(true);
    kern.close();
  }, 120_000);

  it('a tiered run attributes spend PER adapter in report.cost.byAdapter, summing to the total (#44/#202)', async () => {
    // medium-tier nodes (the vote + review gates) route to codex; the rest run on
    // the default `claude` adapter — a real two-adapter run.
    const repo = fixtureRepo('byadapter', 'id: ba\nadapters:\n  medium: codex\n');
    const kern = kernloopFor(repo);
    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 't-ba',
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
    const by = report.cost.byAdapter;
    expect(by).toBeDefined();
    expect(Object.keys(by ?? {}).sort()).toEqual(['claude', 'codex']); // both adapters attributed
    const sum = Object.values(by ?? {}).reduce(
      (s, b) => ({ tokens: s.tokens + b.tokens, usd: s.usd + b.usd }),
      { tokens: 0, usd: 0 },
    );
    expect(sum.tokens).toBe(report.cost.tokens); // buckets sum to the flat total — no drift
    expect(sum.usd).toBeCloseTo(report.cost.usd);
    kern.close();
  }, 120_000);

  it('escalates after K rejected votes with findings, then resumes from the checkpoint to completion', async () => {
    const repo = fixtureRepo('resume', 'id: fixture-resume\nK: 1\n');
    const kern = kernloopFor(repo);

    const rejected = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'task-loop-resume',
      },
      {
        checks: [typecheck],
        invoke: scriptedInvoke({ vote: () => 'reject', files: [] }),
      },
    );

    // Escalation is its OWN status, with the rejecting voters' findings
    expect(rejected.kind).toBe('escalated');
    if (rejected.kind !== 'escalated') throw new Error('expected escalated');
    expect(rejected.findings.length).toBeGreaterThan(0);
    expect(rejected.outcome.status).toBe('partial'); // never disguised as success
    const escalatedReport = rejected.data as LoopReport;
    // K=1: plan→vote, one rejected re-entry, then HALT at the bound
    expect(escalatedReport.nodeTrace.map((t) => t.node)).toEqual([
      'frame',
      'research',
      'plan',
      'vote',
      'plan',
      'vote',
    ]);
    expect(existsSync(path.join(repo, 'src', 'greet.ts'))).toBe(false);

    // The human "edits the plan inputs", then resumes the SAME run id
    const resumed = await runTool(
      kern,
      {
        capability: 'workflow.canonical',
        workspaceDir: repo,
        resume: rejected.runId,
      },
      {
        checks: [typecheck],
        invoke: scriptedInvoke({
          vote: () => 'approve',
          files: [{ path: 'src/greet.ts', content: GREET_TS }],
        }),
      },
    );

    expect(resumed.kind).toBe('outcome');
    if (resumed.kind !== 'outcome') throw new Error('expected outcome');
    expect(resumed.outcome.status).toBe('success');
    expect(resumed.task.id).toBe('task-loop-resume'); // the checkpointed task is the truth
    const resumedReport = resumed.data as LoopReport;
    expect(resumedReport.runId).toBe(rejected.runId);
    // The cumulative trace keeps the pre-escalation history and continues from plan
    expect(resumedReport.nodeTrace.map((t) => t.node)).toEqual([
      ...escalatedReport.nodeTrace.map((t) => t.node),
      'plan',
      'vote',
      'decompose',
      'implement',
      'quality',
      'review',
      'integrate',
      'retrospect',
    ]);
    expect(readFileSync(path.join(repo, 'src', 'greet.ts'), 'utf8')).toBe(GREET_TS);
    expect(verifyChain(kern.store).ok).toBe(true);
    kern.close();
  }, 120_000);

  it('propagates a child quality failure honestly: a persistently-broken child escalates at Kc and the loop completes with a failure Outcome', async () => {
    // Kc: 1 → the child re-runs implement once on the quality reject, then
    // escalates at the bound (initial + 1 re-iteration = 2 attempts). The
    // coder always emits the same broken file, so quality keeps failing
    // [CLM-0043]: the child escalates WITHOUT failing the run, and integrate
    // reports the stuck child honestly.
    const repo = fixtureRepo('fail', 'id: fixture-fail\nKc: 1\n');
    const kern = kernloopFor(repo);

    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'task-loop-fail',
      },
      {
        checks: [typecheck],
        invoke: scriptedInvoke({
          vote: () => 'approve',
          files: [{ path: 'src/greet.ts', content: BROKEN_TS }],
        }),
      },
    );

    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.status).toBe('failure');
    const report = result.data as LoopReport;
    expect(report.status).toBe('completed'); // the loop ran to retrospect; the WORK failed
    expect(report.outcome?.status).toBe('failure');
    expect(report.outcome?.signals).toEqual([
      {
        name: 'child:task-loop-fail.1',
        passed: false,
        // On escalation at the quality bound the child advances without running
        // review — so the detail carries no review verdict, honestly.
        detail: 'implement success; quality fail — ESCALATED after 2 attempt(s)',
      },
    ]);
    expect(report.outcome?.distillCandidates).toEqual([]);
    // #107: a COMPLETED run whose WORK failed still reached retrospect, so the
    // doc artifact IS written — it documents whatever code was produced.
    expect(report.docArtifact?.written).toBe(true);
    expect(report.docArtifact?.symbolCount).toBeGreaterThanOrEqual(1);
    // The child re-ran implement before escalating: implement appears twice.
    expect(report.nodeTrace.filter((t) => t.node === 'implement')).toHaveLength(2);
    // The hash chain recorded the refine history (loop.child.iterate per re-entry).
    const iterateEvents = readEnvelopes(kern.paths.audit)
      .filter((e) => e.type === 'loop.child.iterate')
      .map((e) => e.payload as { childId: string; iteration: number; gate: string });
    expect(iterateEvents).toEqual([
      {
        runId: expect.any(String),
        childId: 'task-loop-fail.1',
        iteration: 1,
        gate: 'quality',
        findingCount: expect.any(Number),
      },
    ]);
    const trace = statusTool(kern, { taskId: 'task-loop-fail' });
    expect(trace.found && trace.trace.status === 'failure').toBe(true);
    kern.close();
  }, 120_000);

  it('fails the run on a malformed PM decomposition: typed executor error, no fabricated children', async () => {
    const repo = fixtureRepo('parsefail');
    const kern = kernloopFor(repo);
    const invoke: LoopInvoke = (prompt) =>
      Promise.resolve({
        output: prompt.includes('Proposal under vote')
          ? JSON.stringify({ vote: 'approve', reasoning: 'ok' })
          : 'no JSON object here at all',
        cost: COST,
      });

    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'task-loop-parsefail',
      },
      { checks: [typecheck], invoke },
    );

    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.status).toBe('failure');
    const report = result.data as LoopReport;
    expect(report.status).toBe('failed');
    expect(report.error?.code).toBe('executor_failed');
    expect(report.error?.message).toContain('subtasks');
    // #107: a run that did NOT complete produces no doc artifact (nothing to mine honestly).
    expect(report.docArtifact).toBeUndefined();
    kern.close();
  }, 60_000);

  it('rejects --resume for a capability other than workflow.canonical and for an unknown run id', async () => {
    const repo = fixtureRepo('resume-errors');
    const kern = kernloopFor(repo);
    await expect(
      runTool(kern, { capability: 'gate.quality', resume: 'run-x', workspaceDir: repo }),
    ).rejects.toThrow('workflow.canonical');
    await expect(
      runTool(kern, { capability: 'workflow.canonical', resume: 'run-x', workspaceDir: repo }),
    ).rejects.toThrow('no checkpoint found for run "run-x"');
    kern.close();
  }, 60_000);

  it('requires a workspaceDir: the loop has nowhere honest to implement without one', async () => {
    const repo = fixtureRepo('no-workspace');
    const kern = kernloopFor(repo);
    await expect(
      runTool(
        kern,
        { goal: 'g', capability: 'workflow.canonical' },
        { invoke: scriptedInvoke({ vote: () => 'approve', files: [] }) },
      ),
    ).rejects.toThrow('workspaceDir');
    kern.close();
  }, 60_000);
});
