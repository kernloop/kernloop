/**
 * The loop execution engine. `createEngine({executors, checkpoints,
 * config})` binds the CANONICAL_LOOP to injected node executors and an
 * injected checkpoint store — all real work (model calls, gates, memory)
 * arrives through `executors`; this package never imports the kernel, a
 * faculty, or the cli (constitutional rule 5 in spirit: workflows talks
 * contracts, not plugins).
 *
 * Config ↔ overlay mapping (documented, not imported): EngineConfig is the
 * loop-relevant subset of the cli's `OverlaySchema` (`packages/cli/src/
 * overlay.ts`) — `K`, `gates.vote.{strategy,panel}`, and `nodeOverrides`
 * share its field names and value spaces, so the composition root maps
 * `Overlay` → `EngineConfig` field-for-field [CLM-0045]. Overrides change
 * behavior against the SAME frozen graph: a `gate` override swaps which
 * gate executor a gate node calls; `specialists` adds entries to the
 * fan-out children list. The graph is never duplicated.
 *
 * Execution order: fan-out children run SEQUENTIALLY in children order —
 * deterministic trace, unambiguous checkpoint cursor, and child budgets
 * never race. Concurrency is a composition-root concern kernloop does not
 * need in P2; revisit via a claim, not a flag.
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
import { advance, advanceToNextChild, initialState, nextStep, validateEmission } from './steps.js';

/** Vote strategies in use (mirrors the cli overlay's VOTE_STRATEGIES). */
const VoteConfigSchema = z.strictObject({
  strategy: z.enum(['simple_majority', 'supermajority', 'unanimous']).default('simple_majority'),
  panel: z.union([z.literal(3), z.literal(7)]).default(3),
});

/** One node override (mirrors the cli overlay's NodeOverrideSchema). */
const NodeOverrideSchema = z.strictObject({
  gate: z.string().min(1).optional(),
  specialists: z.array(z.string().min(1)).optional(),
});

/** Engine configuration — see the module docs for the overlay mapping. */
export const EngineConfigSchema = z
  .strictObject({
    /** Vote-iterate bound: at most K rejected re-entries into plan (spec §6). */
    K: z.number().int().min(1).default(3),
    gates: z.strictObject({ vote: VoteConfigSchema.prefault({}) }).prefault({}),
    nodeOverrides: z.record(z.string().min(1), NodeOverrideSchema).default({}),
  })
  .prefault({});
export type EngineConfig = z.infer<typeof EngineConfigSchema>;
export type EngineConfigInput = z.input<typeof EngineConfigSchema>;

/** Per-invocation context handed to every node executor. */
export interface NodeContext {
  readonly runId: string;
  readonly taskId: string;
  /** Vote-iterate cycle count: 0 on first entry, +1 per rejected re-entry. */
  readonly iteration: number;
  readonly config: EngineConfig;
  /** The node being executed (resolved gate executors see the gate node). */
  readonly node: string;
  /** Findings accumulated from rejecting Verdicts (plan re-entries read these). */
  readonly findings: readonly Finding[];
  /** The child contract, inside the fan-out sub-chain. */
  readonly child?: TaskContract;
  readonly signal?: AbortSignal;
}

/** An injected unit of work: consumes the edge value, emits the declared contract. */
export type NodeExecutor = (input: unknown, ctx: NodeContext) => Promise<unknown>;

/** What `createEngine` needs. Executors are keyed by node name, node kind, or gate name. */
export interface EngineDeps {
  readonly executors: Readonly<Record<string, NodeExecutor>>;
  readonly checkpoints: CheckpointStore;
  readonly config?: EngineConfigInput;
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

/** True for AbortError throws and fired signals — the "kill" path [CLM-0044]. */
function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

/** Wrap a non-engine throw in a typed WorkflowError. */
function asWorkflowError(error: unknown, node: string, signal?: AbortSignal): WorkflowError {
  if (error instanceof WorkflowError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return isAbort(error, signal)
    ? new WorkflowError('aborted', `run aborted at node "${node}": ${message}`, { node })
    : new WorkflowError('executor_failed', `node "${node}" failed: ${message}`, {
        node,
        cause: error,
      });
}

/** Engine implementation; see {@link createEngine}. */
class LoopEngine implements Engine {
  private readonly graph: LoopGraph = CANONICAL_LOOP;
  private readonly executors: Readonly<Record<string, NodeExecutor>>;
  private readonly checkpoints: CheckpointStore;
  private readonly config: EngineConfig;

  constructor(deps: EngineDeps) {
    this.executors = deps.executors;
    this.checkpoints = deps.checkpoints;
    this.config = EngineConfigSchema.parse(deps.config);
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
    if (state.status === 'completed') return this.finish(runId, state);
    if (state.status === 'escalated') {
      // The human edited the plan inputs; continue from plan (the cursor is
      // already parked there) with a fresh K budget [CLM-0043].
      state.status = 'running';
      state.iteration = 0;
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
    while (state.status === 'running') {
      const step = nextStep(this.graph, state);
      const executor = this.executorFor(step.node);
      if (executor === undefined) {
        throw new WorkflowError('unwired_node', `no executor for node "${step.node.name}"`);
      }
      const iteration = state.iteration;
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
        // A child executor failed: recorded honestly (classify advanced the
        // cursor past the child), and the fan-out continues.
        childFailed = true;
      }
      if (!childFailed) {
        advance(this.graph, state, step.node, output, this.config.K, this.specialists());
      }
      seq += 1;
      state.trace.push(this.traceEntry(seq, iteration, step));
      const persistFailure = await this.persist(runId, seq, iteration, state, step.node.name);
      if (persistFailure !== undefined) {
        return { runId, status: 'failed', nodeTrace: state.trace, error: persistFailure };
      }
    }
    if (state.status === 'escalated') {
      return { runId, status: 'escalated', nodeTrace: state.trace, findings: state.findings };
    }
    return this.finish(runId, state);
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

  private context(
    runId: string,
    state: RunState,
    step: { node: LoopNode; child?: TaskContract },
    signal?: AbortSignal,
  ): NodeContext {
    return {
      runId,
      taskId: state.task.id,
      iteration: state.iteration,
      config: this.config,
      node: step.node.name,
      // A snapshot, not the live array: executors read findings, they
      // cannot reach back into engine state.
      findings: [...state.findings],
      ...(step.child === undefined ? {} : { child: step.child }),
      ...(signal === undefined ? {} : { signal }),
    };
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

  /** Resolve which executor a node runs: gate overrides swap gate executors
   * [CLM-0045]; otherwise the node's name wins over its kind. */
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

  private finish(runId: string, state: RunState): RunResult {
    const retrospect = this.graph.nodes.find((n) => n.kind === 'retrospect');
    return {
      runId,
      status: 'completed',
      nodeTrace: state.trace,
      outcome: state.values[retrospect?.name ?? 'retrospect'] as Outcome,
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
