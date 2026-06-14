/**
 * The `kernloop tracker` CLI surface (spec §5.5) [CLM-0093]. This is a CLI
 * VERB, NOT a 12th MCP tool: `tracker create|close|comment|label`. It is the
 * real, wiring-complete consumer of the @kernloop/tracker GitHub provider, and
 * it is DRY-RUN BY DEFAULT — a `create`/`close`/`comment`/`label` prints the
 * would-be `gh` invocation under a clear "DRY RUN" notice and spawns nothing.
 *
 * `--execute` is honored ONLY when the overlay grants the tracker the
 * `enforce` tier (`tracker.tier: enforce`). At `suggest` (the default) an
 * `--execute` is refused — recorded in the output and audit — and the op stays
 * dry-run: the system never defaults upward (spec §3.2). Bodies come from a
 * `--body-file` (mirroring the provider's own flag-injection defense). Every
 * op is audited as `cli.tracker.<op>` with op, ref, mode, and tier — never the
 * body verbatim (only a bounded char count), so audit cannot leak issue text.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { appendEvent } from '@kernloop/kernel';
import {
  githubProvider,
  type GithubProviderHandle,
  type TrackerExec,
  type TrackerMode,
  type TrackerResult,
} from '@kernloop/tracker';
import type { CliIo } from './cli.js';
import { createKernloop } from './kernel.js';
import type { Kernloop } from './kernel.js';
import type { CommandHelpers } from './portability-commands.js';

/** The four tracker verbs this surface exposes. */
export const TRACKER_OPS = ['create', 'close', 'comment', 'label'] as const;
type TrackerCliOp = (typeof TRACKER_OPS)[number];

/** Resolve the acting mode: `execute` ONLY at the enforce tier AND with --execute. */
export function resolveMode(
  tier: 'suggest' | 'enforce' | undefined,
  executeFlag: boolean,
): { mode: TrackerMode; refusedExecute: boolean } {
  if (!executeFlag) return { mode: 'dry-run', refusedExecute: false };
  if (tier === 'enforce') return { mode: 'execute', refusedExecute: false };
  // --execute asked for, but the tier does not grant it: stay dry-run, flag it.
  return { mode: 'dry-run', refusedExecute: true };
}

/** Read a `--body-file`'s contents, resolved against cwd. */
function readBody(io: CliIo, file: string): string {
  return readFileSync(path.resolve(io.cwd, file), 'utf8');
}

/** Count occurrences of `--<name>` / `--<name>=…` in raw flag args (both forms). */
/** Collect EVERY value of a repeated `--name X` / `--name=X` flag, in order
 * (#76) — `parseArgs` keeps only the last, so multi-label input is gathered
 * here. A bare `--name` with no following value (or a `--flag` next) is skipped. */
function collectFlag(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === `--${name}`) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out.push(next);
        i += 1;
      }
    } else if (a.startsWith(`--${name}=`)) {
      out.push(a.slice(name.length + 3));
    }
  }
  return out;
}

interface OpOutcome {
  readonly op: TrackerCliOp;
  readonly ref: string;
  readonly result: TrackerResult;
  /** Body length in chars, never the body itself (audit must not leak text). */
  readonly bodyChars: number;
}

/** Dispatch one verb against the provider; returns the op outcome. */
async function dispatchOp(
  provider: GithubProviderHandle,
  io: CliIo,
  op: TrackerCliOp,
  v: Record<string, string | boolean>,
  str: (x: string | boolean | undefined) => string | undefined,
  labels: readonly string[],
): Promise<OpOutcome> {
  if (op === 'create') {
    const title = str(v.title);
    const bodyFile = str(v['body-file']);
    if (title === undefined || bodyFile === undefined)
      throw new Error('usage: tracker create --title T --body-file F [--label L ...]');
    const body = readBody(io, bodyFile);
    const result = await provider.createIssue({
      title,
      body,
      ...(labels.length > 0 ? { labels: [...labels] } : {}),
    });
    // Audit the real created ref on success (URL) so the trail records WHICH
    // issue was filed; only fall back to "(new)" when there is no ref yet.
    return { op, ref: result.ok ? result.ref : '(new)', result, bodyChars: body.length };
  }
  const ref = str(v._ref) ?? '';
  if (ref === '') throw new Error(`usage: tracker ${op} <ref> ...`);
  if (op === 'close') {
    const reason = str(v.reason);
    return { op, ref, result: await provider.closeIssue(ref, reason), bodyChars: 0 };
  }
  if (op === 'comment') {
    const bodyFile = str(v['body-file']);
    if (bodyFile === undefined) throw new Error('usage: tracker comment <ref> --body-file F');
    const body = readBody(io, bodyFile);
    return { op, ref, result: await provider.comment(ref, body), bodyChars: body.length };
  }
  // label
  if (labels.length === 0) throw new Error('usage: tracker label <ref> --add L [--add L2 ...]');
  return { op, ref, result: await provider.addLabels(ref, labels), bodyChars: 0 };
}

/** Append the audit event for one tracker op — never the body verbatim. */
function auditOp(kern: Kernloop, mode: TrackerMode, refusedExecute: boolean, o: OpOutcome): void {
  appendEvent(kern.store, {
    type: `cli.tracker.${o.op}`,
    payload: {
      op: o.op,
      ref: o.ref,
      mode,
      refusedExecute,
      tier: kern.config.tracker?.tier ?? 'suggest',
      bodyChars: o.bodyChars,
      ok: o.result.ok,
      ...(o.result.ok ? {} : { reason: o.result.reason }),
    },
  });
}

/** The JSON the command prints + the process exit code it implies. */
export interface TrackerCommandReport {
  readonly mode: TrackerMode;
  readonly refusedExecute: boolean;
  readonly op: TrackerCliOp;
  readonly notice?: string;
  readonly proposal?: unknown;
  readonly result?: TrackerResult;
}

/** Build the printable report for an outcome (dry-run proposal vs execute result). */
function reportFor(
  provider: GithubProviderHandle,
  refused: boolean,
  o: OpOutcome,
): TrackerCommandReport {
  if (provider.mode === 'dry-run') {
    return {
      mode: 'dry-run',
      refusedExecute: refused,
      op: o.op,
      notice: refused
        ? 'DRY RUN — --execute refused: tracker tier is not enforce (set tracker.tier: enforce)'
        : 'DRY RUN — no tracker mutation performed',
      proposal: provider.proposals.at(-1),
    };
  }
  return { mode: 'execute', refusedExecute: refused, op: o.op, result: o.result };
}

/**
 * `kernloop tracker <op> ...` — the gated, dry-run-first tracker consumer.
 * Reads `tracker.{provider,repo,tier}` from the overlay, builds the GitHub
 * provider at the resolved mode, dispatches the op, AUDITS it, prints the
 * proposal (dry-run) or result (execute), and exits nonzero only on an
 * execute-mode failure.
 */
export async function trackerCommand(
  args: string[],
  io: CliIo,
  h: CommandHelpers,
  options: { exec?: TrackerExec } = {},
): Promise<number> {
  const [op, ...rest] = args;
  if (op === undefined || !(TRACKER_OPS as readonly string[]).includes(op)) {
    throw new Error('usage: kernloop tracker create|close|comment|label ...');
  }
  // close/comment/label take a positional <ref> before flags; create does not.
  const maybeRef = op === 'create' ? undefined : rest[0];
  const flagArgs = op === 'create' ? rest : rest.slice(1);
  // Labels can repeat (#76): create reads every --label, the label op every
  // --add; collected in order (parseArgs would keep only the last). The provider
  // validates the set (≤20, safe charset).
  const labels = collectFlag(flagArgs, op === 'create' ? 'label' : 'add');
  const v = h.mixedFlags(flagArgs, ['title', 'body-file', 'reason'], ['execute']);
  if (maybeRef !== undefined) v._ref = maybeRef;
  const kern = createKernloop({
    overlayDir: path.join(path.resolve(io.cwd, h.str(v.dir) ?? '.'), '.kernloop'),
  });
  try {
    const cfg = kern.config.tracker;
    if (cfg === undefined) {
      throw new Error(
        'no tracker configured — add tracker: { provider: github, repo: owner/name } to overlay.yaml',
      );
    }
    const { mode, refusedExecute } = resolveMode(cfg.tier, v.execute === true);
    const provider =
      options.exec === undefined
        ? githubProvider({ repo: cfg.repo }, mode)
        : githubProvider({ repo: cfg.repo }, mode, options.exec);
    const outcome = await dispatchOp(provider, io, op as TrackerCliOp, v, h.str, labels);
    auditOp(kern, mode, refusedExecute, outcome);
    const report = reportFor(provider, refusedExecute, outcome);
    io.out(JSON.stringify(report, null, 2));
    return report.result !== undefined && !report.result.ok ? 1 : 0;
  } finally {
    kern.close();
  }
}
