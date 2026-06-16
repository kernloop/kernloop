/**
 * Shared single-issue close primitive for the gated tracker (#211). Both
 * `kernloop program close` (ledger-driven, #50/CLM-0116) and `kernloop run
 * --closes-issue` (run-success-driven, CLM-0118) reduce to the same act: READ an
 * issue (any tier — a read is not a mutation) and CLOSE it if OPEN, but only in
 * `execute` mode (resolveMode: `--execute`/opt-in AND `tracker.tier: enforce`).
 * Factoring it here keeps that one hardened behaviour in ONE place rather than
 * duplicated per caller.
 */
import {
  githubProvider,
  type GithubProviderHandle,
  type IssueState,
  type TrackerExec,
  type TrackerMode,
} from '@kernloop/tracker';
import type { Kernloop } from './kernel.js';
import { ProgramInputError } from './program-shared.js';
import { resolveMode } from './tracker-commands.js';

/** What a single-issue close decided after reading the issue. */
export type IssueCloseAction =
  | 'closed'
  | 'would-close'
  | 'already-closed'
  | 'read-failed'
  | 'close-failed';

/** The outcome of one {@link closeOneIssue} attempt. */
export interface IssueCloseOutcome {
  readonly action: IssueCloseAction;
  readonly githubState?: IssueState;
  /** Typed failure detail on a failed read/close — never set on success. */
  readonly reason?: string;
}

/**
 * Build the gated GitHub provider: a read runs at any tier, the close mutation
 * is double-gated by {@link resolveMode} (`executeFlag` AND `tracker.tier:
 * enforce`). A missing tracker block is a clean {@link ProgramInputError}.
 */
export function buildGatedCloseProvider(
  kern: Kernloop,
  executeFlag: boolean,
  exec: TrackerExec | undefined,
): { provider: GithubProviderHandle; mode: TrackerMode; refusedExecute: boolean } {
  const cfg = kern.config.tracker;
  if (cfg === undefined) {
    throw new ProgramInputError(
      'no tracker configured — add tracker: { provider: github, repo: owner/name } to overlay.yaml',
    );
  }
  const { mode, refusedExecute } = resolveMode(cfg.tier, executeFlag);
  const provider =
    exec === undefined
      ? githubProvider({ repo: cfg.repo }, mode)
      : githubProvider({ repo: cfg.repo }, mode, exec);
  return { provider, mode, refusedExecute };
}

/**
 * Read one issue and close it if OPEN — the close mutation only in `execute`
 * mode (a dry-run reports `would-close` and spawns no close). An already-closed
 * issue is a no-op; a failed read/close is reported and never throws.
 */
export async function closeOneIssue(
  provider: GithubProviderHandle,
  issueRef: string,
  mode: TrackerMode,
  closeReason: string,
): Promise<IssueCloseOutcome> {
  const read = await provider.getIssue(issueRef);
  if (!read.ok) return { action: 'read-failed', reason: read.reason };
  if (read.state === 'closed') return { action: 'already-closed', githubState: 'closed' };
  if (mode !== 'execute') return { action: 'would-close', githubState: 'open' };
  const res = await provider.closeIssue(issueRef, closeReason);
  return res.ok
    ? { action: 'closed', githubState: 'open' }
    : { action: 'close-failed', githubState: 'open', reason: res.reason };
}
