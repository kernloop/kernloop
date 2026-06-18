/**
 * @kernloop/cli — the composition root (spec §9). Assembles kernel +
 * faculties (memory, compiler, gates, workforce, observer, toolsmith,
 * workflows) over a per-repo overlay (spec §7) and exposes THE KERNEL
 * ELEVEN (spec §3.4) — run, status, brief, gate, recall, remember,
 * distill, forge, manifest, audit, observe — as typed functions, CLI
 * subcommands, and an MCP server [CLM-0033, CLM-0058]. Workshop creations
 * register under the `workshop/*` manifest namespace and never extend the
 * tool surface.
 */
export {
  createKernloop,
  createProductionKernloop,
  P1_FACULTY_MANIFESTS,
  P2_MANIFESTS,
  P3_MANIFESTS,
} from './kernel.js';
export type { Kernloop, CreateKernloopOptions } from './kernel.js';
export {
  SKILL_NAME_MAX,
  SkillNameError,
  SkillProposalEmissionSchema,
  TraceNotFoundError,
  distillFromTrace,
  proposedSkillsRoot,
  resolveProposalDir,
} from './distill.js';
export type { DistillRequest, SkillProposal } from './distill.js';
export {
  LoopParseError,
  LoopResumeError,
  checkpointFile,
  executeCanonicalLoop,
  loadCheckpointTask,
} from './loop/index.js';
export type { LoopInvoke, LoopReport, LoopRequest } from './loop/index.js';
export { ballotInvoker, briefText, reviewerInvoker, ReviewEmissionSchema } from './loop/seams.js';
export type { SeamBindings } from './loop/seams.js';
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
  isCliAdapter,
} from './overlay.js';
export type { InitResult, NodeOverride, Overlay, OverlayPaths, TierAdapters } from './overlay.js';
export { EndpointSchema, EndpointsSchema, apiDefinitionFor, looksLikeSecret } from './endpoints.js';
export type { EndpointConfig, Endpoints } from './endpoints.js';
export { doctor } from './doctor.js';
export type { DoctorCheck, DoctorResult } from './doctor.js';
export { buildExecutors, executeQualityGate, publishVerdict, ExecutionError } from './executors.js';
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
