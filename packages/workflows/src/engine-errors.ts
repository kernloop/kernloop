/**
 * Engine error classification (split from engine.ts to keep it under the LOC
 * budget, #58): the "kill" path vs an executor failure. Pure helpers the loop
 * calls when a node throws.
 */
import { WorkflowError } from './state.js';

/** True for AbortError throws and fired signals — the "kill" path [CLM-0044]. */
export function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

/** Wrap a non-engine throw in a typed WorkflowError. */
export function asWorkflowError(error: unknown, node: string, signal?: AbortSignal): WorkflowError {
  if (error instanceof WorkflowError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return isAbort(error, signal)
    ? new WorkflowError('aborted', `run aborted at node "${node}": ${message}`, { node })
    : new WorkflowError('executor_failed', `node "${node}" failed: ${message}`, {
        node,
        cause: error,
      });
}
