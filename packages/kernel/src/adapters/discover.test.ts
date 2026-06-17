/**
 * Acceptance tests for model DISCOVERY [CLM-0086] — `discoverApiModels`
 * (`GET /v1/models`) and `discoverOllamaModels` (`GET /api/tags`).
 *
 * A REAL ephemeral localhost HTTP server stands in for both an OpenAI-compatible
 * endpoint AND an ollama daemon — no real network, no real provider, ever.
 * `http://127.0.0.1` is the documented local path the SSRF guard allows. The
 * server records the request (path + Authorization header) so we can assert the
 * FIXED path is hit and the bearer key is sent.
 *
 * The load-bearing security test is the SAME shape as the model-call path's: the
 * key NEVER leaks. A fake key is set; a hostile discovery endpoint echoes the
 * Authorization header back in its error body; we assert the key string appears
 * in NO error message, surfaced body, or thrown-object surface.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverApiModels, discoverOllamaModels } from './discover.js';
import type { ApiAdapterDefinition } from './api-config.js';
import {
  AdapterExecutionError,
  AdapterOutputError,
  ApiEndpointError,
  ApiKeyMissingError,
} from './errors.js';

/** One recorded request the mock server saw. */
interface Recorded {
  authorization: string | undefined;
  url: string | undefined;
}

/** The mock server's per-request behavior, swappable between tests. */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let origin = '';
let handler: Handler;
const recorded: Recorded[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      recorded.push({ authorization: req.headers.authorization, url: req.url });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(() => {
  server.close();
});

/** A definition pointing the api discovery at the mock `/v1` base. */
function def(overrides: Partial<ApiAdapterDefinition> = {}): ApiAdapterDefinition {
  return {
    name: 'mock-endpoint',
    kind: 'api',
    baseUrl: `${origin}/v1`,
    apiKeyEnv: 'TEST_API_KEY',
    tierBinding: { frontier: 'mock-model' },
    capabilities: ['toolUse'],
    metersUsd: false,
    ...overrides,
  };
}

/** A standard OpenAI `GET /v1/models` listing body. */
function modelsBody(ids: string[]): string {
  return JSON.stringify({
    object: 'list',
    data: ids.map((id) => ({ id, object: 'model', created: 1, owned_by: 'org' })),
  });
}

/** A standard ollama `GET /api/tags` listing body. */
function tagsBody(names: string[]): string {
  return JSON.stringify({
    models: names.map((name) => ({ name, model: name, size: 1, details: { family: 'x' } })),
  });
}

describe('discoverApiModels — enumerates /v1/models', () => {
  it('GETs the fixed /v1/models path with the bearer key and returns the listed ids', async () => {
    recorded.length = 0;
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(modelsBody(['anthropic/claude-opus-4', 'openai/gpt-5.5-mini']));
    };
    const ids = await discoverApiModels(def(), { TEST_API_KEY: 'sk-test-123' });
    expect(ids).toEqual(['anthropic/claude-opus-4', 'openai/gpt-5.5-mini']);
    expect(recorded.at(-1)?.url).toBe('/v1/models');
    expect(recorded.at(-1)?.authorization).toBe('Bearer sk-test-123');
  });

  it('de-duplicates ids and drops an empty id (never a fabricated model)', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(modelsBody(['a/b-1', 'a/b-1', '']));
    };
    expect(await discoverApiModels(def(), { TEST_API_KEY: 'k' })).toEqual(['a/b-1']);
  });

  it('an empty data array yields an empty list, not an error', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [] }));
    };
    expect(await discoverApiModels(def(), { TEST_API_KEY: 'k' })).toEqual([]);
  });

  it('caps a pathological listing at the count limit (#266) — never an unbounded set', async () => {
    // 5001 unique ids (well under the 4 MiB byte cap) → returned set is bounded.
    const ids = Array.from({ length: 5_001 }, (_v, i) => `vendor/model-${String(i)}`);
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(modelsBody(ids));
    };
    const got = await discoverApiModels(def(), { TEST_API_KEY: 'k' });
    expect(got).toHaveLength(5_000); // MAX_DISCOVERED_MODELS, symmetric with the CLI path
    expect(got[0]).toBe('vendor/model-0'); // order-preserving prefix, not a guess
  });

  it('fails closed (ApiKeyMissingError) when the key env var is unset, BEFORE any egress', async () => {
    recorded.length = 0;
    const error = await discoverApiModels(def(), {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiKeyMissingError);
    expect((error as ApiKeyMissingError).apiKeyEnv).toBe('TEST_API_KEY');
    expect(recorded).toHaveLength(0); // no network call was made
  });

  it('a non-2xx is a typed AdapterExecutionError carrying the status, never a guess', async () => {
    handler = (_req, res) => {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unavailable' }));
    };
    const error = await discoverApiModels(def(), { TEST_API_KEY: 'k' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect((error as AdapterExecutionError).exitCode).toBe(503);
  });

  it('a malformed 2xx body is a typed AdapterOutputError, never a crash', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('<<not json>>');
    };
    const error = await discoverApiModels(def(), { TEST_API_KEY: 'k' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterOutputError);
  });

  it('refuses a non-https non-local baseUrl before any network call (reuses the SSRF guard)', async () => {
    const error = await discoverApiModels(def({ baseUrl: 'http://example.com/v1' }), {
      TEST_API_KEY: 'k',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiEndpointError);
  });

  it('a 2xx body of the WRONG shape is a typed AdapterOutputError (defensive zod)', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 42 }] })); // id must be a string
    };
    const error = await discoverApiModels(def(), { TEST_API_KEY: 'k' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterOutputError);
  });

  it('an unreachable endpoint is a typed AdapterExecutionError, never a guess', async () => {
    // Port 1 on loopback refuses immediately — a real network failure, no guess.
    const error = await discoverApiModels(def({ baseUrl: 'http://127.0.0.1:1/v1' }), {
      TEST_API_KEY: 'k',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterExecutionError);
  });
});

describe('discoverApiModels — the key NEVER leaks (load-bearing discovery security test)', () => {
  const KEY = 'sk-or-DISCOVER-LEAKME-0123456789abcdef';

  /** Assert the key appears in NO part of a thrown error surface. */
  function assertNoLeak(surface: unknown): void {
    const haystack = JSON.stringify(surface, Object.getOwnPropertyNames(surface ?? {}));
    expect(haystack).not.toContain(KEY);
    if (surface instanceof Error) expect(surface.message).not.toContain(KEY);
    expect(String(surface)).not.toContain(KEY);
  }

  it('does not leak the key through a non-2xx error body that echoes the header', async () => {
    handler = (req, res) => {
      // A hostile discovery endpoint echoes the Authorization header in its error.
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `bad key: ${req.headers.authorization ?? ''}` }));
    };
    const error = await discoverApiModels(def(), { TEST_API_KEY: KEY }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect((error as AdapterExecutionError).exitCode).toBe(401);
    assertNoLeak(error);
  });

  it('does not leak the key through a malformed body that echoes the header', async () => {
    handler = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      // Adversarial test mock: a hostile endpoint that deliberately echoes the
      // Authorization header in a malformed body, to prove discovery scrubs the
      // key. Not production HTML — suppress the express-injection false positive.
      res.end(`<<not json>> ${req.headers.authorization ?? ''}`); // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format
    };
    const error = await discoverApiModels(def(), { TEST_API_KEY: KEY }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterOutputError);
    assertNoLeak(error);
  });
});

describe('discoverOllamaModels — enumerates /api/tags (local, no secret)', () => {
  it('GETs /api/tags WITHOUT an Authorization header and returns the tag names', async () => {
    recorded.length = 0;
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(tagsBody(['llama3.1:8b', 'qwen2:7b']));
    };
    const names = await discoverOllamaModels(origin);
    expect(names).toEqual(['llama3.1:8b', 'qwen2:7b']);
    expect(recorded.at(-1)?.url).toBe('/api/tags');
    expect(recorded.at(-1)?.authorization).toBeUndefined(); // local, no secret
  });

  it('a missing models array yields an empty list (honest, not an error)', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({}));
    };
    expect(await discoverOllamaModels(origin)).toEqual([]);
  });

  it('a non-2xx ollama response is a typed AdapterExecutionError, never a guess', async () => {
    handler = (_req, res) => {
      res.writeHead(500);
      res.end('boom');
    };
    const error = await discoverOllamaModels(origin).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterExecutionError);
  });
});
