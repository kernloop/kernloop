/**
 * The execution engine's public type surface — the contracts a caller of
 * `createEngine` touches: the per-node {@link NodeContext}, the injected
 * {@link NodeExecutor}, the {@link EngineDeps} bag, {@link RunOptions}, and the
 * {@link Engine} interface itself. Split out of engine.ts to keep that file under
 * the 400-line ceiling (#58); engine.ts re-exports every name here, so consumers
 * still import from `./engine.js` (or `@kernloop/workflows`) unchanged.
 */
import type { Finding, TaskContract } from '@kernloop/contracts';
import type { CheckpointStore } from './checkpoints.js';
import type { RunResult } from './state.js';
import type { BudgetGuard, BudgetSpend } from './budget.js';
import type { ChildIterateEvent } from './child-iterate.js';
import type { EngineConfig, EngineConfigInput } from './config.js';

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
