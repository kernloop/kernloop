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
 *  - BASEURL GUARD (NOT SSRF immunity): {@link assertSafeBaseUrl} validates the
 *    OPERATOR-configured `baseUrl` (scheme/credentials/path) — `https:` (or
 *    `http:` ONLY to an explicit localhost/loopback/private host, for a local
 *    vLLM/LM-Studio), and no embedded `user:pass@` credentials. It trusts the
 *    overlay as operator config; an https baseUrl MAY reach any host the
 *    operator points it at (intended — that is their provider). This is NOT
 *    full SSRF immunity against a hostile overlay. The request path is the
 *    FIXED `/chat/completions`, never user-templated; cross-host redirects are
 *    refused (`redirect: 'error'`).
 *  - HEADER PRECEDENCE: kernel-controlled `content-type`/`authorization` are
 *    written LAST so a static overlay header can never clobber the real key or
 *    inject one; reserved header NAMES are also rejected at config parse.
 *  - UNTRUSTED RESPONSE: the body is zod-validated defensively and read under a
 *    STREAMED size cap — the stream is aborted past the cap, so an oversized
 *    body is a typed error, never an OOM, crash, or a guess.
 *  - SPEND CEILING: a bounded `max_tokens` is ALWAYS sent; the metered cost
 *    flows into the run budget; an optional per-endpoint `maxUsdPerCall` fails
 *    closed if a call's reported cost would exceed it. An endpoint that
 *    declares `metersUsd` but reports NO cost on a 2xx fails closed rather than
 *    silently meter $0 — a report never implies $0 spend when spend is unknown.
 *  - TIMEOUT: ONE {@link AbortController} enforces a wall-clock budget over both
 *    the request AND the streamed body read, so a slow body is bounded too.
 *
 * @module kernel/adapters/api
 */
import { CostSchema, type Cost } from '@kernloop/contracts';
import { z } from 'zod';
import type { ApiAdapterDefinition } from './api-config.js';
import { CHAT_PATH, assertSafeBaseUrl } from './api-url.js';
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
 * (reported by some OpenAI-compatible endpoints) is the dollar amount; absence
 * means cost is unmetered.
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

/**
 * Read the response body via the STREAM under the size cap, aborting the
 * request and throwing once {@link MAX_RESPONSE_BYTES} is exceeded — the whole
 * body is never buffered, so a multi-GB body cannot OOM or hang the process.
 * UNscrubbed (parsed before surfacing). `abort` cancels the underlying request
 * so a slow/oversized stream cannot keep the socket open past the cap.
 */
async function readCappedBody(
  adapter: string,
  response: Response,
  abort: () => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return ''; // no body (e.g. HEAD/204) — empty is honest
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      abort(); // cancel egress immediately; do not buffer the overflow
      await reader.cancel().catch(() => undefined);
      throw new AdapterOutputError(
        adapter,
        out.slice(0, 200),
        `response body exceeded the ${String(MAX_RESPONSE_BYTES)}-byte cap`,
      );
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

/**
 * Validate the RAW 2xx body into the message content + usage we read, or throw a
 * typed {@link AdapterOutputError} (every surfaced string scrubbed with `key`).
 * Parsing the RAW body keeps a key that happens to be a JSON substring from
 * corrupting the parse; only surfaced strings are scrubbed.
 */
function parseResponse(
  def: ApiAdapterDefinition,
  body: string,
  key: string,
): { content: string; usage: z.infer<typeof UsageSchema> } {
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
  return { content, usage: parsed.data.usage };
}

/**
 * Parse a 2xx body into output + a metered Cost, or throw a typed error. Meters
 * honestly (tokens when present, usd when reported); fails closed when
 * `metersUsd` is declared but no cost arrived, or a cost exceeds `maxUsdPerCall`.
 */
function interpret(
  def: ApiAdapterDefinition,
  body: string,
  key: string,
  durationMs: number,
): { output: string; cost: Cost; metered: MeteredFlags } {
  const { content, usage } = parseResponse(def, body, key);
  const tokens = (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
  const usdValue = usage?.cost ?? usage?.total_cost;
  const meteredTokens =
    usage?.prompt_tokens !== undefined || usage?.completion_tokens !== undefined;
  const meteredUsd = usdValue !== undefined;
  // Prime directive: an endpoint that DECLARES it meters cost must report one —
  // metering $0 (and skipping the ceiling) when real money may have been spent
  // would imply $0 spend when spend is unknown. metersUsd:false meters tokens only.
  if (def.metersUsd && !meteredUsd) {
    throw new AdapterOutputError(
      def.name,
      scrub(body, key),
      'endpoint declared metersUsd but the 2xx response reported no cost (usage.cost/total_cost)',
    );
  }
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

  // ONE AbortController budget spans BOTH the request AND the body read, so a
  // slow body (slowloris) is bounded by the same wall-clock timeout — the timer
  // is cleared only AFTER the body has been read.
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), invocation.timeoutMs);
  try {
    const response = await postChat(def, invocation, target, key, controller.signal);
    const rawBody = await readCappedBody(def.name, response, () => controller.abort());
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
  } catch (error) {
    throw classifyCallError(def, invocation, key, controller.signal, startedAt, error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Map a raw failure from the request OR the body read into a typed error. An
 * abort (request OR slow body) under our own signal is a wall-clock
 * {@link AdapterTimeoutError}; our already-typed adapter errors pass through;
 * anything else (network/redirect) is a key-scrubbed {@link AdapterExecutionError}.
 */
function classifyCallError(
  def: ApiAdapterDefinition,
  invocation: ApiInvocation,
  key: string,
  signal: AbortSignal,
  startedAt: number,
  error: unknown,
): Error {
  // An already-typed adapter error (non-2xx, unusable output, cost-ceiling,
  // metering fail-closed) passes through unchanged — only raw fetch/abort
  // failures are classified below.
  if (
    error instanceof AdapterExecutionError ||
    error instanceof AdapterOutputError ||
    error instanceof ApiEndpointError
  ) {
    return error;
  }
  if (signal.aborted) {
    return new AdapterTimeoutError(def.name, invocation.timeoutMs, Date.now() - startedAt);
  }
  return new AdapterExecutionError(
    def.name,
    null,
    'fetch',
    scrub(error instanceof Error ? error.message : String(error), key),
  );
}

/**
 * POST the chat request under the shared {@link AbortSignal} budget, refusing
 * cross-host redirects. Kernel-controlled `content-type`/`authorization` are
 * written LAST (after the static overlay `def.headers`) so a configured header
 * can NEVER clobber the real bearer key or inject a competing one; reserved
 * header NAMES are also rejected at config parse (endpoints.ts). Returns the
 * raw {@link Response}; failures are classified by {@link classifyCallError}.
 */
async function postChat(
  def: ApiAdapterDefinition,
  invocation: ApiInvocation,
  target: URL,
  key: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(target, {
    method: 'POST',
    headers: {
      ...def.headers,
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: buildBody(invocation),
    redirect: 'error',
    signal,
  });
}
