/**
 * The loop execution engine. `createEngine({executors, checkpoints, config})`
 * binds the CANONICAL_LOOP to injected node executors and a checkpoint store —
 * all real work (model calls, gates, memory) arrives through `executors`; this
 * package never imports the kernel, a faculty, or the cli (workflows talks
 * contracts, not plugins). The config schema lives in config.ts; it mirrors the
 * cli OverlaySchema field-for-field [CLM-0045]. Overrides change behavior
 * against the SAME frozen graph (a `gate` override swaps a gate executor;
 * `specialists` adds fan-out children) — the graph is never duplicated. Fan-out
 * children run SEQUENTIALLY: deterministic trace, unambiguous cursor, no budget
 * race (per-child spend is sliced off that order, #56); concurrency via a claim.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  TaskContractSchema,
  type Finding,
  type Outcome,
  type TaskContract,
} from '@kernloop/contracts';
import { CANONICAL_LOOP, type LoopGraph, type LoopNode } from './graph.js';
import type { CheckpointStore } from './checkpoints.js';
import { RunStateSchema, WorkflowError, type RunResult, type RunState } from './state.js';
import { asWorkflowError } from './engine-errors.js';
import {
  advance,
  advanceToNextChild,
  initialState,
  nextStep,
  validateEmission,
  type AdvanceOptions,
  type Step,
} from './steps.js';
import {
  enforceBudget,
  enforceBudgetPreNode,
  foldNodeSpend,
  overBudget,
  type BudgetGuard,
  type BudgetSpend,
} from './budget.js';
import { ChildSpendTracker, childSpends } from './child-spend.js';
import type { ChildIterateEvent } from './child-iterate.js';
import { EngineConfigSchema, type EngineConfig, type EngineConfigInput } from './config.js';

export { EngineConfigSchema, type EngineConfig, type EngineConfigInput } from './config.js';
export { BudgetModeSchema, type BudgetGuard, type BudgetMode } from './budget.js';
export type { ChildIterateEvent } from './child-iterate.js';

/** Per-invocation context handed to every node executor. */
export interface NodeContext {
  readonly runId: string;
  readonly taskId: string;
  /** Vote-iterate cycle count: 0 on first entry, +1 per rejected re-entry. */
  readonly iteration: number;
  readonly config: EngineConfig;
  /** The node being executed (resolved gate executors see the gate node). */
  readonly node: string;
  /**
   * Findings the executing node must address: the run-level vote-iterate
   * findings on the main chain; inside the fan-out the CHILD's accumulated gate
   * findings — what the re-running coder must fix [CLM-0043].
   */
  readonly findings: readonly Finding[];
  /** The child contract, inside the fan-out sub-chain. */
  readonly child?: TaskContract;
  /** This child's actor-critic iteration (0 on first implement), inside the fan-out. */
  readonly childIteration?: number;
  readonly signal?: AbortSignal;
}

/** An injected unit of work: consumes the edge value, emits the declared contract. */
export type NodeExecutor = (input: unknown, ctx: NodeContext) => Promise<unknown>;

/** What `createEngine` needs. Executors are keyed by node name, node kind, or gate name. */
export interface EngineDeps {
  readonly executors: Readonly<Record<string, NodeExecutor>>;
  readonly checkpoints: CheckpointStore;
  readonly config?: EngineConfigInput;
  /**
   * Runtime budget guard (spec §8) [CLM-0077]. Absent → no budget enforcement
   * (Kc still bounds child iteration). In `enforce` mode the run escalates when
   * metered spend exceeds the parent budget; `unlimited` never halts but spend
   * is still tracked. Injected by the CLI from the mode + parent budget + live
   * `totals`; workflows imports no kernel, so `spent()` is a plain seam.
   */
  readonly budget?: BudgetGuard;
  /**
   * Always-on metered-spend readout for PER-CHILD attribution (#56) — the raw
   * run-global meter the engine snapshots at each child boundary to slice spend
   * per child (see {@link ChildSpendTracker}), in BOTH budget modes. Absent → no
   * per-child attribution or halt. The CLI wires it to the budget guard's
   * `totals`; workflows imports no kernel, so this is a plain seam.
   */
  readonly meteredSpend?: () => BudgetSpend;
  /**
   * Audit hook fired on each child re-iteration [CLM-0043] — the CLI appends a
   * `loop.child.iterate` event to the hash chain so the refine history is
   * recorded (the Observer can later read iterations-to-pass as fitness).
   */
  readonly onChildIterate?: (event: ChildIterateEvent) => void;
}

/** Per-run options. */
export interface RunOptions {
  /** Caller-chosen run id (defaults to a UUID). */
  readonly runId?: string;
  /** Abort signal: an aborted run halts mid-node, last checkpoint intact. */
  readonly signal?: AbortSignal;
}

/** The engine: run the canonical loop, or resume a checkpointed run. */
export interface Engine {
  run(task: TaskContract, options?: RunOptions): Promise<RunResult>;
  resume(runId: string, options?: Pick<RunOptions, 'signal'>): Promise<RunResult>;
}

/** Engine implementation; see {@link createEngine}. */
class LoopEngine implements Engine {
  private readonly graph: LoopGraph = CANONICAL_LOOP;
  private readonly executors: Readonly<Record<string, NodeExecutor>>;
  private readonly checkpoints: CheckpointStore;
  private readonly config: EngineConfig;
  /** Pre-node budget reserve floor fraction (#342), hoisted for a short call site. */
  private readonly headroom: number;
  private readonly budget: BudgetGuard | undefined;
  private readonly onChildIterate: ((event: ChildIterateEvent) => void) | undefined;
  /** Slices the run-global meter per fan-out child for attribution + halt (#56). */
  private readonly childSpend: ChildSpendTracker;

  constructor(deps: EngineDeps) {
    this.executors = deps.executors;
    this.checkpoints = deps.checkpoints;
    this.config = EngineConfigSchema.parse(deps.config);
    this.headroom = this.config.budgetHeadroomFraction;
    this.budget = deps.budget;
    this.childSpend = new ChildSpendTracker(deps.meteredSpend);
    this.onChildIterate = deps.onChildIterate;
    // Wiring-complete or absent: every executable node must resolve NOW.
    // The fan-out node is structural (the engine itself runs the sub-chain).
    for (const node of [...this.graph.nodes, ...this.graph.childChain]) {
      if (node.kind !== 'fanout' && this.executorFor(node) === undefined) {
        throw new WorkflowError(
          'unwired_node',
          `no executor for node "${node.name}" (kind "${node.kind}"${node.gate === undefined ? '' : `, gate "${this.config.nodeOverrides[node.name]?.gate ?? node.gate}"`})`,
          { node: node.name },
        );
      }
    }
  }

  async run(task: TaskContract, options: RunOptions = {}): Promise<RunResult> {
    const parsed = TaskContractSchema.safeParse(task);
    if (!parsed.success) {
      throw new WorkflowError(
        'invalid_task',
        `run() input is not a TaskContract: ${z.prettifyError(parsed.error)}`,
        {
          contract: 'TaskContract',
        },
      );
    }
    const runId = options.runId ?? randomUUID();
    const state = initialState(parsed.data, this.graph.entry);
    return this.loop(runId, state, 0, options.signal);
  }

  async resume(runId: string, options: Pick<RunOptions, 'signal'> = {}): Promise<RunResult> {
    const checkpoint = await this.checkpoints.latest(runId);
    if (checkpoint === undefined) {
      throw new WorkflowError('no_checkpoint', `no checkpoint found for run "${runId}"`);
    }
    const parsed = RunStateSchema.safeParse(checkpoint.state);
    if (!parsed.success) {
      throw new WorkflowError(
        'corrupt_checkpoint',
        `checkpoint ${String(checkpoint.seq)} of run "${runId}" does not parse: ${z.prettifyError(parsed.error)}`,
      );
    }
    const state = parsed.data;
    if (state.status === 'completed') return this.finish(runId, state, childSpends(state));
    if (state.status === 'escalated') {
      // Vote escalation: the human edited the plan; continue from plan with a
      // fresh K budget [CLM-0043]. Budget halt [CLM-0077]: continue from the
      // cursor where spend tripped the limit — iteration is NOT reset (no plan
      // re-edit), and the budget guard re-evaluates as the run proceeds.
      if (state.haltReason !== 'budget') state.iteration = 0;
      state.status = 'running';
      state.haltReason = undefined;
    }
    return this.loop(runId, state, checkpoint.seq, options.signal);
  }

  /** Run nodes from the cursor until terminal, checkpointing each completion. */
  private async loop(
    runId: string,
    state: RunState,
    seqStart: number,
    signal?: AbortSignal,
  ): Promise<RunResult> {
    let seq = seqStart;
    this.childSpend.reset(state); // per-process attribution; drops pre-resume spend (#212)
    while (state.status === 'running') {
      const step = nextStep(this.graph, state);
      // #342: halt before dispatch if the next node would overshoot (a near-ceiling).
      if (enforceBudgetPreNode(state, this.budget, state.observedMaxNodeSpend, this.headroom))
        break;
      const executor = this.executorFor(step.node);
      if (executor === undefined) {
        throw new WorkflowError('unwired_node', `no executor for node "${step.node.name}"`);
      }
      const fanoutIndex = state.cursor.phase === 'fanout' ? state.cursor.childIndex : undefined;
      if (fanoutIndex !== undefined) this.childSpend.ensureBaseline(fanoutIndex);
      const iteration = state.iteration;
      const spentBefore = this.budget?.spent();
      let output: unknown;
      let childFailed = false;
      try {
        if (signal?.aborted === true) throw new WorkflowError('aborted', 'abort signal fired');
        output = validateEmission(
          step.node,
          await executor(step.input, this.context(runId, state, step, signal)),
        );
      } catch (error) {
        const failure = this.classify(error, state, step, signal);
        if (failure !== undefined) {
          return { runId, status: 'failed', nodeTrace: state.trace, error: failure };
        }
        // A child executor failed: recorded honestly (classify advanced the cursor), fan-out continues.
        childFailed = true;
      }
      foldNodeSpend(state, this.budget, spentBefore); // #342: per-node delta → observed-max
      if (!childFailed) advance(this.graph, state, step.node, output, this.advanceOptions(state));
      if (fanoutIndex !== undefined) this.childSpend.attribute(state, fanoutIndex);
      enforceBudget(state, this.budget);
      seq += 1;
      state.trace.push(this.traceEntry(seq, iteration, step));
      const persistFailure = await this.persist(runId, seq, iteration, state, step.node.name);
      if (persistFailure !== undefined) {
        return { runId, status: 'failed', nodeTrace: state.trace, error: persistFailure };
      }
    }
    return this.terminalResult(runId, state);
  }

  /** The escalated-or-completed result, carrying per-child spend attribution (#56). */
  private terminalResult(runId: string, state: RunState): RunResult {
    const childSpend = childSpends(state);
    if (state.status !== 'escalated') return this.finish(runId, state, childSpend);
    return {
      runId,
      status: 'escalated',
      nodeTrace: state.trace,
      findings: state.findings,
      ...(state.haltReason === undefined ? {} : { haltReason: state.haltReason }),
      ...(childSpend === undefined ? {} : { childSpend }),
    };
  }

  /** The loop-shaping inputs for one {@link advance} call, resolved from config + seams. */
  private advanceOptions(state: RunState): AdvanceOptions {
    return {
      k: this.config.K,
      kc: this.config.Kc,
      specialists: this.specialists(),
      reviewDrivesIteration: this.config.reviewDrivesIteration,
      // Re-implement allowed only within BOTH the run budget AND the child's own
      // slice (#56); over either forces escalation before Kc.
      childWithinBudget:
        !overBudget(this.budget) &&
        this.childSpend.withinOwnBudget(this.budget?.mode === 'enforce', state),
      ...(this.onChildIterate === undefined ? {} : { onIterate: this.onChildIterate }),
    };
  }

  /** Classify a node throw: undefined means "recorded as child failure, continue". */
  private classify(
    error: unknown,
    state: RunState,
    step: { node: LoopNode },
    signal?: AbortSignal,
  ): WorkflowError | undefined {
    const wrapped = asWorkflowError(error, step.node.name, signal);
    if (wrapped.code === 'executor_failed' && state.cursor.phase === 'fanout') {
      const { childIndex } = state.cursor;
      const result = state.childResults[childIndex];
      if (result !== undefined) result.error = wrapped.message;
      advanceToNextChild(this.graph, state, childIndex);
      return undefined;
    }
    return wrapped;
  }

  private context(runId: string, state: RunState, step: Step, signal?: AbortSignal): NodeContext {
    // Fan-out: a node reads its CHILD's findings [CLM-0043]; main chain: the
    // run-level vote-iterate findings. A snapshot, never the live array.
    const inFanout = step.child !== undefined;
    const findings = inFanout ? [...(step.childFindings ?? [])] : [...state.findings];
    const childIteration =
      step.child === undefined ? undefined : (this.childIterationFor(state, step.child.id) ?? 0);
    return {
      runId,
      taskId: state.task.id,
      iteration: state.iteration,
      config: this.config,
      node: step.node.name,
      findings,
      ...(step.child === undefined ? {} : { child: step.child }),
      ...(childIteration === undefined ? {} : { childIteration }),
      ...(signal === undefined ? {} : { signal }),
    };
  }

  /** This child's current actor-critic iteration, from the run state. */
  private childIterationFor(state: RunState, childId: string): number | undefined {
    return state.childResults.find((r) => r.child.id === childId)?.iteration;
  }

  /** Trace/checkpoint rows record the iteration at which the node RAN. */
  private traceEntry(
    seq: number,
    iteration: number,
    step: { node: LoopNode; child?: TaskContract },
  ) {
    return {
      seq,
      node: step.node.name,
      iteration,
      ...(step.child === undefined ? {} : { childId: step.child.id }),
    };
  }

  /**
   * Persist one checkpoint [CLM-0044]. A rejected save is a run failure:
   * silently losing a checkpoint would let `resume` lie about what re-runs.
   */
  private async persist(
    runId: string,
    seq: number,
    iteration: number,
    state: RunState,
    node: string,
  ): Promise<WorkflowError | undefined> {
    try {
      await this.checkpoints.save({
        runId,
        seq,
        node,
        iteration,
        state: structuredClone(state),
        createdAt: new Date().toISOString(),
      });
      return undefined;
    } catch (error) {
      return new WorkflowError(
        'checkpoint_failed',
        `checkpoint ${String(seq)} failed to persist: ${error instanceof Error ? error.message : String(error)}`,
        { node, cause: error },
      );
    }
  }

  /** Resolve a node's executor: gate overrides swap gate executors [CLM-0045]. */
  private executorFor(node: LoopNode): NodeExecutor | undefined {
    if (node.kind === 'gate' && node.gate !== undefined) {
      const gateName = this.config.nodeOverrides[node.name]?.gate ?? node.gate;
      return this.executors[gateName];
    }
    return this.executors[node.name] ?? this.executors[node.kind];
  }

  private specialists(): readonly string[] {
    const fanout = this.graph.nodes.find((n) => n.kind === 'fanout');
    if (fanout === undefined) return [];
    return this.config.nodeOverrides[fanout.name]?.specialists ?? [];
  }

  private finish(runId: string, state: RunState, childSpend?: RunResult['childSpend']): RunResult {
    const retrospect = this.graph.nodes.find((n) => n.kind === 'retrospect');
    return {
      runId,
      status: 'completed',
      nodeTrace: state.trace,
      outcome: state.values[retrospect?.name ?? 'retrospect'] as Outcome,
      ...(childSpend === undefined ? {} : { childSpend }),
    };
  }
}

/**
 * Create a loop engine over the CANONICAL_LOOP. Throws `unwired_node` if
 * any executable node lacks an executor (wiring-complete or absent — a
 * graph that could fail mid-run on a missing executor is a stub).
 */
export function createEngine(deps: EngineDeps): Engine {
  return new LoopEngine(deps);
}
