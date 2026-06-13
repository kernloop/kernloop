/**
 * @kernloop/tracker — the provider-agnostic issue-tracker abstraction (spec
 * §5.5). A non-faculty SHARED library (like @kernloop/contracts): faculties
 * and the CLI may import it, but it imports no faculty. It defines the
 * {@link TrackerProvider} contract — the four WRITE ops `createIssue` /
 * `closeIssue` / `comment` / `addLabels` plus the READ op `getIssue` (an
 * issue's open/closed state), and a {@link TrackerCapabilities} descriptor for
 * honest degradation — and ships one secure, dry-run-first GitHub provider
 * built on the `gh` CLI ([CLM-0093], [CLM-0101]). The READ op is mode-
 * INDEPENDENT (a read is not a mutation, so it always reads); only the WRITE
 * ops are dry-run/enforce-gated.
 *
 * The outward-facing mutation is the GATED edge of the kernloop loop: it acts
 * only at the `enforce` authority tier and is human-ratified, never auto
 * (spec §3.2). `dry-run` is the safe default and spawns nothing. The GitHub
 * provider's command construction is hardened — no shell (args-array), body
 * via a 0700 temp file (flag-injection defense), an allowlisted `gh issue`
 * subcommand per op, the repo scoped from validated config, and no token
 * handling (gh's ambient auth only).
 */
export {
  BODY_MAX,
  CommentBodySchema,
  CreateIssueInputSchema,
  IssueRefSchema,
  LabelSchema,
  type CreateIssueInput,
  type ExecResult,
  type IssueState,
  type TrackerCapabilities,
  type TrackerExec,
  type TrackerExtensions,
  type TrackerFailure,
  type TrackerFailureReason,
  type TrackerMode,
  type TrackerOp,
  type TrackerProposal,
  type TrackerProvider,
  type TrackerReadResult,
  type TrackerResult,
  type TrackerSuccess,
} from './types.js';
export { defaultExec, spawnCapture } from './exec.js';
export {
  GH_CLOSE_REASONS,
  GH_SUBCOMMANDS,
  GithubConfigSchema,
  scrub,
  type GithubConfig,
} from './github.js';
export { githubProvider, type GithubProviderHandle } from './provider.js';
