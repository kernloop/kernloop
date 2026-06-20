/**
 * @kernloop/workflows — Layer 3 (spec §2, §6): the canonical loop as data
 * plus the execution engine. One blessed graph [CLM-0042]; a K-bounded
 * vote-iterate cycle [CLM-0043]; per-node checkpoints making any run
 * resumable [CLM-0044]; overlay-shaped config overriding gates and
 * specialists against the same graph object [CLM-0045].
 */
export {
  CANONICAL_LOOP,
  nodeByName,
  successor,
  type LoopGraph,
  type LoopNode,
  type LoopEdge,
  type LoopNodeKind,
  type LoopGateName,
} from './graph.js';
export {
  createEngine,
  EngineConfigSchema,
  BudgetModeSchema,
  type Engine,
  type EngineConfig,
  type EngineConfigInput,
  type EngineDeps,
  type NodeContext,
  type NodeExecutor,
  type RunOptions,
  type BudgetGuard,
  type BudgetMode,
  type ChildIterateEvent,
} from './engine.js';
export {
  InMemoryCheckpointStore,
  JsonlCheckpointStore,
  type CheckpointStore,
} from './checkpoints.js';
export {
  CheckpointRecordSchema,
  ChildResultSchema,
  CursorSchema,
  RunStateSchema,
  TraceEntrySchema,
  WorkflowError,
  type CheckpointRecord,
  type ChildResult,
  type Cursor,
  type RunResult,
  type RunState,
  type TraceEntry,
  type WorkflowErrorCode,
} from './state.js';
export { workflowsManifest } from './manifest.js';
export { verdictDisposition, type VerdictDisposition } from './verdict-disposition.js';
