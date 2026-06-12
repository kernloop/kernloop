/**
 * Security-review acceptance tests for the OpenAI-compatible HTTP adapter
 * [CLM-0083..0085] — the hardening from the mandatory phase-C review:
 *  - H1: a kernel-controlled `authorization` header always wins (written last).
 *  - H2: `metersUsd` fails CLOSED when a 2xx reports no cost (prime directive),
 *    and meters honestly when a cost is reported.
 *  - M2: a response body over the cap is rejected via a STREAMED read (no OOM).
 *  - L3: the wall-clock budget spans the BODY read (a slow body trips it).
 *  - CLM-0084: the fixed `/chat/completions` path is used and a 3xx redirect is
 *    refused (no second request to the redirect target).
 *
 * A REAL ephemeral localhost server stands in for the endpoint — no real
 * network, no real provider. `http://127.0.0.1` is the SSRF guard's local path.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invokeApiAdapter, MAX_RESPONSE_BYTES } from './api.js';
import type { ApiAdapterDefinition } from './api-config.js';
import { AdapterExecutionError, AdapterOutputError, AdapterTimeoutError } from './errors.js';

/** One recorded request the mock server saw. */
interface Recorded {
  authorization: string | undefined;
  url: string | undefined;
}

/** The mock server's per-request behavior, swappable between tests. */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let baseUrl = '';
let handler: Handler;
const recorded: Recorded[] = [];

/** A standard OpenAI-compatible success body with optional usage. */
function okBody(content: string, usage?: Record<string, number>): string {
  return JSON.stringify({
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    ...(usage === undefined ? {} : { usage }),
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      recorded.push({ authorization: req.headers.authorization, url: req.url });
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/v1`;
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

describe('invokeApiAdapter — metersUsd fails closed on a missing cost (prime directive)', () => {
  it('fails closed when metersUsd is declared but the 2xx body reports no cost', async () => {
    // Real money may have been spent; metering $0 here would be a lie. The
    // endpoint declared it meters cost, so a cost-less 2xx is a typed refusal.
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody('no cost reported', { prompt_tokens: 10, completion_tokens: 5 }));
    };
    const error = await invokeApiAdapter(def({ metersUsd: true }), {
      ...baseInvocation,
      env: { TEST_API_KEY: 'k' },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterOutputError);
    expect((error as Error).message).toContain('no usable output');
    expect((error as AdapterOutputError).stderr).toContain('metersUsd');
  });

  it('meters usd when metersUsd is declared and a cost is reported', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody('priced', { prompt_tokens: 2, completion_tokens: 3, cost: 0.04 }));
    };
    const result = await invokeApiAdapter(def({ metersUsd: true, maxUsdPerCall: 0.5 }), {
      ...baseInvocation,
      env: { TEST_API_KEY: 'k' },
    });
    expect(result.cost.usd).toBeCloseTo(0.04);
    expect(result.metered.usd).toBe(true);
  });
});

describe('invokeApiAdapter — the kernel auth header always wins (H1)', () => {
  it('the kernel authorization header wins even if a header of that name is forced onto the def', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody('ok'));
    };
    recorded.length = 0;
    // Even if a hostile/buggy def carries an `authorization` header (config
    // parse rejects it, but the adapter must be robust regardless), the
    // kernel-written Bearer key — appended LAST — is the one the endpoint sees.
    const forced = def({
      headers: { authorization: 'Bearer ATTACKER', 'x-tenant': 'acme' } as Record<string, string>,
    });
    await invokeApiAdapter(forced, { ...baseInvocation, env: { TEST_API_KEY: 'real-key' } });
    expect(recorded.at(-1)?.authorization).toBe('Bearer real-key');
  });
});

describe('invokeApiAdapter — fixed path, refused redirects, streamed cap, slow-body timeout', () => {
  it('POSTs to exactly the fixed /chat/completions path appended to the configured base', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody('ok'));
    };
    recorded.length = 0;
    await invokeApiAdapter(def(), { ...baseInvocation, env: { TEST_API_KEY: 'k' } });
    // The base path is `/v1`; the fixed CHAT_PATH is appended, never templated.
    expect(recorded.at(-1)?.url).toBe('/v1/chat/completions');
  });

  it('REFUSES a 3xx redirect and makes no second request to the redirect target', async () => {
    let hits = 0;
    handler = (_req, res) => {
      hits += 1;
      if (hits === 1) {
        // First (and only legitimate) request: reply with a redirect to /evil.
        res.writeHead(302, { location: `${baseUrl}/evil/chat/completions` });
        res.end();
        return;
      }
      // A SECOND request would mean the adapter followed the redirect — fail.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(okBody('followed the redirect'));
    };
    const error = await invokeApiAdapter(def(), {
      ...baseInvocation,
      env: { TEST_API_KEY: 'k' },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterExecutionError);
    // redirect: 'error' refuses the 3xx; the target endpoint was never re-hit.
    expect(hits).toBe(1);
  });

  it('rejects a response body over the size cap (streamed, no OOM)', async () => {
    // Hand the client a body larger than the cap. The adapter reads via the
    // stream and aborts the moment the running total crosses MAX_RESPONSE_BYTES,
    // so it never buffers the whole body — a typed error, not an OOM or hang.
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('a'.repeat(MAX_RESPONSE_BYTES + 256 * 1024));
    };
    const error = await invokeApiAdapter(def(), {
      ...baseInvocation,
      timeoutMs: 5_000,
      env: { TEST_API_KEY: 'k' },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterOutputError);
    expect((error as AdapterOutputError).stderr).toContain('cap');
  });

  it('aborts and throws AdapterTimeoutError when the response BODY is too slow', async () => {
    // Headers arrive promptly; the BODY trickles forever. The single
    // AbortController budget spans the body read, so the slow body trips it.
    handler = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"choices":[{"message":{"content":"');
      // Never finish the body within the budget; stop on client abort so the
      // server does not write to a destroyed socket after the timeout fires.
      const trickle = setInterval(() => res.write('x'), 10);
      trickle.unref();
      req.on('close', () => clearInterval(trickle));
    };
    await expect(
      invokeApiAdapter(def(), {
        ...baseInvocation,
        timeoutMs: 80,
        env: { TEST_API_KEY: 'k' },
      }),
    ).rejects.toBeInstanceOf(AdapterTimeoutError);
  });
});
