/**
 * Capability executors — what `run` actually does after the router picks a
 * manifest (spec §3.4). One executor per WIRED capability, registered only
 * for capabilities that are wiring-complete (constitutional rule 1):
 *
 *  - `gate.quality`          → faculty-gates `runQualityGate`; the Verdict is
 *                              published on the bus (audited [CLM-0032]) and
 *                              a `cli.gate.verdict` telemetry event records
 *                              the result for `observe`
 *  - `brief.compile`         → faculty-compiler `compileBrief` over sources
 *                              gathered by the composition root
 *  - `memory.semantic.recall`→ memory faculty recall on the task goal
 *  - `memory.episodic.read`  → memory faculty trace summaries
 *  - `workflow.canonical`    → the canonical loop (spec §6) through the
 *                              workflows engine over real executors
 *                              [CLM-0046]; escalation surfaces as its own
 *                              result, never disguised as success
 *
 * `memory.semantic.write` and `memory.episodic.write` have NO run-executor:
 * a TaskContract carries no fact payload to write, so wiring them here would
 * be a stub. They are wired through their real entry points instead — the
 * `remember` tool and `run`'s own Outcome recording.
 */
import { defaultQualityChecks, runQualityGate, type QualityCheck } from '@kernloop/faculty-gates';
import type { Cost, Finding, Outcome, Signal, TaskContract, Verdict } from '@kernloop/contracts';
import { appendEvent, type AdapterName } from '@kernloop/kernel';
import type { Kernloop } from './kernel.js';
import { assembleBrief } from './gather.js';
import { executeCanonicalLoop, type LoopInvoke, type LoopReport } from './loop/index.js';

/** Per-invocation context handed to an executor by the run tool. */
export interface ExecutionContext {
  readonly task: TaskContract;
  /** Workspace the capability operates on (gate.quality, workflow.canonical). */
  readonly workspaceDir?: string;
  /** Programmatic check override for the quality gate (tests only). */
  readonly checks?: readonly QualityCheck[];
  /** Adapter the loop's default invoke binds to (workflow.canonical). */
  readonly adapter?: AdapterName;
  /** Injectable model seam for the loop (tests script it). */
  readonly invoke?: LoopInvoke;
  /** Resume this checkpointed loop run instead of starting fresh. */
  readonly resumeRunId?: string;
  /** Force unlimited budget mode for the canonical loop [CLM-0077]. */
  readonly unlimited?: boolean;
}

/** What one executed capability reports back to the run tool. */
export interface ExecutionResult {
  readonly status: Outcome['status'];
  readonly signals: Signal[];
  readonly cost: Cost;
  /** The Verdict, when the capability is a gate. */
  readonly verdict?: Verdict;
  /** Capability-specific payload (brief, recalled facts, loop report). */
  readonly data?: unknown;
  /** Set when a loop run escalated: the K bound was exhausted [CLM-0043]. */
  readonly escalation?: { runId: string; findings: readonly Finding[] };
}

/** One wired capability. */
export type CapabilityExecutor = (ctx: ExecutionContext) => Promise<ExecutionResult>;

/** Typed failure executing a capability (e.g. missing workspaceDir). */
export class ExecutionError extends Error {
  readonly code: 'workspace_required';
  constructor(code: 'workspace_required', message: string) {
    super(message);
    this.name = 'ExecutionError';
    this.code = code;
  }
}

/** Options for {@link executeQualityGate}. */
export interface QualityGateRequest {
  readonly taskId: string;
  readonly workspaceDir: string;
  readonly checks?: readonly QualityCheck[];
  /** Per-check timeout override (the overlay's gates.quality knob). */
  readonly timeoutMsPerCheck?: number;
}

/**
 * Close out one gate Verdict, whichever gate emitted it: publish it on the
 * bus (the publish is audited — every gate Verdict appends to the chain
 * [CLM-0032]), ingest it into the observer's voter series and
 * cost-per-decision ledger (spec §5.5), and append a `cli.gate.verdict`
 * telemetry event so `observe` reports real chain data. Shared by the
 * `gate` tool (all three gates), the `gate.quality` run-executor, and the
 * canonical loop's gate nodes.
 */
export async function publishVerdict(kern: Kernloop, verdict: Verdict): Promise<void> {
  await kern.bus.publish('Verdict', verdict);
  kern.observer.ingestVerdict(verdict);
  appendEvent(kern.store, {
    type: 'cli.gate.verdict',
    payload: {
      taskId: verdict.taskId,
      gate: verdict.gate,
      result: verdict.result,
      findings: verdict.findings.length,
      voters: (verdict.voters ?? []).map((v) => v.voter),
      wallClockMs: verdict.cost.wallClockMs ?? 0,
    },
  });
}

/**
 * Run the quality gate and close out its Verdict via
 * {@link publishVerdict}. Shared by the `gate` tool and the `gate.quality`
 * run-executor.
 */
export async function executeQualityGate(
  kern: Kernloop,
  request: QualityGateRequest,
): Promise<Verdict> {
  const verdict = await runQualityGate({
    taskId: request.taskId,
    workspaceDir: request.workspaceDir,
    checks: request.checks ?? defaultQualityChecks(),
    ...(request.timeoutMsPerCheck === undefined
      ? {}
      : { timeoutMsPerCheck: request.timeoutMsPerCheck }),
  });
  await publishVerdict(kern, verdict);
  return verdict;
}

/** Executor for `gate.quality` — requires a workspace to judge. */
function gateQualityExecutor(kern: Kernloop): CapabilityExecutor {
  return async ({ task, workspaceDir, checks }) => {
    if (workspaceDir === undefined) {
      throw new ExecutionError(
        'workspace_required',
        'gate.quality needs a workspaceDir to run checks in',
      );
    }
    const verdict = await executeQualityGate(
      kern,
      checks === undefined
        ? { taskId: task.id, workspaceDir }
        : { taskId: task.id, workspaceDir, checks },
    );
    const passed = verdict.result === 'pass';
    return {
      status: passed ? 'success' : 'failure',
      signals: [
        {
          name: 'gate:quality',
          passed,
          detail: `${verdict.result} with ${String(verdict.findings.length)} finding(s)`,
        },
      ],
      cost: verdict.cost,
      verdict,
    };
  };
}

/** Executor for `brief.compile` — gather sources, compile, publish. */
function briefCompileExecutor(kern: Kernloop): CapabilityExecutor {
  return async ({ task }) => {
    const started = Date.now();
    const brief = await assembleBrief(kern, task);
    return {
      status: 'success',
      signals: [
        {
          name: 'brief:compile',
          passed: true,
          detail: `${String(brief.sections.length)} section(s), ${String(brief.budget.used)}/${String(brief.budget.allotted)} tokens`,
        },
      ],
      cost: { tokens: 0, usd: 0, wallClockMs: Date.now() - started },
      data: brief,
    };
  };
}

/** Executor for `memory.semantic.recall` — recall facts for the task goal. */
function semanticRecallExecutor(kern: Kernloop): CapabilityExecutor {
  return ({ task }) => {
    const started = Date.now();
    const facts = kern.memory.recallFacts(task.goal);
    return Promise.resolve({
      status: 'success' as const,
      signals: [{ name: 'memory:recall', passed: true, detail: `${String(facts.length)} fact(s)` }],
      cost: { tokens: 0, usd: 0, wallClockMs: Date.now() - started },
      data: facts,
    });
  };
}

/** Executor for `memory.episodic.read` — list trace summaries. */
function episodicReadExecutor(kern: Kernloop): CapabilityExecutor {
  return () => {
    const started = Date.now();
    const summaries = kern.memory.listSummaries();
    return Promise.resolve({
      status: 'success' as const,
      signals: [
        {
          name: 'memory:episodic',
          passed: true,
          detail: `${String(summaries.length)} summary(ies)`,
        },
      ],
      cost: { tokens: 0, usd: 0, wallClockMs: Date.now() - started },
      data: summaries,
    });
  };
}

/** Map a finished loop report into the run tool's execution result. */
function loopExecutionResult(report: LoopReport): ExecutionResult {
  const error =
    report.error === undefined ? '' : ` — ${report.error.code}: ${report.error.message}`;
  const status: Outcome['status'] =
    report.status === 'completed'
      ? (report.outcome?.status ?? 'failure')
      : report.status === 'escalated'
        ? 'partial'
        : 'failure';
  // Always-on reporting [CLM-0077]: the metered cost rides in BOTH modes; an
  // unlimited run is recorded honestly so no report implies a cap was honored.
  const budgetNote = report.unlimited ? ' (ran without budget enforcement)' : '';
  const signals: Signal[] = [
    {
      name: 'loop:canonical',
      passed: report.status === 'completed' && report.outcome?.status === 'success',
      detail: `${report.status} after ${String(report.nodeTrace.length)} node step(s)${budgetNote}${error}`,
    },
  ];
  if (report.unlimited) {
    signals.push({
      name: 'loop:budget',
      passed: true,
      detail: `unlimited mode — budget not enforced; metered cost ${String(report.cost.tokens)} tokens / $${String(report.cost.usd)} still reported`,
    });
  }
  return {
    status,
    signals,
    cost: report.cost,
    data: report,
    ...(report.status === 'escalated'
      ? { escalation: { runId: report.runId, findings: report.findings ?? [] } }
      : {}),
  };
}

/** Executor for `workflow.canonical` — the full loop over a workspace [CLM-0046]. */
function workflowCanonicalExecutor(kern: Kernloop): CapabilityExecutor {
  return async ({ task, workspaceDir, checks, adapter, invoke, resumeRunId, unlimited }) => {
    if (workspaceDir === undefined) {
      throw new ExecutionError(
        'workspace_required',
        'workflow.canonical needs a workspaceDir — the loop children implement into it',
      );
    }
    const report = await executeCanonicalLoop(kern, {
      task,
      workspaceDir,
      ...(adapter === undefined ? {} : { adapter }),
      ...(invoke === undefined ? {} : { invoke }),
      ...(resumeRunId === undefined ? {} : { resumeRunId }),
      ...(checks === undefined ? {} : { checks }),
      ...(unlimited === undefined ? {} : { unlimited }),
    });
    return loopExecutionResult(report);
  };
}

/** Build the capability-executor map for one assembled system. */
export function buildExecutors(kern: Kernloop): ReadonlyMap<string, CapabilityExecutor> {
  return new Map<string, CapabilityExecutor>([
    ['gate.quality', gateQualityExecutor(kern)],
    ['brief.compile', briefCompileExecutor(kern)],
    ['memory.semantic.recall', semanticRecallExecutor(kern)],
    ['memory.episodic.read', episodicReadExecutor(kern)],
    ['workflow.canonical', workflowCanonicalExecutor(kern)],
  ]);
}
