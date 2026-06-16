/**
 * The `kernloop observer` CLI surface (spec §5.5) [CLM-0094]. A CLI VERB, NOT
 * a 12th MCP tool: `observer proposals|propose|list|file|distill`. `distill`
 * [CLM-0117] is the FITNESS-GATED distill — it distills a subject's recent
 * successful trace into a suggest-tier skill proposal ONLY when the lifecycle
 * pass deems the subject distill-worthy (else refused); the SKILL.md lands in
 * `skills/proposed/`, a human PR moves it live (never auto-merge). It is the gated,
 * wiring-complete bridge from the Observer's pure self-issue seam to a real
 * tracker — and it is DRY-RUN BY DEFAULT. The Observer faculty itself acts
 * only at `suggest`: it PROPOSES (`proposeIssue`, a pure DB write) and never
 * spawns. FILING is a separate, human-ratified action routed through
 * `@kernloop/tracker`; it performs a real mutation ONLY when the overlay grants
 * `tracker.tier: enforce` AND `--execute` is passed, and on success records the
 * tracker url back onto the proposal via `markIssueFiled`. At `suggest` (the
 * default) an `--execute` is refused — recorded in the output and audit — and
 * the op stays dry-run: the system never defaults upward (spec §3.2). Every op
 * is audited as `cli.observer.<op>` with op, mode, and tier — never the body
 * verbatim (only a bounded char count). The self-filed issue's task-shaped
 * payload re-enters through the ordinary `run` loop — no privileged path.
 */
import path from 'node:path';
import { appendEvent, ADAPTER_NAMES, type AdapterName } from '@kernloop/kernel';
import { issueBody, type IssueProposal } from '@kernloop/faculty-observer';
import { githubProvider, type TrackerExec, type TrackerMode } from '@kernloop/tracker';
import type { CliIo } from './cli.js';
import { createKernloop, type Kernloop } from './kernel.js';
import type { CommandHelpers } from './portability-commands.js';
import { resolveMode } from './tracker-commands.js';
import { distillTool } from './tools/distill.js';
import type { LoopInvoke } from './loop/invoke.js';

/** The observer verbs this surface exposes. */
export const OBSERVER_OPS = ['proposals', 'propose', 'list', 'file', 'distill'] as const;

/** Parse a non-negative integer CLI argument, or throw the given usage error. */
function intArg(raw: string, usage: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(usage);
  return n;
}

/** Validate an `--adapter` flag against the known adapter names. */
function parseAdapter(raw: string): AdapterName {
  if (!(ADAPTER_NAMES as readonly string[]).includes(raw)) {
    throw new Error(`unknown adapter "${raw}" (one of: ${ADAPTER_NAMES.join(', ')})`);
  }
  return raw as AdapterName;
}

/** Print the live, pure-read lifecycle proposals (spawns nothing). */
function proposalsReport(kern: Kernloop): unknown {
  return kern.observer.lifecycleProposals().map((p, index) => ({
    index,
    kind: p.kind,
    subject: p.subject,
    title: p.title,
  }));
}

/** Snapshot the n-th live lifecycle proposal into `observer_issues` (pure DB). */
function proposeReport(kern: Kernloop, n: number): unknown {
  const live = kern.observer.lifecycleProposals();
  const proposal = live[n];
  if (proposal === undefined) {
    throw new Error(`no lifecycle proposal at index ${String(n)} (${String(live.length)} live)`);
  }
  // De-dupe by title: a re-run must not persist the same suggestion twice.
  const existing = kern.observer.listIssues().find((row) => row.title === proposal.title);
  if (existing !== undefined) {
    return {
      skipped: true,
      reason: 'a proposed issue with this title already exists',
      id: existing.id,
    };
  }
  const persisted = kern.observer.proposeIssue({
    title: proposal.title,
    body: proposal.body,
    taskShaped: proposal.taskShaped,
  });
  appendEvent(kern.store, {
    type: 'cli.observer.propose',
    payload: { id: persisted.id, kind: proposal.kind, subject: proposal.subject },
  });
  return { id: persisted.id, status: persisted.status, title: persisted.title };
}

/** Print the persisted proposals (id, status, title, url). */
function listReport(kern: Kernloop): unknown {
  return kern.observer
    .listIssues()
    .map((p) => ({ id: p.id, status: p.status, title: p.title, url: p.url }));
}

/**
 * Run a FITNESS-GATED distill (#50): distill a subject's recent successful trace
 * into a suggest-tier skill proposal ONLY when the Observer's lifecycle pass
 * deems the subject distill-worthy (a high-fitness `distill` proposal exists for
 * it — ≥ the bar over the minimum invocations, with a real recent success). A
 * subject that has not EARNED it is refused; distillation is never ungated. The
 * proposal lands in `skills/proposed/` (never the live library) — a human PR
 * moves it live, so this NEVER auto-merges. Audited as `cli.observer.distill`.
 */
async function distillReport(
  kern: Kernloop,
  subject: string,
  adapter: AdapterName | undefined,
  invoke: LoopInvoke | undefined,
): Promise<unknown> {
  const proposal = kern.observer
    .lifecycleProposals()
    .find((p) => p.kind === 'distill' && p.subject === subject);
  if (proposal?.traceId === undefined) {
    throw new Error(
      `subject "${subject}" is not distill-worthy — the Observer proposes distilling only a ` +
        `high-fitness subject (sustained success over the minimum invocations) with a recent ` +
        `successful trace. Run \`kernloop observer proposals\` to see current distill candidates.`,
    );
  }
  const skill = await distillTool(
    kern,
    { trace: proposal.traceId, ...(adapter === undefined ? {} : { adapter }) },
    invoke === undefined ? {} : { invoke },
  );
  appendEvent(kern.store, {
    type: 'cli.observer.distill',
    payload: { subject, trace: proposal.traceId, skill: skill.name, tier: skill.tier },
  });
  return {
    subject,
    trace: proposal.traceId,
    skill: skill.name,
    skillFile: skill.skillFile,
    tier: skill.tier,
    status: skill.status,
  };
}

/** The JSON `file` prints + the exit code it implies. */
interface FileReport {
  readonly mode: TrackerMode;
  readonly refusedExecute: boolean;
  readonly id: number;
  readonly notice?: string;
  readonly proposal?: unknown;
  readonly result?: { ok: boolean; ref?: string; reason?: string };
  readonly filed?: IssueProposal;
}

/** Append the audit event for a `file` op — never the body verbatim. */
function auditFile(
  kern: Kernloop,
  args: { id: number; mode: TrackerMode; refusedExecute: boolean; bodyChars: number; ok: boolean },
): void {
  appendEvent(kern.store, {
    type: 'cli.observer.file',
    payload: {
      op: 'file',
      id: args.id,
      mode: args.mode,
      refusedExecute: args.refusedExecute,
      tier: kern.config.tracker?.tier ?? 'suggest',
      bodyChars: args.bodyChars,
      ok: args.ok,
    },
  });
}

/** The dry-run notice (refused-execute spells out the enforce-tier promotion). */
function dryRunNotice(refused: boolean): string {
  return refused
    ? 'DRY RUN — --execute refused: tracker tier is not enforce (set tracker.tier: enforce)'
    : 'DRY RUN — no issue filed';
}

/** Map a provider create-result to the printable report (+ exit code), marking
 * the row filed on a real success. Dry-run marks NOTHING. */
function fileReportFor(
  kern: Kernloop,
  provider: ReturnType<typeof githubProvider>,
  id: number,
  refusedExecute: boolean,
  result: Awaited<ReturnType<ReturnType<typeof githubProvider>['createIssue']>>,
): { report: FileReport; code: number } {
  // A boundary rejection (oversize title/body, bad input) is surfaced FIRST —
  // even in dry-run — so the preview honestly reports an op that --execute
  // would refuse, instead of a green "no issue filed" with no proposal.
  if (!result.ok) {
    return {
      report: {
        mode: provider.mode,
        refusedExecute,
        id,
        result: { ok: false, reason: result.reason },
      },
      code: 1,
    };
  }
  if (provider.mode === 'dry-run') {
    return {
      report: {
        mode: 'dry-run',
        refusedExecute,
        id,
        notice: dryRunNotice(refusedExecute),
        proposal: provider.proposals.at(-1),
      },
      code: 0,
    };
  }
  const filed = kern.observer.markIssueFiled(id, result.ref);
  return {
    report: { mode: 'execute', refusedExecute, id, result: { ok: true, ref: result.ref }, filed },
    code: 0,
  };
}

/**
 * `kernloop observer file <id> [--execute]` — the gated, dry-run-first filing
 * path [CLM-0094]. Reads the proposed `observer_issues` row, builds the tracker
 * `CreateIssueInput`, resolves the mode from `tracker.tier` + `--execute`
 * (execute ONLY at enforce — never defaults upward), and either proposes the
 * would-be invocation (dry-run, marks nothing) or files via the provider and,
 * on success, `markIssueFiled`s the row with the returned url. Errors-as-data
 * from the provider surface as a clean nonzero exit, never a throw.
 */
async function fileOp(
  kern: Kernloop,
  id: number,
  executeFlag: boolean,
  exec: TrackerExec | undefined,
): Promise<{ report: FileReport; code: number }> {
  const row = kern.observer.getIssue(id);
  if (row === undefined) throw new Error(`no proposed issue with id ${String(id)}`);
  if (row.status === 'filed') {
    throw new Error(`issue ${String(id)} is already filed (${row.url ?? 'no url'})`);
  }
  const cfg = kern.config.tracker;
  if (cfg === undefined) {
    throw new Error(
      'no tracker configured — add tracker: { provider: github, repo: owner/name } to overlay.yaml',
    );
  }
  const body = issueBody(row);
  const { mode, refusedExecute } = resolveMode(cfg.tier, executeFlag);
  const provider =
    exec === undefined
      ? githubProvider({ repo: cfg.repo }, mode)
      : githubProvider({ repo: cfg.repo }, mode, exec);
  const result = await provider.createIssue({ title: row.title, body });
  auditFile(kern, { id, mode, refusedExecute, bodyChars: body.length, ok: result.ok });
  return fileReportFor(kern, provider, id, refusedExecute, result);
}

/** Parse the `propose` verb's positional and snapshot the n-th live proposal. */
function proposeDispatch(kern: Kernloop, positional: string | undefined): unknown {
  if (positional === undefined) throw new Error('usage: kernloop observer propose <n>');
  const n = intArg(
    positional,
    'usage: kernloop observer propose <n> (n is a non-negative integer)',
  );
  return proposeReport(kern, n);
}

/** Parse the `distill` verb's flags and run the fitness-gated distill. */
function distillDispatch(
  kern: Kernloop,
  v: Record<string, string | boolean>,
  h: CommandHelpers,
  invoke: LoopInvoke | undefined,
): Promise<unknown> {
  const subject = h.str(v.subject);
  if (subject === undefined) throw new Error('usage: kernloop observer distill --subject S');
  const adapterFlag = h.str(v.adapter);
  const adapter = adapterFlag === undefined ? undefined : parseAdapter(adapterFlag);
  return distillReport(kern, subject, adapter, invoke);
}

/**
 * `kernloop observer <op> ...` — the gated self-issue closure path [CLM-0094].
 * Surface the live lifecycle proposals, snapshot one into `observer_issues`,
 * list the persisted proposals, file one through the gated tracker (dry-run by
 * default), or run the fitness-gated `distill` [CLM-0117]. Reads
 * `tracker.{provider,repo,tier}` from the overlay; `file` acts only at the
 * enforce tier with `--execute` — never defaults upward.
 */
export async function observerCommand(
  args: string[],
  io: CliIo,
  h: CommandHelpers,
  options: { exec?: TrackerExec; invoke?: LoopInvoke } = {},
): Promise<number> {
  const [op, ...rest] = args;
  if (op === undefined || !(OBSERVER_OPS as readonly string[]).includes(op)) {
    throw new Error(
      'usage: kernloop observer proposals|propose <n>|list|file <id> [--execute]|distill --subject S [--adapter A]',
    );
  }
  const positional = op === 'propose' || op === 'file' ? rest[0] : undefined;
  const flagArgs = positional === undefined ? rest : rest.slice(1);
  const v = h.mixedFlags(flagArgs, ['subject', 'adapter'], ['execute']);
  const kern = createKernloop({
    overlayDir: path.join(path.resolve(io.cwd, h.str(v.dir) ?? '.'), '.kernloop'),
  });
  try {
    if (op === 'proposals') {
      io.out(JSON.stringify(proposalsReport(kern), null, 2));
      return 0;
    }
    if (op === 'list') {
      io.out(JSON.stringify(listReport(kern), null, 2));
      return 0;
    }
    if (op === 'propose') {
      io.out(JSON.stringify(proposeDispatch(kern, positional), null, 2));
      return 0;
    }
    if (op === 'distill') {
      io.out(JSON.stringify(await distillDispatch(kern, v, h, options.invoke), null, 2));
      return 0;
    }
    // file
    if (positional === undefined) throw new Error('usage: kernloop observer file <id> [--execute]');
    const id = intArg(
      positional,
      'usage: kernloop observer file <id> [--execute] (id is a non-negative integer)',
    );
    const { report, code } = await fileOp(kern, id, v.execute === true, options.exec);
    io.out(JSON.stringify(report, null, 2));
    return code;
  } finally {
    kern.close();
  }
}
