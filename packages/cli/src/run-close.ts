/**
 * Close an issue after a canonical-loop run SUCCEEDS (#211, CLM-0118) — the
 * run-success-driven counterpart to `program close`'s ledger-driven closure.
 * `kernloop run --closes-issue N` says "this run implements issue N"; on a
 * success Outcome the run closes N through the shared gated primitive
 * ({@link closeOneIssue}), double-gated by `tracker.tier: enforce`. A run that
 * did NOT succeed (escalated, failed, or a failure Outcome) skips the close —
 * an issue is only closed by EARNED success, never optimistically. Audited once
 * as `cli.run.close`; NEVER auto-merges anything (it only closes a tracker issue).
 */
import { appendEvent } from '@kernloop/kernel';
import type { TrackerExec } from '@kernloop/tracker';
import type { Kernloop } from './kernel.js';
import { buildGatedCloseProvider, closeOneIssue, type IssueCloseAction } from './tracker-close.js';

/** The result of a post-run issue close (printed alongside the run report). */
export interface RunCloseReport {
  readonly issue: string;
  readonly mode: 'dry-run' | 'execute';
  readonly refusedExecute: boolean;
  /** `skipped-run-not-success` when the run did not succeed; else the close action. */
  readonly action: IssueCloseAction | 'skipped-run-not-success';
  readonly reason?: string;
}

/**
 * Close `issueRef` iff `runSucceeded`. The provider build validates the tracker
 * config (a `--closes-issue` with no tracker is a clean error), but the gh
 * read/close only happen on success — a non-success run records the skip and
 * touches GitHub not at all. The close is execute only at `enforce` tier
 * (`--closes-issue` is the explicit opt-in); otherwise it reports `would-close`.
 */
export async function closeIssueAfterRun(
  kern: Kernloop,
  issueRef: string,
  runSucceeded: boolean,
  exec?: TrackerExec,
): Promise<RunCloseReport> {
  const { provider, mode, refusedExecute } = buildGatedCloseProvider(kern, true, exec);
  const out: { action: RunCloseReport['action']; reason?: string } = runSucceeded
    ? await closeOneIssue(provider, issueRef, mode, 'completed')
    : { action: 'skipped-run-not-success' };
  appendEvent(kern.store, {
    type: 'cli.run.close',
    payload: { issue: issueRef, mode, refusedExecute, action: out.action },
  });
  return {
    issue: issueRef,
    mode,
    refusedExecute,
    action: out.action,
    ...(out.reason === undefined ? {} : { reason: out.reason }),
  };
}
