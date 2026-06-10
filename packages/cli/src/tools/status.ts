/**
 * `status` — async job inspection, cross-session (spec §3.4): task id →
 * task state. P1 task state is the episodic trace summary the run tool
 * recorded; SQLite persistence is what makes the answer survive across
 * sessions. A task memory has never seen is reported `found: false`, never
 * invented.
 */
import { z } from 'zod';
import type { TraceSummary } from '@kernloop/faculty-memory';
import type { Kernloop } from '../kernel.js';

/** Input to the `status` tool. */
export const StatusInputSchema = z.strictObject({
  taskId: z.string().min(1),
});
export type StatusInput = z.input<typeof StatusInputSchema>;

/** What `status` returns. */
export type StatusResult = { found: true; trace: TraceSummary } | { found: false; taskId: string };

/** The `status` tool. See module docs. */
export function statusTool(kern: Kernloop, input: StatusInput): StatusResult {
  const { taskId } = StatusInputSchema.parse(input);
  const trace = kern.memory.getTraceSummary(taskId);
  return trace === undefined ? { found: false, taskId } : { found: true, trace };
}
