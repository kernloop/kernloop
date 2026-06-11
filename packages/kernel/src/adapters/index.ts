/**
 * Kernel Adapters (spec §3.1) — public surface of the adapters module.
 *
 * Uniform interface to the five model CLIs (claude, codex, gemini,
 * opencode, ollama) with per-call token/cost metering. Explicitly NOT here:
 * routing decisions and prompt assembly (spec §3.1).
 *
 * Ported by evidence from nexus-agents v1 `src/cli-adapters/` (spec §10
 * item 2); see PORT-NOTES.md in this directory for what was kept, changed,
 * and dropped relative to v1.
 *
 * @module kernel/adapters
 */

export {
  runSubprocess,
  DEFAULT_MAX_CAPTURE_BYTES,
  type SubprocessSpec,
  type SubprocessResult,
} from './subprocess.js';
export {
  ADAPTER_NAMES,
  adapterDefinitions,
  type AdapterName,
  type AdapterDefinition,
  type AdapterCommand,
  type AdapterCommandRequest,
  type AdapterUsage,
  type ParsedOutput,
  type AdapterKind,
  type AdapterEffortProfile,
  type AdapterCommandEffort,
} from './definitions.js';
export {
  resolveTierModel,
  resolveEffort,
  type ResolvedTierModel,
  type ResolvedEffort,
} from './translate.js';
export {
  invokeAdapter,
  detectAdapter,
  type AdapterEnv,
  type AdapterAvailability,
  type AdapterInvocation,
  type AdapterResult,
  type MeteredFlags,
} from './invoke.js';
export {
  invokeApiAdapter,
  scrub,
  MAX_RESPONSE_BYTES,
  type ApiInvocation,
  type ApiAdapterResult,
  type ApiRawObservation,
} from './api.js';
export { assertSafeBaseUrl, CHAT_PATH } from './api-url.js';
export {
  API_EFFORT_PARAM,
  API_EFFORT_PROFILE,
  API_EFFORT_LEVELS,
  type ApiAdapterDefinition,
} from './api-config.js';
export {
  AdapterUnavailableError,
  AdapterRequestError,
  AdapterTimeoutError,
  AdapterExecutionError,
  AdapterOutputError,
  ApiKeyMissingError,
  ApiEndpointError,
} from './errors.js';
