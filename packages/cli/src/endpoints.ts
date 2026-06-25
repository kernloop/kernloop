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
 * (e.g. `sk-…`, a long high-entropy token) is REJECTED at parse. The same
 * key-shaped guard runs over every header VALUE as defence-in-depth (it is
 * bypassable for short keys — see {@link looksLikeSecret}), and reserved header
 * NAMES (authorization, host, content-type, content-length, cookie) are
 * rejected outright so a static header can never clobber the kernel-controlled
 * auth header or inject a routing trick. The key is read from the environment
 * at call time inside the kernel adapter, not from this file.
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

/**
 * Header VALUES must not carry a literal secret — defence-in-depth only (a key
 * belongs in the env). This guard is bypassable for short keys; it is not the
 * primary control (that is `apiKeyEnv` + reserved-name rejection).
 */
const HeaderValueSchema = z.string().refine((v) => !looksLikeSecret(v), {
  message: 'header value looks like a literal secret — keep keys in the env, not in overlay.yaml',
});

/**
 * Header NAMES a static overlay header may never set: the kernel writes
 * `authorization`/`content-type` itself (and they must always win), and
 * `host`/`content-length`/`cookie` enable routing/smuggling tricks. Rejected at
 * parse, case-insensitively, so config can never clobber a kernel-controlled
 * header or inject one.
 */
const RESERVED_HEADER_NAMES = new Set([
  'authorization',
  'host',
  'content-type',
  'content-length',
  'cookie',
]);

/** A header NAME the overlay may set — never one the kernel controls. */
const HeaderNameSchema = z
  .string()
  .min(1)
  .refine((k) => !RESERVED_HEADER_NAMES.has(k.toLowerCase()), {
    message:
      'reserved header name — authorization/host/content-type/content-length/cookie are kernel-controlled and cannot be set in config',
  });

/** Tier → concrete model id this endpoint serves (spec §8.4); any subset of tiers. */
const ModelsSchema = z.partialRecord(ModelTierSchema, z.string().min(1));

/**
 * One registered endpoint. `baseUrl` is validated for scheme/credentials inside
 * the kernel adapter at call time (the single enforcement point); here we
 * validate the config SHAPE, the secret-hygiene invariant, and the
 * metersUsd/maxUsdPerCall coherence (a cap is inert without metering).
 */
export const EndpointSchema = z
  .strictObject({
    baseUrl: z.string().min(1),
    apiKeyEnv: ApiKeyEnvSchema,
    models: ModelsSchema,
    headers: z.record(HeaderNameSchema, HeaderValueSchema).optional(),
    capabilities: z.array(ModelCapabilitySchema).optional(),
    metersUsd: z.boolean().optional(),
    maxUsdPerCall: z.number().positive().optional(),
  })
  .refine((e) => !(e.maxUsdPerCall !== undefined && e.metersUsd !== true), {
    path: ['maxUsdPerCall'],
    message:
      'maxUsdPerCall requires metersUsd:true — a cap on an unmetered endpoint is inert and would imply a spend ceiling that is never checked',
  });
export type EndpointConfig = z.infer<typeof EndpointSchema>;

/** The `endpoints` block: id → endpoint config. Ids are referenced by `adapters`. */
export const EndpointsSchema = z.record(z.string().min(1), EndpointSchema);
export type Endpoints = z.infer<typeof EndpointsSchema>;

/**
 * Re-key a parsed endpoints map onto a NULL-PROTOTYPE object (#474). A plain object
 * carries `Object.prototype`, so `map[name]` for an inherited key (`constructor`,
 * `toString`, `valueOf`, …) returns the inherited member, not `undefined` — which would
 * let such an adapter name slip past every `endpoints[name] === undefined` membership
 * check (a lying budget audit, a skipped containment guard). A null-proto map returns
 * `undefined` for any non-own key, so the lexical checks become structurally sound.
 * Own-key iteration and spread are unaffected.
 */
export function ownKeyedEndpoints(map: Endpoints): Endpoints {
  return Object.assign(Object.create(null) as Endpoints, map);
}

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
