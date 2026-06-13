/**
 * The GitHub {@link TrackerProvider}, built on the `gh` CLI (spec §5.5). This
 * is the SECURITY-CRITICAL edge: it constructs `gh` invocations from agent-
 * and human-authored issue content. Every construction rule here exists to
 * deny that content any authority it should not have:
 *
 *  - NO SHELL, EVER. `gh` is invoked through {@link spawnCapture} with an
 *    args-array (`shell: false`); nothing is interpolated into a command line.
 *  - SUBCOMMAND ALLOWLIST. The `gh issue <create|close|comment|edit>` verb is
 *    HARD-CODED per operation, never derived from input. The provider cannot
 *    construct any other `gh` subcommand.
 *  - REPO FROM CONFIG. `--repo owner/name` comes from the validated config,
 *    never from issue content; the repo string is shape-validated.
 *  - FLAG-INJECTION DEFENSE. The body is written to a fresh 0700 mkdtemp DIR
 *    and a 0600 `body.md` file inside it, passed via `--body-file <path>`
 *    (never `--body <text>`), so a body that starts with `-` cannot be read as
 *    a flag. The title is passed in the `--title=<value>` `=` form, which binds
 *    the value to the flag regardless of a leading `-`. Labels are charset-
 *    validated (no leading `-` possible) AND passed as `--add-label=<value>`.
 *    The close reason is allowlisted and passed `--reason=<value>`.
 *  - REF BOUND TO THE CONFIGURED REPO. An issue ref is normalized to a bare
 *    issue NUMBER; a URL ref is accepted ONLY when it is a `github.com` URL
 *    whose `owner/repo` equals the configured repo, and even then its number
 *    (never the URL) reaches `gh` — so a ref can never redirect `gh` to another
 *    repo or host (no cross-repo action, no SSRF).
 *  - NO TOKEN HANDLING. `gh` uses its own ambient auth; kernloop never reads
 *    or passes a token. Surfaced CLI output is scrubbed (see {@link scrub}).
 *  - DRY-RUN SPAWNS NOTHING. In `dry-run` mode every op returns the would-be
 *    argv as a proposal without touching the executor.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  IssueRefSchema,
  LabelSchema,
  type ExecResult,
  type IssueState,
  type TrackerCapabilities,
  type TrackerFailure,
  type TrackerFailureReason,
  type TrackerOp,
} from './types.js';

/** `gh` repo scope: `owner/name`, each segment a conservative safe charset. */
export const GithubConfigSchema = z.strictObject({
  repo: z
    .string()
    .regex(
      /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/,
      'repo must be "owner/name" using only letters, digits, and . _ -',
    ),
});
export type GithubConfig = z.infer<typeof GithubConfigSchema>;

/**
 * The only `gh issue` subcommands this provider may ever construct (allowlist).
 * `view` is the sole READ verb (used by getIssue); the rest are WRITES.
 */
export const GH_SUBCOMMANDS = ['create', 'close', 'comment', 'edit', 'view'] as const;
type GhSubcommand = (typeof GH_SUBCOMMANDS)[number];

/** The GitHub provider supports every core operation, including the READ op. */
const GITHUB_CAPABILITIES: TrackerCapabilities = {
  createIssue: true,
  closeIssue: true,
  comment: true,
  addLabels: true,
  getIssue: true,
};

/**
 * The HARD-CODED `--json` field allowlist for `gh issue view`. Never sourced
 * from input — the only structured fields the READ op ever requests are the
 * issue number and its open/closed state, so the read surface cannot be widened
 * by a caller into leaking arbitrary issue content.
 */
const VIEW_JSON_FIELDS = 'number,state';

/**
 * Scrub surfaced CLI output of anything that could leak a secret or a local
 * path: collapse `token`/`key`/`secret`-prefixed values, strip absolute file
 * paths (incl. the temp body-file path), and bound the length. Defensive — gh
 * does not print the token, but error text is never surfaced raw.
 */
export function scrub(text: string): string {
  return (
    text
      .replace(/\b(token|key|secret|password|bearer)\b[=:\s]+\S+/gi, '$1=[redacted]')
      // GitHub token shapes, even with no nearby keyword (ghp_/gho_/ghu_/ghs_/ghr_, fine-grained PAT).
      .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted-token]')
      .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted-token]')
      // URL userinfo (`https://user:tok@host`) — redact before the path collapse.
      .replace(/:\/\/[^/@\s]+@/g, '://[redacted]@')
      .replace(/(?:\/[\w.-]+){2,}/g, '[path]')
      .trim()
      .slice(0, 500)
  );
}

function failure(reason: TrackerFailureReason, message: string): TrackerFailure {
  return { ok: false, reason, message: scrub(message) };
}

/** The repo scope args, sourced ONLY from validated config. */
function repoArgs(config: GithubConfig): readonly string[] {
  return ['--repo', config.repo];
}

/**
 * Build the args-array for a `gh issue <sub>` invocation. The subcommand is an
 * allowlisted literal passed by the caller per-operation (never from input);
 * `--` terminates flags before any positional issue ref so a ref can never be
 * read as a flag. Returns `['issue', sub, ...repo, ...op, ...positionals]`.
 */
function ghArgv(
  sub: GhSubcommand,
  config: GithubConfig,
  opArgs: readonly string[],
  positionals: readonly string[] = [],
): string[] {
  const tail = positionals.length > 0 ? ['--', ...positionals] : [];
  return ['issue', sub, ...repoArgs(config), ...opArgs, ...tail];
}

/** Resolve the created/affected ref from gh stdout: the last URL it printed, else the input ref. */
function refFromOutput(result: ExecResult, fallback: string): string {
  const url = result.stdout.trim().split('\n').at(-1) ?? '';
  return /^https?:\/\//.test(url) ? url : fallback;
}

/**
 * Build the argv for the READ op: `gh issue view --repo o/n --json number,state
 * -- <number>`. The `--json` field list is the HARD-CODED {@link
 * VIEW_JSON_FIELDS} allowlist, NEVER from input; the (already repo-bound, bare
 * number) ref is the sole positional behind `--`, so it can never be read as a
 * flag and can never widen the requested fields. Mirrors the write ops' posture.
 */
function viewArgv(config: GithubConfig, ref: string): string[] {
  return ghArgv('view', config, ['--json', VIEW_JSON_FIELDS], [ref]);
}

/** The expected shape of `gh issue view --json number,state` stdout. */
const ViewJsonSchema = z.object({
  number: z.number().int().nonnegative(),
  state: z.string(),
});

/**
 * Parse `gh issue view --json number,state` stdout into the normalized
 * {@link IssueState}. `gh` returns `state` as `"OPEN"|"CLOSED"`; we lowercase
 * it to `open|closed`. A non-JSON body, a wrong shape, or an unexpected state
 * value is a typed `parse-failed` {@link TrackerFailure} (scrubbed) — never a
 * thrown error, mirroring the write ops' errors-as-data posture.
 */
function parseIssueState(stdout: string): { state: IssueState } | TrackerFailure {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return failure('parse-failed', 'gh issue view did not return valid JSON');
  }
  const parsed = ViewJsonSchema.safeParse(raw);
  if (!parsed.success) {
    return failure('parse-failed', 'gh issue view JSON missing number/state fields');
  }
  const normalized = parsed.data.state.toLowerCase();
  if (normalized !== 'open' && normalized !== 'closed') {
    return failure(
      'parse-failed',
      `gh issue view returned an unexpected state "${parsed.data.state}"`,
    );
  }
  return { state: normalized };
}

interface BodyFile {
  readonly dir: string;
  readonly file: string;
}

/** Write `body` to a fresh 0700 mkdtemp dir / 0600 file inside it; the caller deletes the dir after. */
function writeBodyFile(body: string): BodyFile {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-tracker-'), { encoding: 'utf8' });
  const file = path.join(dir, 'body.md');
  writeFileSync(file, body, { encoding: 'utf8', mode: 0o600 });
  return { dir, file };
}

interface GhPlan {
  readonly op: TrackerOp;
  /** The op-specific flag args (excludes the body-file flag, added at run time). */
  readonly opArgs: readonly string[];
  readonly positionals: readonly string[];
  /** The body routed through a temp file, if any (flag-injection defense). */
  readonly body?: string;
  readonly sub: GhSubcommand;
  /** The ref to resolve to on success when gh prints no URL. */
  readonly fallbackRef: string;
}

/** A `github.com` issue URL: captures `owner/repo` and the trailing number. */
const GH_ISSUE_URL = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)$/;

/**
 * Normalize an issue ref to a bare issue NUMBER scoped to the configured repo,
 * or a typed failure. A bare number or `#42` passes through as its digits. A
 * URL is accepted ONLY when it is a `github.com` issue URL whose `owner/repo`
 * exactly equals `config.repo` — and even then the NUMBER (never the URL) is
 * what reaches `gh`, so a ref can never redirect `gh` to another repo or host
 * (no cross-repo action, no SSRF) [CLM-0093].
 */
function parseRef(ref: string, config: GithubConfig): { ref: string } | TrackerFailure {
  const parsed = IssueRefSchema.safeParse(ref);
  if (!parsed.success)
    return failure('invalid-input', parsed.error.issues[0]?.message ?? 'bad ref');
  const value = parsed.data.trim();
  const bare = /^#?(\d+)$/.exec(value);
  if (bare) return { ref: bare[1]! };
  const url = GH_ISSUE_URL.exec(value);
  if (url && url[1] === config.repo) return { ref: url[2]! };
  return failure(
    'invalid-input',
    'issue ref must be a number, "#N", or a github.com issue URL in the configured repo',
  );
}

/** Validate labels to the safe charset, or a typed failure. */
function parseLabels(labels: readonly string[]): { labels: string[] } | TrackerFailure {
  const parsed = z.array(LabelSchema).min(1).max(20).safeParse(labels);
  if (!parsed.success)
    return failure('invalid-input', parsed.error.issues[0]?.message ?? 'bad label');
  return { labels: parsed.data };
}

/** The only values `gh issue close --reason` accepts (allowlist). */
export const GH_CLOSE_REASONS = ['completed', 'not planned'] as const;

/**
 * Validate a close reason against the allowlist, or a typed failure. Defense-
 * in-depth: `gh` itself rejects other values, but allowlisting here keeps the
 * one user-influenced close arg from ever reaching `gh` un-vetted.
 */
function parseReason(reason: string): { reason: string } | TrackerFailure {
  if (!(GH_CLOSE_REASONS as readonly string[]).includes(reason))
    return failure('invalid-input', 'close reason must be "completed" or "not planned"');
  return { reason };
}

export {
  GITHUB_CAPABILITIES,
  ghArgv,
  refFromOutput,
  viewArgv,
  parseIssueState,
  writeBodyFile,
  failure,
  parseRef,
  parseLabels,
  parseReason,
  type GhPlan,
  type BodyFile,
  type GhSubcommand,
};
