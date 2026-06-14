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
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { hostSupportsSampling, samplingInvoke, SamplingUnsupportedError } from './mcp-sampling.js';

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

  it('throws SamplingUnsupportedError when the host cannot sample (no silent fallback)', async () => {
    const { server } = await linked({});
    await expect(samplingInvoke(server)('go')).rejects.toBeInstanceOf(SamplingUnsupportedError);
  });
});
