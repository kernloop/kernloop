/**
 * Model DISCOVERY [CLM-0086] — enumerate the models an endpoint actually serves
 * via its stable PUBLIC contract (OpenAI `GET /v1/models`, ollama
 * `GET /api/tags`), the discovery extension spec §5.7 describes ("Discovery (live
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
 *    (scheme/credentials) BEFORE any egress; the request path is the fixed
 *    {@link MODELS_PATH} / {@link OLLAMA_TAGS_PATH} SUFFIX (the operator baseUrl prefix rides along);
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
 * COUNT CAP (#266): every listing — http or CLI — is bounded to
 * {@link MAX_DISCOVERED_MODELS} ids after de-duplication, so a pathological
 * endpoint that returns a huge (yet under-the-byte-cap) `data` array cannot
 * blow up the discovered-cache write; the bound is symmetric across transports.
 *
 * @module kernel/adapters/discover
 */
import { tmpdir } from 'node:os';
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
import { scopedChildEnv } from './env.js';
import { runSubprocess, type SubprocessResult, type SubprocessSpec } from './subprocess.js';

/** Wall-clock budget for a single discovery request (ms) — discovery is a read. */
export const DISCOVERY_TIMEOUT_MS = 20_000;

/**
 * Hard cap on the model ids any single discovery source returns (#266) — http or
 * CLI. Bounds a pathological listing (a huge-but-under-the-byte-cap `data` array,
 * or a runaway CLI) before it reaches the discovered-cache write. Generous: real
 * catalogs are in the hundreds.
 */
const MAX_DISCOVERED_MODELS = 5_000;

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
  // De-duplicate while preserving order; drop empties (never a fabricated id);
  // bound to the count cap (#266) with an EARLY EXIT so a pathological listing is
  // not fully de-duplicated before truncation (the zod parse already bounded the
  // array against the byte cap; this caps the dedup pass too).
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of extract(result.data)) {
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_DISCOVERED_MODELS) break;
  }
  return out;
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

/**
 * Agent-CLI adapters that expose an ENUMERABLE model list, and the fixed argv to
 * list them (#131). A harness-routed CLI (claude/codex/gemini) routes by alias
 * and exposes NO list — absent here, it degrades to its declared tier-bindings
 * (the `cli:<name>` source, #171). Only `opencode` enumerates today (~338).
 */
const CLI_LIST_COMMANDS: Readonly<Record<string, readonly string[]>> = { opencode: ['models'] };

/** The agent-CLI adapters with an enumerable model list — what `models sync` live-probes (#131). */
export const CLI_DISCOVERY_ADAPTERS: readonly string[] = Object.freeze(
  Object.keys(CLI_LIST_COMMANDS),
);

/** Wall-clock budget for a CLI model-list probe (a local read; never the launch dir). */
export const CLI_DISCOVERY_TIMEOUT_MS = 30_000;
/** Capture cap for the list — a model list is tiny; this bounds a runaway CLI. */
const CLI_LIST_CAPTURE_BYTES = 1024 * 1024;

/**
 * Discover the models an agent-CLI adapter enumerates by spawning its fixed
 * list command (e.g. `opencode models`) under a bounded {@link runSubprocess}
 * (#131). The command + args are STATIC (no shell, no interpolation), stdout is
 * capture-capped + timeout-bounded, and the output is parsed as DATA ONLY — one
 * model id per line, trimmed, length-bounded, de-duplicated, count-capped; a
 * model id is never executed (one that fails identity normalization just resolves
 * to `unknown`). An adapter with no list command returns `[]` (honest — its
 * declared bindings cover it, #171); an absent/failed/timed-out CLI is a typed
 * error ({@link AdapterExecutionError}/{@link AdapterTimeoutError}), never a guess
 * (#131, CLM-0131).
 *
 * SECRET HYGIENE (#131 security round): the spawned CLI is a third-party agentic
 * binary, so its child env is SCOPED via {@link scopedChildEnv} to the benign
 * operational allowlist ∪ `envAllow` — it is NEVER handed the host `process.env`
 * (other providers' keys, `GH_TOKEN`, cloud creds), exactly as the model-CALL
 * path scopes it. A login-authed CLI works on the base allowlist (HOME/XDG); a
 * key-authed one names its var in the overlay's `adapterEnvAllow`, threaded here
 * as `envAllow`. `run` is injectable for tests.
 */
export async function discoverCliModels(
  adapter: string,
  run: (spec: SubprocessSpec) => Promise<SubprocessResult> = runSubprocess,
  envAllow: readonly string[] = [],
): Promise<string[]> {
  const args = CLI_LIST_COMMANDS[adapter];
  if (args === undefined) return [];
  let result: SubprocessResult;
  try {
    result = await run({
      command: adapter,
      args,
      // Neutral cwd: an agentic CLI must NOT inherit the launch dir (#146 / the
      // runSubprocess cwd warning) — the list command needs no project context.
      cwd: tmpdir(),
      // Least-privilege child env — never the host secrets (#131 security round).
      env: scopedChildEnv(process.env, envAllow),
      timeoutMs: CLI_DISCOVERY_TIMEOUT_MS,
      maxCaptureBytes: CLI_LIST_CAPTURE_BYTES,
    });
  } catch (error) {
    // Spawn failure (ENOENT/EACCES) — the CLI is not installed/runnable.
    throw new AdapterExecutionError(
      adapter,
      null,
      null,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (result.timedOut)
    throw new AdapterTimeoutError(adapter, CLI_DISCOVERY_TIMEOUT_MS, result.durationMs);
  if (result.exitCode !== 0) {
    throw new AdapterExecutionError(adapter, result.exitCode, result.signal, result.stderr);
  }
  const ids = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= 256);
  return [...new Set(ids)].slice(0, MAX_DISCOVERED_MODELS);
}
