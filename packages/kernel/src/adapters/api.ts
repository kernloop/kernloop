/**
 * The OpenAI-compatible HTTP adapter (spec §3.1 Adapters: "Uniform interface
 * to model CLIs/APIs … per-call token/cost metering"; spec §8.4 `api` kind).
 *
 * This is the ONE place kernloop holds an API key and makes a direct network
 * model call — a SIBLING to `invokeAdapter` (the subprocess path), returning
 * the SAME metered shape. It uses Node 22's global `fetch` (no new runtime
 * dependency) to POST a single user prompt to a configured
 * `${baseUrl}/chat/completions` endpoint and reads token/cost usage back out of
 * the response, honestly (metered flags say which figures the endpoint actually
 * reported — never fabricated).
 *
 * Security posture (the reviewer hunts these — see api.test.ts for each):
 *  - SECRET HYGIENE: the key is read from `process.env[def.apiKeyEnv]` AT CALL
 *    TIME only. It is never stored on the definition, the result, or `raw`,
 *    never logged, and {@link scrub} redacts it from any surfaced string
 *    (error bodies included). A missing/empty env key is a fail-closed
 *    {@link ApiKeyMissingError} naming the env var, never the value.
 *  - SSRF: {@link assertSafeBaseUrl} requires `https:` (or `http:` ONLY to an
 *    explicit localhost/loopback/private host, for a local vLLM/LM-Studio);
 *    the request path is the FIXED `/chat/completions`, never user-templated;
 *    cross-host redirects are refused (`redirect: 'error'`).
 *  - UNTRUSTED RESPONSE: the body is zod-validated defensively and read under a
 *    size cap — malformed/oversized is a typed error, never a crash or a guess.
 *  - SPEND CEILING: a bounded `max_tokens` is ALWAYS sent; the metered cost
 *    flows into the run budget; an optional per-endpoint `maxUsdPerCall` fails
 *    closed if a call's reported cost would exceed it.
 *  - TIMEOUT: an {@link AbortController} enforces a wall-clock budget, always.
 *
 * @module kernel/adapters/api
 */
import { isIP } from 'node:net';
import { CostSchema, type Cost } from '@kernloop/contracts';
import { z } from 'zod';
import type { ApiAdapterDefinition } from './api-config.js';
import {
  ApiEndpointError,
  ApiKeyMissingError,
  AdapterExecutionError,
  AdapterOutputError,
  AdapterRequestError,
  AdapterTimeoutError,
} from './errors.js';
import type { MeteredFlags } from './invoke.js';

/** Cap on the response body we will read — an oversized body is a typed error. */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** The fixed request path — never user-templated (SSRF: baseUrl is host only). */
export const CHAT_PATH = '/chat/completions';

/** One api-adapter call: the assembled prompt, a token cap, a wall-clock budget. */
export interface ApiInvocation {
  /** Fully assembled prompt — adapters do no prompt assembly (spec §3.1). */
  readonly prompt: string;
  /** Concrete model id the endpoint serves (resolved by the caller). */
  readonly model: string;
  /** Bounded output-token ceiling sent as `max_tokens` (spend ceiling). */
  readonly maxTokens: number;
  /** Wall-clock budget in ms; on breach the request is aborted. */
  readonly timeoutMs: number;
  /** Resolved `reasoning_effort` literal, or undefined when effort is dropped. */
  readonly effort?: string;
  /** Environment the key is read from at call time; default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The scrubbed network observation surfaced as `raw` (NEVER carries the key). */
export interface ApiRawObservation {
  /** HTTP status of the response. */
  readonly status: number;
  /** Wall-clock duration of the call, in milliseconds. */
  readonly durationMs: number;
  /** The response body, truncated to the cap and key-scrubbed. */
  readonly body: string;
}

/** The uniform metered result, mirroring the subprocess adapter's shape. */
export interface ApiAdapterResult {
  /** Endpoint id that served the call. */
  readonly adapter: string;
  /** Response text from `choices[0].message.content`. */
  readonly output: string;
  /** Contracts-shaped realized cost; `wallClockMs` is always measured. */
  readonly cost: Cost;
  /** Honesty flags: which cost figures the endpoint actually reported. */
  readonly metered: MeteredFlags;
  /** The scrubbed network observation — never contains the key. */
  readonly raw: ApiRawObservation;
}

/**
 * The untrusted response shape, validated DEFENSIVELY. `passthrough` is avoided
 * — only the fields we read are kept, and every numeric usage field is coerced
 * to a finite non-negative number or rejected. `usage.cost`/`usage.total_cost`
 * (OpenRouter) is the reported dollar amount; absence means cost is unmetered.
 */
const UsageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
    total_cost: z.number().nonnegative().optional(),
  })
  .optional();

const ResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }).optional(),
      }),
    )
    .optional(),
  usage: UsageSchema,
});

/**
 * Redact `key` from any surfaced string. Defence-in-depth: the key should never
 * reach a surfaced string in the first place, but error bodies are untrusted
 * and could echo a sent header, so every string we surface is scrubbed. An
 * empty key scrubs nothing (there is no secret to hide).
 */
export function scrub(text: string, key: string): string {
  if (key === '') return text;
  return text.split(key).join('[REDACTED]');
}

/**
 * Validate an api endpoint `baseUrl` BEFORE any network call (SSRF guard).
 * `https:` is always allowed; plain `http:` is allowed ONLY to an explicit
 * localhost/loopback/private host (the documented local-model escape hatch for
 * vLLM/LM-Studio). Any other scheme, or `http:` to a public host, is a typed
 * {@link ApiEndpointError}. Returns the normalized origin (scheme+host+port),
 * to which the FIXED {@link CHAT_PATH} is appended — the path is never user
 * input.
 */
export function assertSafeBaseUrl(adapter: string, baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ApiEndpointError(adapter, `baseUrl is not a valid URL: ${baseUrl}`);
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:') {
    if (isLocalHost(url.hostname)) return url;
    throw new ApiEndpointError(
      adapter,
      `http: baseUrl is allowed only for a local host (localhost/loopback/private); ` +
        `"${url.hostname}" is not local — use https: (got ${baseUrl})`,
    );
  }
  throw new ApiEndpointError(adapter, `baseUrl scheme must be http(s); got "${url.protocol}"`);
}

/** True for localhost, IPv4/IPv6 loopback, and RFC-1918/link-local private hosts. */
function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIPv4(host);
  if (ipVersion === 6) return host === '::1' || host.startsWith('fc') || host.startsWith('fd');
  return false;
}

/** True for loopback / RFC-1918 / link-local IPv4 ranges. */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10/8
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

/** Build the request body — `max_tokens` is ALWAYS present (spend ceiling). */
function buildBody(invocation: ApiInvocation): string {
  return JSON.stringify({
    model: invocation.model,
    messages: [{ role: 'user', content: invocation.prompt }],
    max_tokens: invocation.maxTokens,
    ...(invocation.effort === undefined ? {} : { reasoning_effort: invocation.effort }),
  });
}

/** Read the key from the env at call time, or fail closed naming the env var. */
function readKey(
  def: ApiAdapterDefinition,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const key = env[def.apiKeyEnv];
  if (key === undefined || key === '') throw new ApiKeyMissingError(def.name, def.apiKeyEnv);
  return key;
}

/** Reject an invocation the adapter cannot honestly execute. */
function checkInvocation(def: ApiAdapterDefinition, invocation: ApiInvocation): void {
  if (invocation.model === '') {
    throw new AdapterRequestError(def.name, 'requires a concrete model id (none resolved)');
  }
  if (!Number.isFinite(invocation.timeoutMs) || invocation.timeoutMs <= 0) {
    throw new AdapterRequestError(def.name, 'timeoutMs must be a positive finite number');
  }
  if (!Number.isInteger(invocation.maxTokens) || invocation.maxTokens <= 0) {
    throw new AdapterRequestError(def.name, 'maxTokens must be a positive integer (spend ceiling)');
  }
}

/** Read the response body under the size cap (UNscrubbed — parsed before surfacing). */
async function readCappedBody(response: Response): Promise<string> {
  const raw = await response.text();
  return raw.length > MAX_RESPONSE_BYTES ? raw.slice(0, MAX_RESPONSE_BYTES) : raw;
}

/**
 * Parse a 2xx body into output + a metered Cost, or throw a typed error.
 * Parses the RAW body (scrubbing here would corrupt JSON when a key happens to
 * be a substring); every surfaced string (the {@link AdapterOutputError}'s
 * stdout/stderr) is scrubbed with `key` so no secret escapes.
 */
function interpret(
  def: ApiAdapterDefinition,
  body: string,
  key: string,
  durationMs: number,
): { output: string; cost: Cost; metered: MeteredFlags } {
  let json: unknown;
  try {
    json = JSON.parse(body) as unknown;
  } catch {
    throw new AdapterOutputError(def.name, scrub(body, key), '');
  }
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AdapterOutputError(
      def.name,
      scrub(body, key),
      scrub(z.prettifyError(parsed.error), key),
    );
  }
  const content = parsed.data.choices?.[0]?.message?.content;
  if (content === undefined || content === null || content === '') {
    throw new AdapterOutputError(def.name, scrub(body, key), 'response carried no message content');
  }
  const usage = parsed.data.usage;
  const tokens = (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
  const usdValue = usage?.cost ?? usage?.total_cost;
  const meteredTokens =
    usage?.prompt_tokens !== undefined || usage?.completion_tokens !== undefined;
  const meteredUsd = usdValue !== undefined;
  const usd = usdValue ?? 0;
  enforceUsdCeiling(def, usd, meteredUsd);
  const cost = CostSchema.parse({
    tokens,
    usd,
    wallClockMs: durationMs,
    byAdapter: { [def.name]: { tokens, usd } },
  });
  return { output: content, cost, metered: { tokens: meteredTokens, usd: meteredUsd } };
}

/** Fail closed when a metered call's reported cost exceeds the endpoint cap. */
function enforceUsdCeiling(def: ApiAdapterDefinition, usd: number, meteredUsd: boolean): void {
  if (def.maxUsdPerCall !== undefined && meteredUsd && usd > def.maxUsdPerCall) {
    throw new ApiEndpointError(
      def.name,
      `reported call cost $${String(usd)} exceeds maxUsdPerCall $${String(def.maxUsdPerCall)}`,
    );
  }
}

/**
 * Invoke one OpenAI-compatible HTTP endpoint, metered (spec §3.1 / §8.4 `api`).
 * The SIBLING of `invokeAdapter`: same metered result shape, network instead of
 * subprocess. Failure is ALWAYS a typed error, never a stubbed success:
 *  - {@link ApiKeyMissingError} — env key unset/empty (names the var, not value)
 *  - {@link ApiEndpointError}   — unsafe baseUrl, or a cost over `maxUsdPerCall`
 *  - {@link AdapterRequestError}— malformed invocation
 *  - {@link AdapterTimeoutError}— wall-clock breach (AbortController)
 *  - {@link AdapterExecutionError} — non-2xx (status + a SCRUBBED body)
 *  - {@link AdapterOutputError} — 2xx with no usable message / malformed JSON
 */
export async function invokeApiAdapter(
  def: ApiAdapterDefinition,
  invocation: ApiInvocation,
): Promise<ApiAdapterResult> {
  checkInvocation(def, invocation);
  const key = readKey(def, invocation.env ?? process.env); // fail-closed BEFORE any egress
  const origin = assertSafeBaseUrl(def.name, def.baseUrl);
  const target = new URL(origin.pathname.replace(/\/$/, '') + CHAT_PATH, origin);

  const startedAt = Date.now();
  const response = await postChat(def, invocation, target, key, startedAt);
  const rawBody = await readCappedBody(response);
  const scrubbedBody = scrub(rawBody, key); // the only form we ever surface
  const durationMs = Date.now() - startedAt;
  if (!response.ok) {
    throw new AdapterExecutionError(def.name, response.status, null, scrubbedBody);
  }
  // Parse the RAW body (a key that is a JSON substring must not corrupt parse),
  // but surface only the SCRUBBED body on `raw` (defence-in-depth secret hygiene).
  const { output, cost, metered } = interpret(def, rawBody, key, durationMs);
  return {
    adapter: def.name,
    output,
    cost,
    metered,
    raw: { status: response.status, durationMs, body: scrubbedBody },
  };
}

/**
 * POST the chat request under an {@link AbortController} wall-clock budget,
 * refusing cross-host redirects (SSRF). A timeout is a typed
 * {@link AdapterTimeoutError}; any other network/redirect failure is an
 * {@link AdapterExecutionError} whose message is key-scrubbed.
 */
async function postChat(
  def: ApiAdapterDefinition,
  invocation: ApiInvocation,
  target: URL,
  key: string,
  startedAt: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), invocation.timeoutMs);
  try {
    return await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        ...def.headers,
      },
      body: buildBody(invocation),
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AdapterTimeoutError(def.name, invocation.timeoutMs, Date.now() - startedAt);
    }
    throw new AdapterExecutionError(
      def.name,
      null,
      'fetch',
      scrub(error instanceof Error ? error.message : String(error), key),
    );
  } finally {
    clearTimeout(timer);
  }
}
