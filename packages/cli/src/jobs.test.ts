/**
 * Unit tests for the persisted job registry [CLM-0073]: the store API
 * round-trips, settles to terminal states, lists newest-first, and — the
 * load-bearing property — a job written by one store handle is resolvable by
 * a FRESH handle opened over the same file (cross-session, file-backed).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJobStore, type JobStore } from './jobs.js';

const dirs: string[] = [];
function freshDbPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-jobs-'));
  dirs.push(dir);
  return path.join(dir, 'jobs.sqlite');
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A monotonic injected clock so createdAt/finishedAt are deterministic. */
function tickingClock(start = 1_000): () => number {
  let t = start;
  return () => (t += 1);
}

describe('job registry store', () => {
  it('creates a running job, settles it done with a traceRef, and reads it back', () => {
    const store = createJobStore(freshDbPath(), { clock: tickingClock() });
    const created = store.createJob({
      jobId: 'job-1',
      capability: 'memory.episodic.read',
      goal: 'g',
    });
    expect(created.status).toBe('running');
    expect(created.finishedAt).toBeNull();
    expect(created.traceRef).toBeNull();
    const settled = store.finishJob('job-1', { status: 'done', traceRef: 'audit:x#task=t' });
    expect(settled?.status).toBe('done');
    expect(settled?.traceRef).toBe('audit:x#task=t');
    expect(settled?.finishedAt).toBeGreaterThan(created.createdAt);
    expect(store.getJob('job-1')).toEqual(settled);
    store.close();
  });

  it('settles a job failed with an error and no traceRef', () => {
    const store = createJobStore(freshDbPath(), { clock: tickingClock() });
    store.createJob({ jobId: 'job-f', capability: 'gate.quality', goal: 'g' });
    const settled = store.finishJob('job-f', { status: 'failed', error: 'boom' });
    expect(settled?.status).toBe('failed');
    expect(settled?.error).toBe('boom');
    expect(settled?.traceRef).toBeNull();
    store.close();
  });

  it('reports an absent job as undefined and finishing a missing job as undefined — never invented', () => {
    const store = createJobStore(freshDbPath());
    expect(store.getJob('nope')).toBeUndefined();
    expect(store.finishJob('nope', { status: 'done' })).toBeUndefined();
    store.close();
  });

  it('lists jobs newest-first, capped at the limit', () => {
    const store = createJobStore(freshDbPath(), { clock: tickingClock() });
    store.createJob({ jobId: 'a', capability: 'c', goal: 'g' });
    store.createJob({ jobId: 'b', capability: 'c', goal: 'g' });
    store.createJob({ jobId: 'c', capability: 'c', goal: 'g' });
    expect(store.listJobs().map((j) => j.jobId)).toEqual(['c', 'b', 'a']);
    expect(store.listJobs({ limit: 2 }).map((j) => j.jobId)).toEqual(['c', 'b']);
    store.close();
  });

  it('resolves a job written by a prior handle from a FRESH handle over the same file (cross-session)', () => {
    const dbPath = freshDbPath();
    const first: JobStore = createJobStore(dbPath, { clock: tickingClock() });
    first.createJob({ jobId: 'job-x', capability: 'memory.episodic.read', goal: 'cross' });
    first.finishJob('job-x', { status: 'done', traceRef: 'audit:y#task=t' });
    first.close();
    // A separate process is modeled by a separate store over the same file.
    const second = createJobStore(dbPath);
    const seen = second.getJob('job-x');
    expect(seen?.status).toBe('done');
    expect(seen?.traceRef).toBe('audit:y#task=t');
    expect(seen?.goal).toBe('cross');
    second.close();
  });
});
