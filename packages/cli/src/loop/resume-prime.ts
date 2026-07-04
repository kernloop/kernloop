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
 * content is read back from the workspace ONCE, at resume start. The checkpoint
 * JSON lives under `.kernloop/` and is UNTRUSTED durable state: the write side
 * canonicalizes every path inside the workspace, but a tampered/corrupt
 * checkpoint could carry a `../`-bearing or symlinked path, so the read side
 * RE-CONFINES each path to the real workspace root (charter security round:
 * prefer realpath confinement over trusting the source) — an escaping path is
 * refused (never read) and recorded, not silently dropped.
 */
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { BriefSchema, TaskContractSchema } from '@kernloop/contracts';
import type { JsonlCheckpointStore, RunState } from '@kernloop/workflows';
import type { LoopRefs } from './executors.js';
import { LoopResumeError } from './invoke.js';

/** A checkpointed written-path refused on resume because it escaped the workspace. */
export interface RefusedResumePath {
  readonly childId: string;
  readonly path: string;
}

/** Prime the cross-node refs from a checkpoint so no node re-executes. */
function primeRefs(refs: LoopRefs, state: RunState): void {
  const framed = TaskContractSchema.safeParse(state.values['frame']);
  if (framed.success) refs.framedTask = framed.data;
  const research = BriefSchema.safeParse(state.values['research']);
  if (research.success) refs.researchBrief = research.data;
  const plan = BriefSchema.safeParse(state.values['plan']);
  if (plan.success) refs.planBrief = plan.data;
}

/** The real (symlink-resolved) workspace root, or the resolved path when the
 * workspace is absent (an anomaly on resume — confinement then still rejects a
 * `../` escape lexically). */
function workspaceRoot(workspaceDir: string): string {
  try {
    return realpathSync(path.resolve(workspaceDir));
  } catch {
    return path.resolve(workspaceDir);
  }
}

/**
 * Confine a checkpointed child-origin relative path to the workspace root and
 * return its absolute path, or `undefined` when it escapes (so the caller
 * refuses it). Two guards mirroring the write side (`writeWorkspaceFiles`):
 *  1. lexical — the resolved target must stay inside `rootReal` (rejects `..`);
 *  2. symlink — when the file exists, its realpath must ALSO stay inside, so a
 *     checkpointed path that is a symlink OUT of the workspace cannot read its
 *     target. A missing file (ENOENT) has nothing to escape through and is
 *     confined lexically only — the read then yields '' honestly.
 */
function confineToWorkspace(rootReal: string, rel: string): string | undefined {
  const target = path.resolve(rootReal, rel);
  if (target !== rootReal && !target.startsWith(rootReal + path.sep)) return undefined;
  let real: string;
  try {
    real = realpathSync(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return target; // gone: read yields ''
    throw err;
  }
  return real === rootReal || real.startsWith(rootReal + path.sep) ? real : undefined;
}

/**
 * Read one confined absolute path's content back from the workspace. ONLY a
 * missing file (ENOENT) degrades to '' — the workspace no longer holds what the
 * child wrote (an anomaly, since the resume operates on the SAME workspace the
 * crash left behind), and the doc/security scans scope by PATH so an empty body
 * judges nothing. A genuine read error (EACCES/EMFILE on a file that DOES exist)
 * SURFACES rather than silently yielding '' — an empty body would vacuously pass
 * the content scans (a security-smell fail-open, #543 review finding 3).
 */
function readWorkspaceFile(target: string): string {
  try {
    return readFileSync(target, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
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
 *
 * Each checkpointed path is RE-CONFINED to the workspace (see
 * {@link confineToWorkspace}); an escaping path is refused (its content never
 * enters the stash) and reported via `onRefuse`. A child whose EVERY path was
 * refused (a poisoned set) is left UNSET so the fail-closed whole-workspace
 * taint applies — never scoped to nothing, which would vacuously pass; a
 * legitimately empty set (no paths) still primes an empty entry.
 */
export function primeWrittenByChild(
  refs: LoopRefs,
  state: RunState,
  workspaceDir: string,
  onRefuse?: (refused: RefusedResumePath) => void,
): void {
  const rootReal = workspaceRoot(workspaceDir);
  for (const result of state.childResults) {
    if (result.writtenPaths === undefined) continue;
    const files: Array<{ path: string; content: string }> = [];
    let refused = 0;
    for (const rel of result.writtenPaths) {
      const target = confineToWorkspace(rootReal, rel);
      if (target === undefined) {
        refused += 1;
        onRefuse?.({ childId: result.child.id, path: rel });
        continue;
      }
      files.push({ path: rel, content: readWorkspaceFile(target) });
    }
    if (files.length === 0 && refused > 0) continue; // poisoned set → fail-closed taint
    refs.writtenByChild ??= {};
    refs.writtenByChild[result.child.id] = files;
  }
}

/**
 * Load the latest checkpoint for a resumed run and prime the cross-node refs,
 * INCLUDING the written-files stash (#543). `checkpointPath` is only for the
 * error message on a missing checkpoint (the caller already knows it). A
 * refused (workspace-escaping) checkpointed path is reported via `onRefuse` so
 * the caller can audit it — never silently dropped.
 */
export async function primeFromCheckpoint(
  checkpoints: JsonlCheckpointStore,
  runId: string,
  refs: LoopRefs,
  workspaceDir: string,
  checkpointPath: string,
  onRefuse?: (refused: RefusedResumePath) => void,
): Promise<void> {
  const latest = await checkpoints.latest(runId);
  if (latest === undefined) throw new LoopResumeError(runId, checkpointPath);
  primeRefs(refs, latest.state);
  primeWrittenByChild(refs, latest.state, workspaceDir, onRefuse);
}
