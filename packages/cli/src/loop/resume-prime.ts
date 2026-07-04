/**
 * Prime the composition root's cross-node refs from a resumed run's latest
 * checkpoint — split out of loop/index.ts for line-count headroom (#58
 * pattern). Two parts: `primeRefs` restores the main-chain values so no node
 * re-executes (unchanged behavior); `primeWrittenByChild` rebuilds the CLI's
 * in-memory written-files stash from the checkpoint's per-child `writtenPaths`
 * (#543, CLM-0199).
 *
 * The checkpoint durably records only PATHS: content is never duplicated into
 * it (it's on disk in the workspace the resume operates on), so each path's
 * content is read back from the workspace ONCE, at resume start.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BriefSchema, TaskContractSchema } from '@kernloop/contracts';
import type { JsonlCheckpointStore, RunState } from '@kernloop/workflows';
import type { LoopRefs } from './executors.js';
import { LoopResumeError } from './invoke.js';

/** Prime the cross-node refs from a checkpoint so no node re-executes. */
function primeRefs(refs: LoopRefs, state: RunState): void {
  const framed = TaskContractSchema.safeParse(state.values['frame']);
  if (framed.success) refs.framedTask = framed.data;
  const research = BriefSchema.safeParse(state.values['research']);
  if (research.success) refs.researchBrief = research.data;
  const plan = BriefSchema.safeParse(state.values['plan']);
  if (plan.success) refs.planBrief = plan.data;
}

/**
 * Read one written file's content back from the workspace. An unreadable path
 * (the workspace no longer holds what the child wrote — an anomaly, since the
 * resume operates on the SAME workspace the crash left behind) degrades to
 * empty content for just that file rather than aborting the whole resume: the
 * doc-comment/security scans that matter most here scope by PATH alone.
 */
function readWorkspaceFile(workspaceDir: string, rel: string): string {
  try {
    return readFileSync(path.join(workspaceDir, rel), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Rebuild `refs.writtenByChild` from the checkpoint's per-child `writtenPaths`
 * (#543): a child with a checkpointed set gets its stash REBUILT here, so the
 * scoped child quality gate (and the review/parsimony gates reading the same
 * stash) resumes with the durable union instead of falling back to the
 * whole-workspace scan + sticky taint (CLM-0189's fail-closed degradation,
 * still the fallback for a child with NEITHER a live stash NOR a checkpointed
 * set — e.g. a pre-#543 checkpoint, or a child whose implement never ran).
 */
export function primeWrittenByChild(refs: LoopRefs, state: RunState, workspaceDir: string): void {
  for (const result of state.childResults) {
    if (result.writtenPaths === undefined) continue;
    const files = result.writtenPaths.map((rel) => ({
      path: rel,
      content: readWorkspaceFile(workspaceDir, rel),
    }));
    refs.writtenByChild ??= {};
    refs.writtenByChild[result.child.id] = files;
  }
}

/**
 * Load the latest checkpoint for a resumed run and prime the cross-node refs,
 * INCLUDING the written-files stash (#543). `checkpointPath` is only for the
 * error message on a missing checkpoint (the caller already knows it).
 */
export async function primeFromCheckpoint(
  checkpoints: JsonlCheckpointStore,
  runId: string,
  refs: LoopRefs,
  workspaceDir: string,
  checkpointPath: string,
): Promise<void> {
  const latest = await checkpoints.latest(runId);
  if (latest === undefined) throw new LoopResumeError(runId, checkpointPath);
  primeRefs(refs, latest.state);
  primeWrittenByChild(refs, latest.state, workspaceDir);
}
