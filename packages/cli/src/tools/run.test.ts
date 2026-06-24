/**
 * Unit tests for the `run` tool [CLM-0034]: routing via manifests, audited
 * decisions, plan-only mode, honest no-route results, and the unwired
 * capability path.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyChain } from '@kernloop/kernel';
import { createKernloop, type Kernloop } from '../kernel.js';
import { ExecutionError } from '../executors.js';
import { readEnvelopes } from './audit.js';
import { runTool } from './run.js';

const dirs: string[] = [];
function freshKernloop(): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-run-'));
  dirs.push(repo);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('runTool', () => {
  it('routes a TaskContract via manifests and returns an Outcome, with the routing decision audited', async () => {
    const kern = freshKernloop();
    const result = await runTool(kern, {
      goal: 'list episodic memory',
      capability: 'memory.episodic.read',
      id: 'task-run-1',
    });
    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.taskId).toBe('task-run-1');
    expect(result.outcome.status).toBe('success');
    expect(result.outcome.traceRef).toContain('task-run-1');
    const routes = readEnvelopes(kern.paths.audit).filter((e) => e.type === 'kernel.router.route');
    expect(routes).toHaveLength(1);
    const payload = routes[0]?.payload as { task: string; selected: string; outcome: string };
    expect(payload.task).toBe('task-run-1');
    expect(payload.selected).toBe('@kernloop/faculty-memory@0.1.0');
    expect(payload.outcome).toBe('routed');
    expect(verifyChain(kern.store).ok).toBe(true);
    kern.close();
  });

  it('records the Outcome to episodic memory so status survives the session', async () => {
    const kern = freshKernloop();
    await runTool(kern, {
      goal: 'recall facts about routing',
      capability: 'memory.semantic.recall',
      id: 'task-run-2',
    });
    const trace = kern.memory.getTraceSummary('task-run-2');
    expect(trace?.status).toBe('success');
    expect(trace?.summary).toContain('memory.semantic.recall');
    kern.close();
  });

  it('execute:false returns the routing decision only — no outcome, no memory write', async () => {
    const kern = freshKernloop();
    const result = await runTool(kern, {
      goal: 'plan a quality gate run',
      capability: 'gate.quality',
      id: 'task-run-plan',
      execute: false,
    });
    expect(result.kind).toBe('routing');
    if (result.kind !== 'routing') throw new Error('expected routing');
    expect(result.decision.selected).toBe('@kernloop/faculty-gates@0.1.0');
    expect(result.decision.explored).toBe(false);
    expect(kern.memory.getTraceSummary('task-run-plan')).toBeUndefined();
    kern.close();
  });

  it('returns the no-candidate decision honestly when no manifest declares the capability', async () => {
    const kern = freshKernloop();
    const result = await runTool(kern, {
      goal: 'do something nothing advertises',
      capability: 'does.not.exist',
      id: 'task-run-unknown',
    });
    expect(result.kind).toBe('no_route');
    if (result.kind !== 'no_route') throw new Error('expected no_route');
    expect(result.error.code).toBe('unknown_capability');
    expect(result.decision).toBeNull();
    // the rejection is audited by the router before it throws
    const routes = readEnvelopes(kern.paths.audit).filter((e) => e.type === 'kernel.router.route');
    expect((routes[0]?.payload as { outcome: string }).outcome).toBe('unknown_capability');
    kern.close();
  });

  it('returns no_eligible_candidate with per-candidate reasons when nothing fits', async () => {
    const kern = freshKernloop();
    const result = await runTool(kern, {
      goal: 'gate above the ceiling',
      capability: 'gate.quality',
      id: 'task-run-ceiling',
      authorityCeiling: 'observe', // gate manifest tier is advisory — over the ceiling
    });
    expect(result.kind).toBe('no_route');
    if (result.kind !== 'no_route') throw new Error('expected no_route');
    expect(result.error.code).toBe('no_eligible_candidate');
    expect(result.decision?.candidates[0]?.reasons).toContain('tier_exceeds_authority_ceiling');
    kern.close();
  });

  it('names the real entry point for routable capabilities with no run-executor', async () => {
    const kern = freshKernloop();
    const result = await runTool(kern, {
      goal: 'write a fact through run',
      capability: 'memory.semantic.write',
      id: 'task-run-unwired',
    });
    expect(result.kind).toBe('unwired');
    if (result.kind !== 'unwired') throw new Error('expected unwired');
    expect(result.error.code).toBe('no_run_executor');
    expect(result.selected).toBe('@kernloop/faculty-memory@0.1.0');
    kern.close();
  });

  it('throws a typed ExecutionError when gate.quality is run without a workspace', async () => {
    const kern = freshKernloop();
    await expect(
      runTool(kern, {
        goal: 'gate with no workspace',
        capability: 'gate.quality',
        id: 'task-run-nows',
      }),
    ).rejects.toThrow(ExecutionError);
    kern.close();
  });

  it('appends cli.run.outcome telemetry with the measured wall clock', async () => {
    const kern = freshKernloop();
    await runTool(kern, {
      goal: 'compile a brief for telemetry',
      capability: 'brief.compile',
      id: 'task-run-telemetry',
    });
    const events = readEnvelopes(kern.paths.audit).filter((e) => e.type === 'cli.run.outcome');
    expect(events).toHaveLength(1);
    const payload = events[0]?.payload as { taskId: string; status: string; wallClockMs: number };
    expect(payload.taskId).toBe('task-run-telemetry');
    expect(payload.status).toBe('success');
    expect(payload.wallClockMs).toBeGreaterThanOrEqual(0);
    kern.close();
  });

  it('records a synchronous run as a job (running → done) so status --job can inspect it [CLM-0073]', async () => {
    const kern = freshKernloop();
    const result = await runTool(
      kern,
      { goal: 'sync run records a job', capability: 'memory.episodic.read', id: 'task-sync-job' },
      { newJobId: () => 'job-sync-1' },
    );
    expect(result.kind).toBe('outcome'); // existing return shape unchanged
    const job = kern.jobs.getJob('job-sync-1');
    expect(job?.status).toBe('done');
    expect(job?.capability).toBe('memory.episodic.read');
    expect(job?.traceRef).toContain('task-sync-job');
    // the create + finish transitions are audited (rule 7)
    const types = readEnvelopes(kern.paths.audit).map((e) => e.type);
    expect(types).toContain('cli.job.created');
    expect(types).toContain('cli.job.finished');
    kern.close();
  });

  it('settles a failing synchronous run as a failed job and still re-throws [CLM-0073]', async () => {
    const kern = freshKernloop();
    await expect(
      runTool(
        kern,
        { goal: 'sync gate no workspace', capability: 'gate.quality', id: 'task-sync-fail' },
        { newJobId: () => 'job-sync-fail' },
      ),
    ).rejects.toThrow(ExecutionError);
    const job = kern.jobs.getJob('job-sync-fail');
    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('workspaceDir');
    kern.close();
  });

  it('run --async returns a job id immediately and settles the job done with a traceRef [CLM-0074]', async () => {
    const kern = freshKernloop();
    let settled: Promise<void> | undefined;
    const result = await runTool(
      kern,
      { goal: 'async read', capability: 'memory.episodic.read', id: 'task-async', async: true },
      { newJobId: () => 'job-async-1', onBackground: (p) => (settled = p) },
    );
    // returns promptly as a job, BEFORE the work has settled
    expect(result.kind).toBe('job');
    if (result.kind !== 'job') throw new Error('expected job');
    expect(result.jobId).toBe('job-async-1');
    expect(result.status).toBe('running');
    expect(kern.jobs.getJob('job-async-1')?.status).toBe('running');
    // let the background work settle
    expect(settled).toBeDefined();
    await settled;
    const job = kern.jobs.getJob('job-async-1');
    expect(job?.status).toBe('done');
    expect(job?.traceRef).toContain('task-async');
    kern.close();
  });

  it('records a failing async run as failed — never an unhandled rejection [CLM-0074]', async () => {
    const kern = freshKernloop();
    let settled: Promise<void> | undefined;
    const result = await runTool(
      kern,
      { goal: 'async gate no workspace', capability: 'gate.quality', async: true },
      { newJobId: () => 'job-async-fail', onBackground: (p) => (settled = p) },
    );
    expect(result.kind).toBe('job');
    // the background settle resolves (does not reject) — the error is recorded
    await expect(settled).resolves.toBeUndefined();
    const job = kern.jobs.getJob('job-async-fail');
    expect(job?.status).toBe('failed');
    expect(job?.error).toContain('workspaceDir');
    kern.close();
  });

  it('does not record a job for an unwired capability — no run actually started', async () => {
    const kern = freshKernloop();
    const result = await runTool(
      kern,
      {
        goal: 'write a fact through run',
        capability: 'memory.semantic.write',
        id: 'task-unwired-job',
      },
      { newJobId: () => 'job-should-not-exist' },
    );
    expect(result.kind).toBe('unwired');
    expect(kern.jobs.getJob('job-should-not-exist')).toBeUndefined();
    kern.close();
  });
});
