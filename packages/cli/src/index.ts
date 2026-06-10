/**
 * @kernloop/cli — the composition root (spec §9). Assembles kernel +
 * faculties over a per-repo overlay (spec §7) and exposes the nine P1
 * kernel tools (spec §3.4) as typed functions, CLI subcommands, and an MCP
 * server. `distill` and `forge` are P3; absent by design, not stubbed.
 */
export { createKernloop, P1_FACULTY_MANIFESTS, P2_MANIFESTS } from './kernel.js';
export type { Kernloop, CreateKernloopOptions } from './kernel.js';
export {
  LoopParseError,
  LoopResumeError,
  checkpointFile,
  executeCanonicalLoop,
  loadCheckpointTask,
} from './loop/index.js';
export type { LoopInvoke, LoopReport, LoopRequest } from './loop/index.js';
export {
  OVERLAY_DIR_NAME,
  NodeOverrideSchema,
  OverlayError,
  OverlaySchema,
  VOTE_PANEL_SIZES,
  VOTE_STRATEGIES,
  gateForNode,
  initOverlay,
  loadOverlay,
  overlayPaths,
  specialistsForNode,
} from './overlay.js';
export type { InitResult, NodeOverride, Overlay, OverlayPaths } from './overlay.js';
export { doctor } from './doctor.js';
export type { DoctorCheck, DoctorResult } from './doctor.js';
export { buildExecutors, executeQualityGate, ExecutionError } from './executors.js';
export type {
  CapabilityExecutor,
  ExecutionContext,
  ExecutionResult,
  QualityGateRequest,
} from './executors.js';
export {
  assembleBrief,
  gatherClaims,
  gatherRepoProbes,
  gatherSkillsIndex,
  gatherSources,
} from './gather.js';
export * from './tools/index.js';
export { TOOL_TABLE, createMcpServer, serveStdio } from './mcp.js';
export { runCli } from './cli.js';
export type { CliIo } from './cli.js';
