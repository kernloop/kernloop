/**
 * @kernloop/faculty-toolsmith — Layer 2 toolsmith faculty (spec §5.6),
 * in the first build and caged.
 *
 * Surface: `forge` (birth requirements → injected generation → in-sandbox
 * acceptance test → workshop install), the ratified Docker sandbox profile
 * (frozen, hash-gated), the `workshop/*` namespace with its 12-tool cap and
 * human-ratified `retire`, and the workshop ladder (born suggest → advisory
 * after clean runs → enforce only with ratification → decay toward
 * removal_proposed when unused).
 *
 * This faculty is model-free: generation arrives via the injected
 * InvokeToolGenerator bound at the composition root. Kernel-side audit of
 * builds, runs, and transitions happens at composition-root wiring. The
 * faculty imports @kernloop/contracts, the shared @kernloop/kernel sandbox
 * primitive (#234 — faculty→kernel is allowed; rule 5 only bars faculty→
 * faculty), and external dependencies — never another faculty.
 */
export {
  ForgeBirthError,
  ForgeTestFailedError,
  LadderOrderError,
  RatificationRequiredError,
  UnknownToolError,
  WorkshopCapError,
  WorkshopNameError,
} from './errors.js';
// The Docker sandbox primitive + its errors live in the kernel now (#234) so
// faculty-gates can reuse them (#227 item 2); re-exported here from the kernel
// so the toolsmith's documented surface and back-compat are unchanged.
export {
  buildDockerArgs,
  runInSandbox,
  SandboxMountError,
  SandboxProfileMismatchError,
  SandboxUnavailableError,
  type SandboxMount,
  type SandboxResult,
  type SandboxRunOptions,
} from '@kernloop/kernel';
export {
  RATIFIED_PROFILE_HASH,
  RATIFIED_SANDBOX_PROFILE,
  SandboxProfileSchema,
  canonicalJson,
  profileHash,
} from './profile.js';
export type { SandboxProfile } from './profile.js';
export { forge, ToolClaimSchema, ToolSpecSchema } from './forge.js';
export type { ForgeOptions, ForgeResult, InvokeToolGenerator, ToolSpec } from './forge.js';
export { runWorkshopTool } from './run.js';
export type { RunWorkshopToolOptions, RunWorkshopToolResult } from './run.js';
export {
  RETIRED_DIR,
  SAFE_TOOL_NAME,
  WORKSHOP_DIR,
  listTools,
  retire,
  toolDir,
  workshopDir,
} from './workshop.js';
export type { RetireOptions, RetireResult, WorkshopToolInfo } from './workshop.js';
export {
  N_CLEAN_RUNS_FOR_ADVISORY,
  loadLifecycle,
  promote,
  promoteIfEarned,
  recordRun,
  registerTool,
  sweepDecay,
} from './lifecycle.js';
export type { LifecycleEvent, LifecycleFile, ToolLifecycle, WorkshopTier } from './lifecycle.js';
export { toolsmithManifest } from './manifest.js';
