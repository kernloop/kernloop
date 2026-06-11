/**
 * Unit tests for the extended `status` tool [CLM-0073]: the existing task-id
 * (episodic trace) path still works, the new job-id path resolves a run's
 * recorded state, and — the cross-session property — a FRESH Kernloop over
 * the same overlay resolves a job a prior handle recorded. The input union
 * rejects mixing or omitting the two ids.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernloop, type Kernloop } from '../kernel.js';
import { runTool } from './run.js';
import { statusTool } from './status.js';

const dirs: string[] = [];
function freshOverlayDir(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-status-'));
  dirs.push(repo);
  return path.join(repo, '.kernloop');
}
function open(overlayDir: string): Kernloop {
  return createKernloop({ overlayDir, rng: () => 0.99 });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('statusTool', () => {
  it('still resolves a task id to its episodic trace summary (existing path)', async () => {
    const overlayDir = freshOverlayDir();
    const kern = open(overlayDir);
    await runTool(kern, {
      goal: 'recall for status by task',
      capability: 'memory.semantic.recall',
      id: 'task-status-by-task',
    });
    const result = statusTool(kern, { taskId: 'task-status-by-task' });
    expect(result.found).toBe(true);
    if (!result.found || !('trace' in result)) throw new Error('expected a trace');
    expect(result.trace.status).toBe('success');
    kern.close();
  });

  it('reports an unknown task id as not found, never invented', () => {
    const kern = open(freshOverlayDir());
    const result = statusTool(kern, { taskId: 'never-seen' });
    expect(result).toEqual({ found: false, taskId: 'never-seen' });
    kern.close();
  });

  it('resolves a job id to its recorded state (done + traceRef) [CLM-0073]', async () => {
    const kern = open(freshOverlayDir());
    await runTool(
      kern,
      { goal: 'status by job', capability: 'memory.episodic.read', id: 'task-sbj' },
      { newJobId: () => 'job-status-1' },
    );
    const result = statusTool(kern, { job: 'job-status-1' });
    expect(result.found).toBe(true);
    if (!result.found || !('job' in result)) throw new Error('expected a job');
    expect(result.job.status).toBe('done');
    expect(result.job.traceRef).toContain('task-sbj');
    kern.close();
  });

  it('reports an unknown job id as not found', () => {
    const kern = open(freshOverlayDir());
    expect(statusTool(kern, { job: 'no-such-job' })).toEqual({ found: false, job: 'no-such-job' });
    kern.close();
  });

  it('resolves a prior run job from a FRESH Kernloop over the same overlay (cross-session) [CLM-0073]', async () => {
    const overlayDir = freshOverlayDir();
    const first = open(overlayDir);
    await runTool(
      first,
      { goal: 'cross-session job', capability: 'memory.episodic.read', id: 'task-xsession' },
      { newJobId: () => 'job-xsession' },
    );
    first.close(); // session ends — handles closed
    const second = open(overlayDir); // a fresh "process" over the same files
    const result = statusTool(second, { job: 'job-xsession' });
    expect(result.found).toBe(true);
    if (!result.found || !('job' in result)) throw new Error('expected a job');
    expect(result.job.status).toBe('done');
    expect(result.job.goal).toBe('cross-session job');
    second.close();
  });

  it('rejects mixing or omitting the two ids (exactly one required)', () => {
    const kern = open(freshOverlayDir());
    // both ids present
    expect(() => statusTool(kern, { taskId: 't', job: 'j' } as never)).toThrow();
    // neither id present
    expect(() => statusTool(kern, {} as never)).toThrow();
    kern.close();
  });
});
