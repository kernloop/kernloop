/**
 * The MCP-sampling model seam (#135): kernloop-as-MCP-server obtains completions
 * from its HOST via `sampling/createMessage`. These tests link a real MCP
 * client (a scripted "host" that declares the sampling capability and fulfils
 * createMessage) to a server over the SDK's in-memory transport — proving the
 * round-trip end to end with no external provider, exactly the architecture
 * kernloop runs under (`kernloop serve` + a model-providing host).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  CreateMessageRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  hostSupportsSampling,
  samplingInvoke,
  samplingPreferences,
  SamplingUnsupportedError,
} from './mcp-sampling.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) await c();
});

/** Link a kernloop-style server to a scripted host client over in-memory
 * transport. `host.sampling` enables the capability + scripts createMessage. */
async function linked(host: {
  sampling?: (prompt: string) => string;
}): Promise<{ server: Server }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new Server({ name: 'kernloop', version: '0' }, { capabilities: { tools: {} } });
  const client = new Client(
    { name: 'test-host', version: '0' },
    { capabilities: host.sampling === undefined ? {} : { sampling: {} } },
  );
  const reply = host.sampling;
  if (reply !== undefined) {
    client.setRequestHandler(CreateMessageRequestSchema, (req) => {
      const first = req.params.messages[0]?.content;
      const prompt = first?.type === 'text' ? first.text : '';
      return {
        role: 'assistant',
        content: { type: 'text', text: reply(prompt) },
        model: 'host-model',
      };
    });
  }
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanup.push(async () => {
    await client.close();
    await server.close();
  });
  return { server };
}

describe('hostSupportsSampling', () => {
  it('is true when the connected host declared the sampling capability', async () => {
    const { server } = await linked({ sampling: () => 'ok' });
    expect(hostSupportsSampling(server)).toBe(true);
  });

  it('is false when the host declared no sampling capability', async () => {
    const { server } = await linked({});
    expect(hostSupportsSampling(server)).toBe(false);
  });
});

describe('samplingInvoke', () => {
  it('routes the prompt UP to the host and returns the host completion (honest zero cost)', async () => {
    const { server } = await linked({ sampling: (p) => `echo:${p}` });
    const invoke = samplingInvoke(server);
    const result = await invoke('write the plan');
    expect(result.output).toBe('echo:write the plan');
    expect(result.cost).toEqual({ tokens: 0, usd: 0 }); // the host owns usage
  });

  it('passes the per-node model alias as an advisory preference hint', async () => {
    let seenHint: string | undefined;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new Server({ name: 'k', version: '0' }, { capabilities: { tools: {} } });
    const client = new Client({ name: 'h', version: '0' }, { capabilities: { sampling: {} } });
    client.setRequestHandler(CreateMessageRequestSchema, (req) => {
      seenHint = req.params.modelPreferences?.hints?.[0]?.name;
      return { role: 'assistant', content: { type: 'text', text: 'done' }, model: 'm' };
    });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });
    await samplingInvoke(server)('go', { model: 'opus' });
    expect(seenHint).toBe('opus');
  });

  it('maps the per-node tier to MCP cost/speed/intelligence priorities so the host routes high/med/low', async () => {
    let seen: Record<string, unknown> | undefined;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new Server({ name: 'k', version: '0' }, { capabilities: { tools: {} } });
    const client = new Client({ name: 'h', version: '0' }, { capabilities: { sampling: {} } });
    client.setRequestHandler(CreateMessageRequestSchema, (req) => {
      seen = req.params.modelPreferences as Record<string, unknown> | undefined;
      return { role: 'assistant', content: { type: 'text', text: 'ok' }, model: 'm' };
    });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });
    // A judgment node (frontier) asks for maximum intelligence; the alias still
    // rides as an advisory hint — the host picks the actual high-tier model.
    await samplingInvoke(server)('vote on the plan', { tier: 'frontier', model: 'opus' });
    expect(seen?.intelligencePriority).toBe(1);
    expect(seen?.speedPriority).toBe(0);
    expect(seen?.costPriority).toBe(0);
    expect((seen?.hints as Array<{ name: string }>)?.[0]?.name).toBe('opus');

    // A cheap node (small) asks for speed/cost — the host routes a low-tier model.
    await samplingInvoke(server)('a trivial step', { tier: 'small' });
    expect(seen?.intelligencePriority).toBe(0.2);
    expect(seen?.speedPriority).toBe(0.9);
    expect(seen?.costPriority).toBe(0.9);
  });

  it('throws SamplingUnsupportedError when the host cannot sample (no silent fallback)', async () => {
    const { server } = await linked({});
    await expect(samplingInvoke(server)('go')).rejects.toBeInstanceOf(SamplingUnsupportedError);
  });
});

describe('samplingPreferences (tier → MCP modelPreferences)', () => {
  it('orders intelligence monotonically down the tier ladder', () => {
    const intel = (t: 'frontier' | 'large' | 'medium' | 'small') =>
      samplingPreferences(t, undefined)?.intelligencePriority ?? -1;
    expect(intel('frontier')).toBeGreaterThan(intel('large'));
    expect(intel('large')).toBeGreaterThan(intel('medium'));
    expect(intel('medium')).toBeGreaterThan(intel('small'));
  });

  it('is undefined when neither tier nor hint is set (a bare call sends no preference)', () => {
    expect(samplingPreferences(undefined, undefined)).toBeUndefined();
  });

  it('carries the alias hint even with no tier (back-compat with the alias-only path)', () => {
    expect(samplingPreferences(undefined, 'opus')).toEqual({ hints: [{ name: 'opus' }] });
  });
});

describe('sampling DURING a tool call (the production nesting)', () => {
  it('a tool handler can call back to the host via sampling while its callTool is pending', async () => {
    // The live architecture: a host calls the `run` tool; kernloop's handler runs
    // the loop, which samples BACK to the host mid-handler. This proves the MCP
    // SDK dispatches the server→client sampling request while the client→server
    // callTool is still in flight (no deadlock) — the protocol-level de-risk.
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new Server({ name: 'kernloop', version: '0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        { name: 'loop', description: 'samples mid-handler', inputSchema: { type: 'object' } },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async () => {
      // Two sequential sampling calls, exactly as multiple loop nodes would.
      const a = await samplingInvoke(server)('node-1 prompt');
      const b = await samplingInvoke(server)('node-2 prompt');
      return { content: [{ type: 'text', text: `${a.output}|${b.output}` }] };
    });
    const client = new Client({ name: 'host', version: '0' }, { capabilities: { sampling: {} } });
    client.setRequestHandler(CreateMessageRequestSchema, (req) => {
      const first = req.params.messages[0]?.content;
      const prompt = first?.type === 'text' ? first.text : '';
      return { role: 'assistant', content: { type: 'text', text: `host(${prompt})` }, model: 'm' };
    });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    cleanup.push(async () => {
      await client.close();
      await server.close();
    });
    const res = (await client.callTool({ name: 'loop', arguments: {} })) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(res.content[0]?.text).toBe('host(node-1 prompt)|host(node-2 prompt)');
  });
});
