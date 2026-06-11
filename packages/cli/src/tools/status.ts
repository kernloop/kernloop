/**
 * `status` — async job inspection, cross-session (spec §3.4): EITHER a task
 * id (episodic trace lookup) OR a job id (job-registry lookup). Both answers
 * survive across sessions because both stores are repo-local SQLite — a fresh
 * Kernloop over the same overlay resolves a prior trace or job by id
 * [CLM-0073]. A task or job memory has never seen is reported `found: false`,
 * never invented.
 *
 * The input is a discriminated union on which id was given; exactly one is
 * required (zod rejects both-or-neither at the boundary), so a `status` call
 * is always unambiguous about what it inspects.
 */
import { z } from 'zod';
import type { TraceSummary } from '@kernloop/faculty-memory';
import type { Kernloop } from '../kernel.js';
import type { JobRow } from '../jobs.js';

/**
 * Input to the `status` tool: a task id OR a job id, exactly one. The union
 * keeps the existing `{ taskId }` shape working unchanged and adds the new
 * `{ job }` shape; `strictObject` on each arm rejects mixing the two.
 */
export const StatusInputSchema = z.union([
  z.strictObject({ taskId: z.string().min(1) }),
  z.strictObject({ job: z.string().min(1) }),
]);
export type StatusInput = z.input<typeof StatusInputSchema>;

/** What `status` returns — a union over which store answered. */
export type StatusResult =
  | { found: true; trace: TraceSummary }
  | { found: false; taskId: string }
  | { found: true; job: JobRow }
  | { found: false; job: string };

/** Inspect a job by id in the persisted registry (CLM-0073). */
function statusByJob(kern: Kernloop, jobId: string): StatusResult {
  const job = kern.jobs.getJob(jobId);
  return job === undefined ? { found: false, job: jobId } : { found: true, job };
}

/** Inspect a task by id in episodic memory (the existing path). */
function statusByTask(kern: Kernloop, taskId: string): StatusResult {
  const trace = kern.memory.getTraceSummary(taskId);
  return trace === undefined ? { found: false, taskId } : { found: true, trace };
}

/** The `status` tool. See module docs. */
export function statusTool(kern: Kernloop, input: StatusInput): StatusResult {
  const parsed = StatusInputSchema.parse(input);
  return 'job' in parsed ? statusByJob(kern, parsed.job) : statusByTask(kern, parsed.taskId);
}
