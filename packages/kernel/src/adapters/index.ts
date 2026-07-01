/**
 * Kernel Adapters (spec §3.1) — public surface of the adapters module.
 *
 * Uniform interface to the five model CLIs (claude, codex, opencode,
 * ollama, agy) with per-call token/cost metering. Explicitly NOT here:
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
export { SAFE_ENV_KEYS, scopedChildEnv, droppedEnvKeys } from './env.js';
export {
  ADAPTER_NAMES,
  adapterDefinitions,
  pureCompletionCoverage,
  type PureCompletionCoverage,
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
  readCappedBody,
  MAX_RESPONSE_BYTES,
  type ApiInvocation,
  type ApiAdapterResult,
  type ApiRawObservation,
} from './api.js';
export {
  ChatMessageSchema,
  API_MAX_TOKENS_CEILING,
  MAX_MESSAGES,
  MAX_MESSAGE_CONTENT_CHARS,
  type ChatMessage,
} from './api-body.js';
export {
  discoverApiModels,
  discoverOllamaModels,
  discoverCliModels,
  CLI_DISCOVERY_ADAPTERS,
  CLI_DISCOVERY_TIMEOUT_MS,
  DISCOVERY_TIMEOUT_MS,
  DEFAULT_OLLAMA_HOST,
} from './discover.js';
export { assertSafeBaseUrl, CHAT_PATH, MODELS_PATH, OLLAMA_TAGS_PATH } from './api-url.js';
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
  AgenticRepositoryWorkspaceError,
} from './errors.js';
export {
  checkAgenticContainment,
  isNonThrowawayGitTree,
  carveOutMaskedGitTree,
  AGENTIC_ADAPTERS,
  NON_AGENTIC_ADAPTERS,
} from './containment.js';
