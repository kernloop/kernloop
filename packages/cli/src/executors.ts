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
 *
 * `memory.semantic.write` and `memory.episodic.write` have NO run-executor:
 * a TaskContract carries no fact payload to write, so wiring them here would
 * be a stub. They are wired through their real entry points instead — the
 * `remember` tool and `run`'s own Outcome recording.
 */
import { defaultQualityChecks, runQualityGate, type QualityCheck } from '@kernloop/faculty-gates';
import type { Cost, Outcome, Signal, TaskContract, Verdict } from '@kernloop/contracts';
import { appendEvent } from '@kernloop/kernel';
import type { Kernloop } from './kernel.js';
import { assembleBrief } from './gather.js';

/** Per-invocation context handed to an executor by the run tool. */
export interface ExecutionContext {
  readonly task: TaskContract;
  /** Workspace the capability operates on (required by `gate.quality`). */
  readonly workspaceDir?: string;
  /** Programmatic check override for the quality gate (tests only). */
  readonly checks?: readonly QualityCheck[];
}

/** What one executed capability reports back to the run tool. */
export interface ExecutionResult {
  readonly status: Outcome['status'];
  readonly signals: Signal[];
  readonly cost: Cost;
  /** The Verdict, when the capability is a gate. */
  readonly verdict?: Verdict;
  /** Capability-specific payload (brief, recalled facts, summaries). */
  readonly data?: unknown;
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
}

/**
 * Run the quality gate, publish the Verdict on the bus (the publish is
 * audited — every gate Verdict appends to the chain [CLM-0032]), and append
 * a `cli.gate.verdict` telemetry event carrying the result so `observe` can
 * report pass/fail counts from real chain data. Shared by the `gate` tool
 * and the `gate.quality` run-executor.
 */
export async function executeQualityGate(
  kern: Kernloop,
  request: QualityGateRequest,
): Promise<Verdict> {
  const verdict = await runQualityGate({
    taskId: request.taskId,
    workspaceDir: request.workspaceDir,
    checks: request.checks ?? defaultQualityChecks(),
  });
  await kern.bus.publish('Verdict', verdict);
  appendEvent(kern.store, {
    type: 'cli.gate.verdict',
    payload: {
      taskId: verdict.taskId,
      gate: verdict.gate,
      result: verdict.result,
      findings: verdict.findings.length,
      wallClockMs: verdict.cost.wallClockMs ?? 0,
    },
  });
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

/** Build the capability-executor map for one assembled system. */
export function buildExecutors(kern: Kernloop): ReadonlyMap<string, CapabilityExecutor> {
  return new Map<string, CapabilityExecutor>([
    ['gate.quality', gateQualityExecutor(kern)],
    ['brief.compile', briefCompileExecutor(kern)],
    ['memory.semantic.recall', semanticRecallExecutor(kern)],
    ['memory.episodic.read', episodicReadExecutor(kern)],
  ]);
}
