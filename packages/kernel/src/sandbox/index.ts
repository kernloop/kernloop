/**
 * Kernel Sandbox (spec §5.6) — the shared Docker-isolation primitive.
 *
 * One command runs inside a profile shape (no network, scratch-scoped FS,
 * memory/cpu/pids caps, time-boxed kill); docker absent ⇒ typed refusal,
 * never an unsandboxed fallback. Lives in the kernel so faculty-toolsmith and
 * faculty-gates share it without a faculty→faculty import (rule 5). The kernel
 * holds no intelligence: this is process-isolation mechanism, no model call.
 *
 * @module kernel/sandbox
 */
export {
  buildDockerArgs,
  runInSandbox,
  type SandboxMount,
  type SandboxResult,
  type SandboxRunOptions,
} from './sandbox.js';
export { SandboxExecProfileSchema, type SandboxExecProfile } from './profile.js';
export {
  SandboxUnavailableError,
  SandboxProfileMismatchError,
  SandboxMountError,
} from './errors.js';
