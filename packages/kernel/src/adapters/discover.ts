/**
 * Model DISCOVERY [CLM-0086] — enumerate the models an endpoint actually serves
 * via its stable PUBLIC contract (OpenAI `GET /v1/models`, ollama
 * `GET /api/tags`), the deferred extension spec §5.7 names ("Discovery (live
 * `/v1/models` enumeration)"). This is a SIBLING of {@link
 * import('./api.js').invokeApiAdapter} that READS the catalog instead of calling
 * a model — and it REUSES that path's security primitives rather than
 * re-inventing them:
 *  - SECRET HYGIENE: the api key is read from `env[def.apiKeyEnv]` AT CALL TIME
 *    only (a missing/empty key is a fail-closed {@link ApiKeyMissingError} naming
 *    the env var, never the value); every surfaced string is run through
 *    {@link scrub}, so a hostile endpoint that echoes the `Authorization` header
 *    in its error body cannot leak the key (the discovery no-leak test).
 *  - BASEURL GUARD: {@link assertSafeBaseUrl} validates the operator baseUrl
 *    (scheme/credentials) BEFORE any egress; the request path is the FIXED
 *    {@link MODELS_PATH} / {@link OLLAMA_TAGS_PATH}, never user-templated;
 *    cross-host redirects are refused (`redirect: 'error'`).
 *  - STREAMED SIZE CAP: the body is read via {@link readCappedBody} (the SAME
 *    reader the model-call path uses) so an oversized listing is a typed error,
 *    never an OOM.
 *  - TIMEOUT: ONE {@link AbortController} bounds both the request and the body
 *    read.
 *
 * HONESTY (prime directive): discovery returns ONLY the ids the endpoint
 * actually listed. A non-2xx, a malformed body, or a body that fails the
 * DEFENSIVE zod parse is a TYPED error, never a guessed/fabricated model. The
 * ollama path is LOCAL and carries no secret.
 *
 * @module kernel/adapters/discover
 */
import { z } from 'zod';
import type { ApiAdapterDefinition } from './api-config.js';
import { MODELS_PATH, OLLAMA_TAGS_PATH, assertSafeBaseUrl } from './api-url.js';
import { readCappedBody, scrub } from './api.js';
import {
  AdapterExecutionError,
  AdapterOutputError,
  AdapterTimeoutError,
  ApiKeyMissingError,
} from './errors.js';

/** Wall-clock budget for a single discovery request (ms) — discovery is a read. */
export const DISCOVERY_TIMEOUT_MS = 20_000;

/**
 * The untrusted OpenAI `GET /v1/models` body, validated DEFENSIVELY: a top-level
 * `data` array of objects each carrying a string `id`. Extra fields are ignored
 * (no passthrough); a non-string/empty id is dropped, not coerced.
 */
const OpenAiModelsSchema = z.object({
  data: z.array(z.object({ id: z.string() }).loose()).optional(),
});

/**
 * The untrusted ollama `GET /api/tags` body, validated DEFENSIVELY: a top-level
 * `models` array each carrying a string `name` (the served tag, e.g.
 * `llama3.1:8b`). `model` is the alias; we surface `name` (the listed tag).
 */
const OllamaTagsSchema = z.object({
  models: z.array(z.object({ name: z.string() }).loose()).optional(),
});

/** Read the api key at call time or fail closed naming the env var (never the value). */
function readKey(
  def: ApiAdapterDefinition,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const key = env[def.apiKeyEnv];
  if (key === undefined || key === '') throw new ApiKeyMissingError(def.name, def.apiKeyEnv);
  return key;
}

/** Build the discovery target URL: origin + the FIXED path (never templated). */
function discoveryTarget(origin: URL, path: string): URL {
  return new URL(origin.pathname.replace(/\/$/, '') + path, origin);
}

/**
 * GET a discovery endpoint under ONE wall-clock AbortController budget (spanning
 * request + body read), returning the SCRUBBED body on 2xx or throwing a typed
 * error. `key` is scrubbed from every surfaced string (defence-in-depth); pass
 * `''` for the no-secret ollama path (scrub is then a no-op).
 */
async function getDiscovery(
  adapter: string,
  target: URL,
  headers: Readonly<Record<string, string>>,
  key: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: controller.signal,
    });
    const body = scrub(await readCappedBody(adapter, response, () => controller.abort()), key);
    if (!response.ok) throw new AdapterExecutionError(adapter, response.status, null, body);
    return body;
  } catch (error) {
    throw classifyDiscoveryError(adapter, key, controller.signal, error);
  } finally {
    clearTimeout(timer);
  }
}

/** Map a raw discovery failure to a typed error (abort → timeout; else scrubbed). */
function classifyDiscoveryError(
  adapter: string,
  key: string,
  signal: AbortSignal,
  error: unknown,
): Error {
  if (error instanceof AdapterExecutionError || error instanceof AdapterOutputError) return error;
  if (signal.aborted)
    return new AdapterTimeoutError(adapter, DISCOVERY_TIMEOUT_MS, DISCOVERY_TIMEOUT_MS);
  return new AdapterExecutionError(
    adapter,
    null,
    'fetch',
    scrub(error instanceof Error ? error.message : String(error), key),
  );
}

/** Parse a 2xx discovery body with a defensive schema, or throw a typed (scrubbed) error. */
function parseListing<T>(
  adapter: string,
  body: string,
  key: string,
  schema: z.ZodType<T>,
  extract: (parsed: T) => string[],
): string[] {
  let json: unknown;
  try {
    json = JSON.parse(body) as unknown;
  } catch {
    throw new AdapterOutputError(adapter, scrub(body, key), 'discovery body was not valid JSON');
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new AdapterOutputError(
      adapter,
      scrub(body, key),
      scrub(z.prettifyError(result.error), key),
    );
  }
  // De-duplicate while preserving order; drop empties (never a fabricated id).
  return [...new Set(extract(result.data).filter((id) => id !== ''))];
}

/**
 * Discover the model ids an OpenAI-compatible endpoint serves via
 * `GET ${baseUrl}/models` [CLM-0086]. The bearer key is read from the env at
 * call time and scrubbed from every surface. Returns the listed ids (order
 * preserved, de-duplicated); a non-2xx / malformed / non-conforming body is a
 * typed error ({@link AdapterExecutionError}/{@link AdapterOutputError}/{@link
 * AdapterTimeoutError}/{@link ApiKeyMissingError}, or an `ApiEndpointError` from
 * the baseUrl guard), never a guessed model.
 */
export async function discoverApiModels(
  def: ApiAdapterDefinition,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string[]> {
  const key = readKey(def, env); // fail closed BEFORE any egress
  const origin = assertSafeBaseUrl(def.name, def.baseUrl);
  const target = discoveryTarget(origin, MODELS_PATH);
  const body = await getDiscovery(
    def.name,
    target,
    { ...def.headers, accept: 'application/json', authorization: `Bearer ${key}` },
    key,
  );
  return parseListing(def.name, body, key, OpenAiModelsSchema, (p) =>
    (p.data ?? []).map((m) => m.id),
  );
}

/** The default ollama host (the local daemon) — a plain origin, no `/v1` prefix. */
export const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';

/**
 * Discover the model tags a LOCAL ollama daemon serves via `GET ${host}/api/tags`
 * [CLM-0086]. No secret is involved (local, unauthenticated); `host` is guarded
 * by the SAME {@link assertSafeBaseUrl} (which permits `http:` to a local host).
 * Returns the listed tag `name`s; a non-2xx / malformed body is a typed error,
 * never a guess.
 */
export async function discoverOllamaModels(host: string = DEFAULT_OLLAMA_HOST): Promise<string[]> {
  const adapter = 'ollama';
  const origin = assertSafeBaseUrl(adapter, host);
  const target = discoveryTarget(origin, OLLAMA_TAGS_PATH);
  const body = await getDiscovery(adapter, target, { accept: 'application/json' }, '');
  return parseListing(adapter, body, '', OllamaTagsSchema, (p) =>
    (p.models ?? []).map((m) => m.name),
  );
}
