/**
 * Job-registry lifecycle for the `run` tool (spec §3.4; CLM-0073/0074). Every
 * executed run is wrapped here: a `running` job is recorded before any work,
 * and settled to `done` (with the Outcome's traceRef) or `failed` (with the
 * error) when the work finishes. `status --job <jobId>` inspects the result,
 * cross-session, because the registry is file-backed.
 *
 * `run --async` kicks the work off WITHOUT awaiting — a background promise in
 * the resident MCP server — and returns the job id immediately; the terminal
 * state lands when the work settles. A background failure is caught and
 * recorded as `failed`, never an unhandled rejection.
 *
 * Split out of run.ts to keep both files inside the LOC budget. The work is
 * passed in as a thunk so this module needs no run-tool runtime import (the
 * RunResult type is erased at compile time — no runtime cycle).
 */
import { appendEvent } from '@kernloop/kernel';
import type { TaskContract } from '@kernloop/contracts';
import type { Kernloop } from '../kernel.js';
import type { RunResult } from './run.js';

/** The Outcome's traceRef when a RunResult carries one (done jobs record it). */
function traceRefOf(result: RunResult): string | undefined {
  return result.kind === 'outcome' || result.kind === 'escalated'
    ? result.outcome.traceRef
    : undefined;
}

/** Create a `running` job row and append the `cli.job.created` audit event
 * (rule 7: a created job is a recorded state transition). */
function openJob(kern: Kernloop, jobId: string, capability: string, goal: string): void {
  kern.jobs.createJob({ jobId, capability, goal });
  appendEvent(kern.store, {
    type: 'cli.job.created',
    payload: { jobId, capability, status: 'running' },
  });
}

/** Settle a job to done/failed and append the `cli.job.finished` audit event. */
function closeJob(
  kern: Kernloop,
  jobId: string,
  settle: { status: 'done' | 'failed'; traceRef?: string; error?: string },
): void {
  kern.jobs.finishJob(jobId, {
    status: settle.status,
    ...(settle.traceRef === undefined ? {} : { traceRef: settle.traceRef }),
    ...(settle.error === undefined ? {} : { error: settle.error }),
  });
  appendEvent(kern.store, {
    type: 'cli.job.finished',
    payload: { jobId, status: settle.status },
  });
}

/** Settle a job from a finished RunResult: done with its traceRef. */
function settleFromResult(kern: Kernloop, jobId: string, result: RunResult): void {
  const traceRef = traceRefOf(result);
  closeJob(kern, jobId, { status: 'done', ...(traceRef === undefined ? {} : { traceRef }) });
}

/** Record a thrown error as a `failed` job (the never-unhandled-rejection path). */
function settleFromError(kern: Kernloop, jobId: string, error: unknown): void {
  closeJob(kern, jobId, {
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  });
}

/** Whether `run --async` was requested, and the id to record the job under. */
export interface JobControl {
  readonly async: boolean;
  readonly jobId: string;
  /**
   * Receives the background settle promise for an async run. The resident MCP
   * server ignores it (the work overlaps and settles on its own). The one-shot
   * CLI awaits it before closing the overlay, so an async CLI run still settles
   * its job before the process exits (true backgrounding matters for the
   * resident server; the CLI is honest that it drains before exit).
   */
  readonly onBackground?: (settled: Promise<void>) => void;
}

/**
 * Run a unit of work under a recorded job. The job is created `running`
 * before `work()` starts. Synchronously, the job is settled and the
 * RunResult returned unchanged (a thrown executor error settles `failed` and
 * re-throws, preserving the run tool's existing throwing contract).
 * Asynchronously, the job id is returned immediately and the job settles in
 * the background — the settle promise is handed to `onBackground` so a
 * one-shot host can drain it before teardown.
 */
export function runUnderJob(
  kern: Kernloop,
  task: TaskContract,
  capability: string,
  control: JobControl,
  work: () => Promise<RunResult>,
): Promise<RunResult> {
  openJob(kern, control.jobId, capability, task.goal);
  const settling = work();
  if (!control.async) {
    return settling.then(
      (result) => {
        settleFromResult(kern, control.jobId, result);
        return result;
      },
      (error: unknown) => {
        settleFromError(kern, control.jobId, error);
        throw error;
      },
    );
  }
  const settled = settling.then(
    (result) => settleFromResult(kern, control.jobId, result),
    (error: unknown) => settleFromError(kern, control.jobId, error),
  );
  control.onBackground?.(settled);
  return Promise.resolve({ kind: 'job', task, jobId: control.jobId, status: 'running' });
}
