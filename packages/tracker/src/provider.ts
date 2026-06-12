/**
 * The {@link githubProvider} factory (spec §5.5): assembles the per-operation
 * `gh` plans (built by the allowlisted, flag-injection-guarded helpers in
 * github.ts) into a {@link TrackerProvider}. Mode is carried by the provider:
 * `dry-run` returns the would-be argv as a proposal and SPAWNS NOTHING;
 * `execute` writes the body temp file, runs the allowlisted `gh` subcommand,
 * deletes the temp file, and resolves the affected ref — errors as data.
 */
import { rmSync } from 'node:fs';
import {
  CommentBodySchema,
  CreateIssueInputSchema,
  type CreateIssueInput,
  type TrackerCapabilities,
  type TrackerExec,
  type TrackerMode,
  type TrackerProposal,
  type TrackerProvider,
  type TrackerResult,
} from './types.js';
import { defaultExec } from './exec.js';
import {
  GITHUB_CAPABILITIES,
  GithubConfigSchema,
  failure,
  ghArgv,
  parseLabels,
  parseRef,
  parseReason,
  refFromOutput,
  writeBodyFile,
  type BodyFile,
  type GhPlan,
  type GithubConfig,
} from './github.js';

/** The `gh` command name; hard-coded, never derived from input. */
const GH = 'gh';

/** A dry-run proposal carries a synthetic ref so the result shape is uniform. */
const DRY_RUN_REF = 'dry-run://no-mutation';

/** Build the proposal (would-be invocation) for a plan, body routed via file. */
function proposalFor(plan: GhPlan, config: GithubConfig): TrackerProposal {
  const bodyFlag = plan.body === undefined ? [] : ['--body-file', '<tmpfile>'];
  return {
    op: plan.op,
    command: GH,
    argv: ghArgv(plan.sub, config, [...plan.opArgs, ...bodyFlag], plan.positionals),
    bodyViaFile: plan.body !== undefined,
  };
}

/** Execute a plan against `gh`: write body file, run, clean up, resolve ref.
 * Errors are DATA: a body-file write failure or any unexpected throw becomes a
 * typed `io-failed`, and the temp dir is always removed (the write is INSIDE
 * the try so the `finally` covers a partial create — no leak, no throw). */
async function runPlan(
  plan: GhPlan,
  config: GithubConfig,
  exec: TrackerExec,
): Promise<TrackerResult> {
  let written: BodyFile | undefined;
  try {
    written = plan.body === undefined ? undefined : writeBodyFile(plan.body);
    const bodyFlag = written === undefined ? [] : ['--body-file', written.file];
    const argv = ghArgv(plan.sub, config, [...plan.opArgs, ...bodyFlag], plan.positionals);
    const result = await exec(GH, argv);
    if (result.spawnError !== undefined) {
      return failure('spawn-failed', `gh could not be started: ${result.spawnError}`);
    }
    if (result.exitCode !== 0) {
      return failure('exit-nonzero', `gh exited ${String(result.exitCode)}: ${result.stderr}`);
    }
    return { ok: true, ref: refFromOutput(result, plan.fallbackRef) };
  } catch (err) {
    return failure(
      'io-failed',
      `tracker op failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    if (written !== undefined) rmSync(written.dir, { recursive: true, force: true });
  }
}

/** Dispatch a plan by mode: dry-run proposes (no spawn), execute runs gh. */
async function dispatch(
  plan: GhPlan,
  config: GithubConfig,
  mode: TrackerMode,
  exec: TrackerExec,
  proposals: TrackerProposal[],
): Promise<TrackerResult> {
  if (mode === 'dry-run') {
    proposals.push(proposalFor(plan, config));
    return { ok: true, ref: DRY_RUN_REF };
  }
  return runPlan(plan, config, exec);
}

/** Plan: `gh issue create --title=<t> [--label=<l>...] --body-file <f>`. */
function createPlan(input: CreateIssueInput): GhPlan {
  const opArgs = [`--title=${input.title}`, ...(input.labels ?? []).map((l) => `--label=${l}`)];
  return {
    op: 'createIssue',
    sub: 'create',
    opArgs,
    positionals: [],
    body: input.body,
    fallbackRef: '',
  };
}

/** Plan: `gh issue close [--reason=<r>] -- <ref>` (reason allowlisted, `=` form). */
function closePlan(ref: string, reason?: string): GhPlan {
  const opArgs = reason === undefined ? [] : [`--reason=${reason}`];
  return { op: 'closeIssue', sub: 'close', opArgs, positionals: [ref], fallbackRef: ref };
}

/** Plan: `gh issue comment --body-file <f> -- <ref>`. */
function commentPlan(ref: string, body: string): GhPlan {
  return { op: 'comment', sub: 'comment', opArgs: [], positionals: [ref], body, fallbackRef: ref };
}

/** Plan: `gh issue edit --add-label=<l>... -- <ref>`. */
function addLabelsPlan(ref: string, labels: readonly string[]): GhPlan {
  return {
    op: 'addLabels',
    sub: 'edit',
    opArgs: labels.map((l) => `--add-label=${l}`),
    positionals: [ref],
    fallbackRef: ref,
  };
}

/** Options for {@link githubProvider} (carries the captured dry-run proposals). */
export interface GithubProviderHandle extends TrackerProvider {
  /**
   * The dry-run proposals captured this session (the would-be `gh`
   * invocations). Empty in `execute` mode; the CLI prints these as the
   * "DRY RUN" notice.
   */
  readonly proposals: readonly TrackerProposal[];
}

/**
 * Build a GitHub {@link TrackerProvider} over `gh` [CLM-0093]. `config` is
 * validated (repo `owner/name` shape); `mode` carries the dry-run/execute
 * decision (the composition root sets `execute` ONLY at the `enforce` tier);
 * `exec` is injectable for tests (default spawns the real `gh`, no shell).
 * Every method validates its input at the boundary and returns errors as data
 * — it never throws and, in `dry-run`, never spawns.
 */
export function githubProvider(
  config: GithubConfig,
  mode: TrackerMode,
  exec: TrackerExec = defaultExec,
): GithubProviderHandle {
  const cfg = GithubConfigSchema.parse(config);
  const proposals: TrackerProposal[] = [];
  const run = (plan: GhPlan): Promise<TrackerResult> => dispatch(plan, cfg, mode, exec, proposals);
  return {
    mode,
    proposals,
    capabilities(): TrackerCapabilities {
      return GITHUB_CAPABILITIES;
    },
    async createIssue(input: CreateIssueInput): Promise<TrackerResult> {
      const parsed = CreateIssueInputSchema.safeParse(input);
      if (!parsed.success)
        return failure('invalid-input', parsed.error.issues[0]?.message ?? 'bad input');
      return run(createPlan(parsed.data));
    },
    async closeIssue(ref: string, reason?: string): Promise<TrackerResult> {
      const r = parseRef(ref, cfg);
      if ('ok' in r) return r;
      if (reason !== undefined) {
        const rr = parseReason(reason);
        if ('ok' in rr) return rr;
      }
      return run(closePlan(r.ref, reason));
    },
    async comment(ref: string, body: string): Promise<TrackerResult> {
      const r = parseRef(ref, cfg);
      if ('ok' in r) return r;
      const parsed = CommentBodySchema.safeParse(body);
      if (!parsed.success)
        return failure('invalid-input', parsed.error.issues[0]?.message ?? 'bad comment body');
      return run(commentPlan(r.ref, parsed.data));
    },
    async addLabels(ref: string, labels: readonly string[]): Promise<TrackerResult> {
      const r = parseRef(ref, cfg);
      if ('ok' in r) return r;
      const l = parseLabels(labels);
      if ('ok' in l) return l;
      return run(addLabelsPlan(r.ref, l.labels));
    },
  };
}
