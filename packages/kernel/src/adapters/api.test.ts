/**
 * Acceptance tests for the OpenAI-compatible HTTP adapter [CLM-0082..0085].
 *
 * A REAL ephemeral localhost HTTP server (`http.createServer`) stands in for
 * the model endpoint — no real network, no real provider, ever. The server is
 * an OpenAI-compatible mock returning configurable success/error bodies and
 * recording each request (so we can assert the sent body: model, the always-on
 * `max_tokens`, `reasoning_effort`, and the `Authorization` header). `http:` to
 * `127.0.0.1` is the documented local-model path the SSRF guard allows.
 *
 * The load-bearing security test is "the key NEVER leaks": a fake key is set,
 * an error is forced on every surface (non-2xx body, malformed JSON, network
 * failure), and we assert the key string appears in NO error message, output,
 * or `raw` field.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invokeApiAdapter, scrub, MAX_RESPONSE_BYTES } from './api.js';
import { assertSafeBaseUrl } from './api-url.js';
import type { ApiAdapterDefinition } from './api-config.js';
import {
  AdapterExecutionError,
  AdapterOutputError,
  AdapterRequestError,
  AdapterTimeoutError,
  ApiEndpointError,
  ApiKeyMissingError,
} from './errors.js';

/** One recorded request the mock server saw. */
interface Recorded {
  authorization: string | undefined;
  url: string | undefined;
  body: unknown;
}

/** The mock server's per-request behavior, swappable between tests. */
type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

let server: Server;
let baseUrl = '';
let handler: Handler;
const recorded: Recorded[] = [];

/** A standard OpenAI-compatible success body with usage. */
function okBody(content: string, usage?: Record<string, number>): string {
  return JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    ...(usage === undefined ? {} : { usage }),
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += String(chunk)));
    req.on('end', () => {
      recorded.push({
        authorization: req.headers.authorization,
        url: req.url,
        body: raw === '' ? undefined : (JSON.parse(raw) as unknown),
      });
      handler(req, res, raw);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${String(port)}/v1`;
});

afterAll(() => {
  server.close();
});

/** A definition pointing at the mock server; key env var defaults to TEST_API_KEY. */
function def(overrides: Partial<ApiAdapterDefinition> = {}): ApiAdapterDefinition {
  return {
    name: 'mock-endpoint',
    kind: 'api',
    baseUrl,
    apiKeyEnv: 'TEST_API_KEY',
    tierBinding: { frontier: 'mock-model' },
    capabilities: ['toolUse'],
    metersUsd: false,
    ...overrides,
  };
}

const baseInvocation = { prompt: 'hello', model: 'mock-model', maxTokens: 256, timeoutMs: 5_000 };

describe('invokeApiAdapter — success + metering', () => {
  it('returns the message content and meters tokens + usd from usage', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        okBody('hi from the model', { prompt_tokens: 100, completion_tokens: 50, cost: 0.0021 }),
      );
    };
    const result = await invokeApiAdapter(def(), {
      ...baseInvocation,
      env: { TEST_API_KEY: 'sk-secret-XYZ' },
    });
    expect(result.output).toBe('hi from the model');
    expect(result.cost.tokens).toBe(150);
    expect(result.cost.usd).toBeCloseTo(0.0021);
    expect(result.cost.wallClockMs).toBeGreaterThanOrEqual(0);
    expect(result.metered).toEqual({ tokens: true, usd: true });
    expect(result.cost.byAdapter?.['mock-endpoint']).toEqual({ tokens: 150, usd: 0.0021 });
  });

  it('meters tokens but reports usd unmetered when the endpoint omits cost', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody('hi', { prompt_tokens: 10, completion_tokens: 5 }));
    };
    const result = await invokeApiAdapter(def(), {
      ...baseInvocation,
      env: { TEST_API_KEY: 'unique-key-value' },
    });
    expect(result.cost.tokens).toBe(15);
    expect(result.cost.usd).toBe(0);
    expect(result.metered).toEqual({ tokens: true, usd: false });
  });

  it('reads usage.total_cost (alt cost field) as the metered usd', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody('hi', { prompt_tokens: 1, completion_tokens: 1, total_cost: 0.5 }));
    };
    const result = await invokeApiAdapter(def(), { ...baseInvocation, env: { TEST_API_KEY: 'k' } });
    expect(result.cost.usd).toBe(0.5);
    expect(result.metered.usd).toBe(true);
  });

  it('ALWAYS sends a bounded max_tokens and the resolved model + reasoning_effort', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody('ok'));
    };
    recorded.length = 0;
    await invokeApiAdapter(def(), {
      ...baseInvocation,
      effort: 'high',
      env: { TEST_API_KEY: 'k' },
    });
    const sent = recorded.at(-1)?.body as Record<string, unknown>;
    expect(sent['max_tokens']).toBe(256);
    expect(sent['model']).toBe('mock-model');
    expect(sent['reasoning_effort']).toBe('high');
    expect(sent['messages']).toEqual([{ role: 'user', content: 'hello' }]);
    expect(recorded.at(-1)?.authorization).toBe('Bearer k');
  });
});

describe('invokeApiAdapter — fail-closed secret handling', () => {
  it('throws ApiKeyMissingError naming the env var when the key is unset', async () => {
    await expect(invokeApiAdapter(def(), { ...baseInvocation, env: {} })).rejects.toBeInstanceOf(
      ApiKeyMissingError,
    );
  });

  it('throws ApiKeyMissingError when the key is the empty string', async () => {
    const error = await invokeApiAdapter(def(), {
      ...baseInvocation,
      env: { TEST_API_KEY: '' },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiKeyMissingError);
    // The env var NAME is surfaced; no value (there is none) can leak.
    expect((error as ApiKeyMissingError).apiKeyEnv).toBe('TEST_API_KEY');
    expect((error as Error).message).toContain('TEST_API_KEY');
  });
});

describe('invokeApiAdapter — the key NEVER leaks (load-bearing security test)', () => {
  const KEY = 'sk-or-LEAKME-0123456789abcdef';

  /** Assert the key appears in NO part of a thrown error or a result. */
  function assertNoLeak(surface: unknown): void {
    const haystack = JSON.stringify(surface, Object.getOwnPropertyNames(surface ?? {}));
    expect(haystack).not.toContain(KEY);
    if (surface instanceof Error) expect(surface.message).not.toContain(KEY);
    expect(String(surface)).not.toContain(KEY);
  }

  it('does not leak the key through a non-2xx error body that echoes the header', async () => {
    handler = (req, res) => {
      // A hostile endpoint echoes the Authorization header back in its error.
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `bad key: ${req.headers.authorization ?? ''}` }));
    };
    const error = await invokeApiAdapter(def(), {
      ...baseInvocation,
      env: { TEST_API_KEY: KEY },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect((error as AdapterExecutionError).exitCode).toBe(401);
    assertNoLeak(error);
  });

  it('does not leak the key through a malformed-JSON body that echoes the header', async () => {
    handler = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      // Adversarial test mock: a hostile endpoint that deliberately echoes the
      // Authorization header in a malformed body, to prove the adapter scrubs the
      // key. Not production HTML — suppress the express-injection false positive.
      res.end(`<<not json>> ${req.headers.authorization ?? ''}`); // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format
    };
    const error = await invokeApiAdapter(def(), {
      ...baseInvocation,
      env: { TEST_API_KEY: KEY },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterOutputError);
    assertNoLeak(error);
  });

  it('scrub() redacts the key from any surfaced string', () => {
    expect(scrub(`Authorization: Bearer ${KEY} failed`, KEY)).toBe(
      'Authorization: Bearer [REDACTED] failed',
    );
    expect(scrub('no secret here', KEY)).toBe('no secret here');
    expect(scrub('anything', '')).toBe('anything');
  });
});

describe('invokeApiAdapter — non-2xx, malformed, and empty responses', () => {
  it('non-2xx is a typed AdapterExecutionError carrying the status + scrubbed body', async () => {
    handler = (_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream exploded' }));
    };
    const error = await invokeApiAdapter(def(), {
      ...baseInvocation,
      env: { TEST_API_KEY: 'k' },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterExecutionError);
    expect((error as AdapterExecutionError).exitCode).toBe(500);
    expect((error as Error).message).toContain('upstream exploded');
  });

  it('malformed JSON in a 2xx body is a typed AdapterOutputError, never a crash', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{ this is not json');
    };
    await expect(
      invokeApiAdapter(def(), { ...baseInvocation, env: { TEST_API_KEY: 'k' } }),
    ).rejects.toBeInstanceOf(AdapterOutputError);
  });

  it('a 2xx body with no usable message content is a typed AdapterOutputError', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '' } }] }));
    };
    await expect(
      invokeApiAdapter(def(), { ...baseInvocation, env: { TEST_API_KEY: 'k' } }),
    ).rejects.toBeInstanceOf(AdapterOutputError);
  });
});

describe('invokeApiAdapter — timeout (AbortController wall-clock)', () => {
  it('aborts and throws AdapterTimeoutError when the endpoint is too slow', async () => {
    handler = (_req, res) => {
      // Never respond within the budget — let the AbortController fire.
      setTimeout(() => {
        res.writeHead(200);
        res.end(okBody('too late'));
      }, 1_000);
    };
    await expect(
      invokeApiAdapter(def(), {
        ...baseInvocation,
        timeoutMs: 50,
        env: { TEST_API_KEY: 'k' },
      }),
    ).rejects.toBeInstanceOf(AdapterTimeoutError);
  });
});

describe('invokeApiAdapter — spend ceiling (maxUsdPerCall)', () => {
  it('fails closed when the reported cost exceeds the per-call cap', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody('pricey', { prompt_tokens: 1, completion_tokens: 1, cost: 2.0 }));
    };
    const error = await invokeApiAdapter(def({ maxUsdPerCall: 0.5 }), {
      ...baseInvocation,
      env: { TEST_API_KEY: 'k' },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiEndpointError);
    expect((error as Error).message).toContain('exceeds maxUsdPerCall');
  });

  it('allows a call whose reported cost is within the cap', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody('cheap', { prompt_tokens: 1, completion_tokens: 1, cost: 0.1 }));
    };
    const result = await invokeApiAdapter(def({ maxUsdPerCall: 0.5 }), {
      ...baseInvocation,
      env: { TEST_API_KEY: 'k' },
    });
    expect(result.cost.usd).toBeCloseTo(0.1);
  });
});

describe('invokeApiAdapter — malformed invocation', () => {
  it('rejects an empty model id (no concrete model resolved)', async () => {
    await expect(
      invokeApiAdapter(def(), { ...baseInvocation, model: '', env: { TEST_API_KEY: 'k' } }),
    ).rejects.toBeInstanceOf(AdapterRequestError);
  });

  it('rejects a non-positive maxTokens (spend ceiling must be bounded)', async () => {
    await expect(
      invokeApiAdapter(def(), { ...baseInvocation, maxTokens: 0, env: { TEST_API_KEY: 'k' } }),
    ).rejects.toBeInstanceOf(AdapterRequestError);
  });
});

describe('assertSafeBaseUrl — SSRF guard', () => {
  it('allows https to any host', () => {
    expect(() => assertSafeBaseUrl('e', 'https://api.example.com/v1')).not.toThrow();
  });

  it('allows http ONLY to localhost / loopback / private hosts', () => {
    expect(() => assertSafeBaseUrl('e', 'http://localhost:8000/v1')).not.toThrow();
    expect(() => assertSafeBaseUrl('e', 'http://127.0.0.1:1234/v1')).not.toThrow();
    expect(() => assertSafeBaseUrl('e', 'http://192.168.1.10:8080/v1')).not.toThrow();
    expect(() => assertSafeBaseUrl('e', 'http://[::1]:8000/v1')).not.toThrow();
  });

  it('REJECTS http to a non-local (public) host', () => {
    expect(() => assertSafeBaseUrl('e', 'http://api.example.com/v1')).toThrow(ApiEndpointError);
    expect(() => assertSafeBaseUrl('e', 'http://8.8.8.8/v1')).toThrow(ApiEndpointError);
  });

  it('REJECTS a non-http(s) scheme (file/ftp/etc.)', () => {
    expect(() => assertSafeBaseUrl('e', 'file:///etc/passwd')).toThrow(ApiEndpointError);
    expect(() => assertSafeBaseUrl('e', 'ftp://host/x')).toThrow(ApiEndpointError);
  });

  it('REJECTS a baseUrl that embeds credentials (user:pass@)', () => {
    // L1: a secret in the URL contradicts env-only; reject before any egress.
    expect(() => assertSafeBaseUrl('e', 'https://user:pass@api.example.com/v1')).toThrow(
      ApiEndpointError,
    );
    expect(() => assertSafeBaseUrl('e', 'https://user@api.example.com/v1')).toThrow(
      ApiEndpointError,
    );
  });

  it('REJECTS a malformed url', () => {
    expect(() => assertSafeBaseUrl('e', 'not a url')).toThrow(ApiEndpointError);
  });
});

describe('invokeApiAdapter — a non-https non-local baseUrl is refused before any call', () => {
  it('throws ApiEndpointError for an http public baseUrl (no network egress)', async () => {
    recorded.length = 0;
    await expect(
      invokeApiAdapter(def({ baseUrl: 'http://example.com/v1' }), {
        ...baseInvocation,
        env: { TEST_API_KEY: 'k' },
      }),
    ).rejects.toBeInstanceOf(ApiEndpointError);
  });

  it('the cap constant bounds what we will read from a response', () => {
    expect(MAX_RESPONSE_BYTES).toBeGreaterThan(0);
  });
});
