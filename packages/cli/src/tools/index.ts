/**
 * THE KERNEL ELEVEN (spec §3.4) — the complete MCP tool surface
 * [CLM-0033, CLM-0058]: run, status, brief, gate, recall, remember,
 * distill, forge, manifest, audit, observe. Eleven, frozen; depth ships as
 * skills or `workshop/*` creations, never tool #12.
 */
export { runTool, RunInputSchema, buildTask, reportDecision } from './run.js';
export type { RunInput, RunResult, RoutingReport } from './run.js';
export { statusTool, StatusInputSchema } from './status.js';
export type { StatusInput, StatusResult } from './status.js';
export { briefTool, BriefInputSchema } from './brief.js';
export type { BriefInput } from './brief.js';
export { gateTool, GateInputSchema, UnknownGateError, GATE_NAMES } from './gate.js';
export type { GateInput, GateToolOptions } from './gate.js';
export { recallTool, RecallInputSchema } from './recall.js';
export type { RecallInput, RecallResult } from './recall.js';
export { rememberTool, RememberInputSchema } from './remember.js';
export type { RememberInput, RememberResult } from './remember.js';
export { distillTool, DistillInputSchema } from './distill.js';
export type { DistillInput } from './distill.js';
export { forgeTool, ForgeInputSchema, SourceEmissionSchema, generatorInvoker } from './forge.js';
export type { ForgeInput, ForgeToolOptions } from './forge.js';
export { manifestTool, ManifestInputSchema } from './manifest.js';
export type { ManifestInput, ManifestResult } from './manifest.js';
export { auditTool, AuditInputSchema, readEnvelopes } from './audit.js';
export type { AuditInput, AuditResult } from './audit.js';
export { observeTool, ObserveInputSchema } from './observe.js';
export type { ObserveInput, ObserveResult } from './observe.js';

/** The kernel eleven tool names, in spec §3.4 order. */
export const KERNEL_TOOL_NAMES = [
  'run',
  'status',
  'brief',
  'gate',
  'recall',
  'remember',
  'distill',
  'forge',
  'manifest',
  'audit',
  'observe',
] as const;
export type KernelToolName = (typeof KERNEL_TOOL_NAMES)[number];
