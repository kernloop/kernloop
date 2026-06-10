/**
 * The nine P1 kernel tools (spec §3.4, P1 row of §11) — the complete tool
 * surface this phase [CLM-0033]. `distill` and `forge` are P3 capabilities
 * and are ABSENT, not stubbed (constitutional rule 1).
 */
export { runTool, RunInputSchema, buildTask, reportDecision } from './run.js';
export type { RunInput, RunResult, RoutingReport } from './run.js';
export { statusTool, StatusInputSchema } from './status.js';
export type { StatusInput, StatusResult } from './status.js';
export { briefTool, BriefInputSchema } from './brief.js';
export type { BriefInput } from './brief.js';
export { gateTool, GateInputSchema, UnknownGateError, P1_GATES } from './gate.js';
export type { GateInput } from './gate.js';
export { recallTool, RecallInputSchema } from './recall.js';
export type { RecallInput, RecallResult } from './recall.js';
export { rememberTool, RememberInputSchema } from './remember.js';
export type { RememberInput, RememberResult } from './remember.js';
export { manifestTool, ManifestInputSchema } from './manifest.js';
export type { ManifestInput, ManifestResult } from './manifest.js';
export { auditTool, AuditInputSchema, readEnvelopes } from './audit.js';
export type { AuditInput, AuditResult } from './audit.js';
export { observeTool, ObserveInputSchema } from './observe.js';
export type { ObserveInput, ObserveResult } from './observe.js';

/** The nine P1 tool names, in spec §3.4 order (minus the P3 pair). */
export const P1_TOOL_NAMES = [
  'run',
  'status',
  'brief',
  'gate',
  'recall',
  'remember',
  'manifest',
  'audit',
  'observe',
] as const;
export type P1ToolName = (typeof P1_TOOL_NAMES)[number];
