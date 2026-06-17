/**
 * Routing + metering through the api endpoint at the composition root
 * [CLM-0084, CLM-0085]: an overlay that points a tier at a registered endpoint
 * id makes `buildInvokeForNode` bind the kernel `invokeApiAdapter` for that
 * node, resolve the served concrete model + body effort, and meter the call's
 * reported cost into the run `totals` (so the budget guard enforces API spend).
 *
 * A REAL ephemeral localhost server stands in for the endpoint — no real
 * network. `http://127.0.0.1` is the SSRF guard's allowed local path.
 */
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OverlaySchema, type Overlay } from '../overlay.js';
import { buildInvokeForNode } from './index.js';

let server: Server;
let baseUrl = '';
const seen: Array<{ auth: string | undefined; body: Record<string, unknown> }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += String(c)));
    req.on('end', () => {
      seen.push({
        auth: req.headers.authorization,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'endpoint replied' } }],
          usage: { prompt_tokens: 40, completion_tokens: 60, cost: 0.012 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/v1`;
});

afterAll(() => server.close());

/** An overlay routing the `large` tier at a registered api endpoint id. */
function endpointOverlay(): Overlay {
  return OverlaySchema.parse({
    id: 'api-loop-test',
    adapters: { large: 'internal-provider' },
    endpoints: {
      'internal-provider': {
        baseUrl,
        apiKeyEnv: 'LOOP_TEST_KEY',
        models: { large: 'served-large-model' },
        metersUsd: true,
      },
    },
  });
}

describe('buildInvokeForNode — a tier routed to an api endpoint', () => {
  it('binds the endpoint as the served adapter and resolves the concrete model', () => {
    const totals = { tokens: 0, usd: 0 };
    const invokeFor = buildInvokeForNode('claude', endpointOverlay(), totals);
    // implement derives from the coder template (large tier) → routed to the endpoint.
    const served = invokeFor('implement').served;
    expect(served.adapter).toBe('internal-provider');
    expect(served.model).toBe('served-large-model');
    expect(served.servedTier).toBe('large');
  });

  it('invokes the endpoint (metered usage flows into the run totals)', async () => {
    seen.length = 0;
    const totals = { tokens: 0, usd: 0 };
    const invokeFor = buildInvokeForNode('claude', endpointOverlay(), totals);
    process.env['LOOP_TEST_KEY'] = 'sk-loop-secret-value';
    try {
      const seam = invokeFor('implement');
      const result = await seam.invoke('do the thing');
      expect(result.output).toBe('endpoint replied');
      // Metered into the run budget [CLM-0085]: 40 + 60 tokens, $0.012.
      expect(totals.tokens).toBe(100);
      expect(totals.usd).toBeCloseTo(0.012);
      // The endpoint saw the resolved model + an always-on max_tokens; the key
      // rode in the header (read from the env), never from config.
      expect(seen.at(-1)?.body['model']).toBe('served-large-model');
      expect(seen.at(-1)?.body['max_tokens']).toBeGreaterThan(0);
      expect(seen.at(-1)?.auth).toBe('Bearer sk-loop-secret-value');
    } finally {
      delete process.env['LOOP_TEST_KEY'];
    }
  });

  it('threads the per-model-call fitness hook (#66, CLM-0125) to the bound seam, fired with the served identity + cost', async () => {
    seen.length = 0;
    const calls: Array<{ family: string; success: boolean; usd: number }> = [];
    const totals = { tokens: 0, usd: 0 };
    // The composition root wires `fitness` into buildInvokeForNode → the seam.
    const invokeFor = buildInvokeForNode(
      'claude',
      endpointOverlay(),
      totals,
      undefined,
      undefined,
      {
        onModelCall: (id, success, cost) =>
          calls.push({ family: id.family, success, usd: cost.usd }),
      },
    );
    process.env['LOOP_TEST_KEY'] = 'sk-loop-secret-value';
    try {
      await invokeFor('implement').invoke('do the thing');
      // One per-model-call fitness event for the served identity on success.
      expect(calls).toHaveLength(1);
      expect(calls[0]?.success).toBe(true);
      expect(calls[0]?.usd).toBeCloseTo(0.012); // the metered call cost
      expect(typeof calls[0]?.family).toBe('string');
    } finally {
      delete process.env['LOOP_TEST_KEY'];
    }
  });

  it('fires the fitness hook with failure + ZERO cost when the endpoint call throws (key unset)', async () => {
    delete process.env['LOOP_TEST_KEY'];
    const calls: Array<{ success: boolean; usd: number }> = [];
    const totals = { tokens: 0, usd: 0 };
    const invokeFor = buildInvokeForNode(
      'claude',
      endpointOverlay(),
      totals,
      undefined,
      undefined,
      {
        onModelCall: (_id, success, cost) => calls.push({ success, usd: cost.usd }),
      },
    );
    // The call fails closed (ApiKeyMissingError) → the hook records a failure.
    await expect(invokeFor('implement').invoke('x')).rejects.toMatchObject({
      name: 'ApiKeyMissingError',
    });
    expect(calls).toEqual([{ success: false, usd: 0 }]);
  });

  it('fails closed (ApiKeyMissingError) when the endpoint key env var is unset', async () => {
    delete process.env['LOOP_TEST_KEY'];
    const totals = { tokens: 0, usd: 0 };
    const invokeFor = buildInvokeForNode('claude', endpointOverlay(), totals);
    await expect(invokeFor('implement').invoke('x')).rejects.toMatchObject({
      name: 'ApiKeyMissingError',
      apiKeyEnv: 'LOOP_TEST_KEY',
    });
    expect(totals.tokens).toBe(0);
  });
});
