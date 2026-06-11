/**
 * The overlay `endpoints` block (spec §7 overlay + §8.4 `api` adapter): the
 * user registers OpenAI-compatible HTTP endpoints as data, then references one
 * by id from the per-tier `adapters` map. An endpoint declares WHERE to call
 * (`baseUrl`), the NAME of the env var its key is read from (`apiKeyEnv` — never
 * the key itself), and a tier → CONCRETE model id map.
 *
 * SECRET HYGIENE AT THE CONFIG BOUNDARY (the security reviewer hunts this): a
 * literal key must NEVER appear in `overlay.yaml`. `apiKeyEnv` is validated as a
 * plausible ENV-VAR NAME (`^[A-Z_][A-Z0-9_]*$`) — a value that looks like a key
 * (e.g. `sk-…`, a long high-entropy token) is REJECTED at parse, and the same
 * key-shaped guard runs over every header value. The key is read from the
 * environment at call time inside the kernel adapter, not from this file.
 *
 * @module cli/endpoints
 */
import { API_EFFORT_PROFILE, type ApiAdapterDefinition } from '@kernloop/kernel';
import { ModelCapabilitySchema, ModelTierSchema, type ModelCapability } from '@kernloop/contracts';
import { z } from 'zod';

/** A plausible env-var NAME — never a key value. Upper snake, no leading digit. */
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Looks like a secret, not config. Catches the common provider key prefixes and
 * any long high-entropy token. Used to REJECT a literal key anywhere a NAME or a
 * header is expected — the file must never carry the secret (spec §3.1).
 */
export function looksLikeSecret(value: string): boolean {
  // A provider key token, anywhere in the value (e.g. `Bearer sk-…`).
  if (/(^|[\s:=])(sk|pk|rk)-[A-Za-z0-9]/i.test(value)) return true;
  if (/^(or|api|key|tok)[-_]/i.test(value)) return true;
  // A long, mixed-case/alphanumeric token with no spaces reads as a credential.
  for (const part of value.split(/\s+/)) {
    if (part.length >= 24 && /[A-Za-z]/.test(part) && /[0-9]/.test(part)) return true;
  }
  return false;
}

/** `apiKeyEnv`: an env-var NAME, explicitly NOT a key value. */
const ApiKeyEnvSchema = z
  .string()
  .regex(ENV_NAME, 'apiKeyEnv must be an ENV-VAR NAME (UPPER_SNAKE), not a key value')
  .refine((v) => !looksLikeSecret(v), {
    message:
      'apiKeyEnv looks like a literal key — it must be the NAME of an env var, never the key',
  });

/** Header values must not carry a literal secret (a key belongs in the env). */
const HeaderValueSchema = z.string().refine((v) => !looksLikeSecret(v), {
  message: 'header value looks like a literal secret — keep keys in the env, not in overlay.yaml',
});

/** Tier → concrete model id this endpoint serves (spec §8.4); any subset of tiers. */
const ModelsSchema = z.partialRecord(ModelTierSchema, z.string().min(1));

/**
 * One registered endpoint. `baseUrl` is validated for scheme/SSRF inside the
 * kernel adapter at call time (the single enforcement point); here we validate
 * the config SHAPE and the secret-hygiene invariant.
 */
export const EndpointSchema = z.strictObject({
  baseUrl: z.string().min(1),
  apiKeyEnv: ApiKeyEnvSchema,
  models: ModelsSchema,
  headers: z.record(z.string().min(1), HeaderValueSchema).optional(),
  capabilities: z.array(ModelCapabilitySchema).optional(),
  metersUsd: z.boolean().optional(),
  maxUsdPerCall: z.number().positive().optional(),
});
export type EndpointConfig = z.infer<typeof EndpointSchema>;

/** The `endpoints` block: id → endpoint config. Ids are referenced by `adapters`. */
export const EndpointsSchema = z.record(z.string().min(1), EndpointSchema);
export type Endpoints = z.infer<typeof EndpointsSchema>;

/**
 * Build a kernel {@link ApiAdapterDefinition} from a registered endpoint. The
 * definition carries the env-var NAME (never a key), the tier→model map, the
 * `reasoning_effort` body profile, and the optional spend cap — everything the
 * kernel `invokeApiAdapter` needs, with the key resolved from the env at call
 * time. Pure: no I/O, no env read here.
 */
export function apiDefinitionFor(id: string, config: EndpointConfig): ApiAdapterDefinition {
  return {
    name: id,
    kind: 'api',
    baseUrl: config.baseUrl,
    apiKeyEnv: config.apiKeyEnv,
    ...(config.headers === undefined ? {} : { headers: config.headers }),
    tierBinding: config.models,
    effort: API_EFFORT_PROFILE,
    capabilities: (config.capabilities ?? ['toolUse', 'jsonMode']) as readonly ModelCapability[],
    metersUsd: config.metersUsd ?? false,
    ...(config.maxUsdPerCall === undefined ? {} : { maxUsdPerCall: config.maxUsdPerCall }),
  };
}
