/**
 * MCP surface tests [CLM-0033]: the server exposes EXACTLY the nine P1
 * kernel tools — enumerated through a real client over a linked transport
 * pair — and tool calls are zod-validated end to end.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernloop, type Kernloop } from './kernel.js';
import { createMcpServer } from './mcp.js';
import { P1_TOOL_NAMES } from './tools/index.js';

const dirs: string[] = [];
function freshKernloop(): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-mcp-'));
  dirs.push(repo);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop') });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connectedClient(
  kern: Kernloop,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createMcpServer(kern);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Parse the JSON text content block out of an MCP tool result. */
function parseResult(result: { content?: unknown }): unknown {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]?.text ?? 'null');
}

describe('MCP server surface', () => {
  it('exposes exactly nine kernel tools: run, status, brief, gate, recall, remember, manifest, audit, observe — and nothing else', async () => {
    const kern = freshKernloop();
    const { client, close } = await connectedClient(kern);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual([...P1_TOOL_NAMES].sort());
    expect(names).toHaveLength(9);
    // distill and forge are P3 — absent, not stubbed
    expect(names).not.toContain('distill');
    expect(names).not.toContain('forge');
    await close();
    kern.close();
  });

  it('advertises a JSON Schema for every tool input', async () => {
    const kern = freshKernloop();
    const { client, close } = await connectedClient(kern);
    for (const tool of (await client.listTools()).tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
      expect(tool.description?.length ?? 0).toBeGreaterThan(0);
    }
    await close();
    kern.close();
  });

  it('round-trips remember → recall through real tool calls', async () => {
    const kern = freshKernloop();
    const { client, close } = await connectedClient(kern);
    await client.callTool({
      name: 'remember',
      arguments: { fact: 'mcp surface is nine tools', provenance: 'CLM-0033' },
    });
    const recalled = parseResult(
      await client.callTool({ name: 'recall', arguments: { query: 'mcp surface' } }),
    ) as { facts: Array<{ provenance: string }> };
    expect(recalled.facts).toHaveLength(1);
    expect(recalled.facts[0]?.provenance).toBe('CLM-0033');
    await close();
    kern.close();
  });

  it('serves every read-side tool over MCP: status, manifest, audit, observe, brief, run plan-only', async () => {
    const kern = freshKernloop();
    const { client, close } = await connectedClient(kern);
    const status = parseResult(
      await client.callTool({ name: 'status', arguments: { taskId: 'never-ran' } }),
    );
    expect(status).toEqual({ found: false, taskId: 'never-ran' });
    const manifests = parseResult(
      await client.callTool({ name: 'manifest', arguments: { op: 'list' } }),
    ) as { manifests: unknown[] };
    expect(manifests.manifests).toHaveLength(5);
    const audit = parseResult(
      await client.callTool({ name: 'audit', arguments: { op: 'verify' } }),
    ) as { result: { ok: boolean } };
    expect(audit.result.ok).toBe(true);
    const observed = parseResult(await client.callTool({ name: 'observe', arguments: {} })) as {
      audit: { verified: boolean };
    };
    expect(observed.audit.verified).toBe(true);
    const brief = parseResult(
      await client.callTool({ name: 'brief', arguments: { goal: 'brief over mcp' } }),
    ) as { compilerVersion: string };
    expect(brief.compilerVersion).toBe('0.1.0');
    const plan = parseResult(
      await client.callTool({
        name: 'run',
        arguments: { goal: 'plan over mcp', capability: 'gate.quality', execute: false },
      }),
    ) as { kind: string };
    expect(plan.kind).toBe('routing');
    const gate = await client.callTool({
      name: 'gate',
      arguments: { gateName: 'vote', taskId: 't', workspaceDir: kern.paths.repoRoot },
    });
    expect(gate.isError).toBe(true);
    await close();
    kern.close();
  });

  it('reports zod validation failures as typed MCP error results', async () => {
    const kern = freshKernloop();
    const { client, close } = await connectedClient(kern);
    const result = await client.callTool({
      name: 'remember',
      arguments: { fact: 'no provenance' },
    });
    expect(result.isError).toBe(true);
    await close();
    kern.close();
  });

  it('rejects a tool name outside the nine with the surface listed', async () => {
    const kern = freshKernloop();
    const { client, close } = await connectedClient(kern);
    const result = (await client.callTool({ name: 'distill', arguments: {} })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('unknown_tool');
    await close();
    kern.close();
  });
});
