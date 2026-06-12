/**
 * MCP surface tests [CLM-0033, CLM-0058]: the server exposes EXACTLY the
 * kernel eleven (spec §3.4) — enumerated through a real client over a
 * linked transport pair — tool calls are zod-validated end to end, and the
 * P3 pair (distill, forge) is invocable through MCP against scripted
 * `claude` and `docker` executables on PATH (honest doubles for the two
 * external binaries; everything in between — server, tools, kernel,
 * faculties, sandbox argv, SQLite, audit chain — is real).
 */
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createKernloop, type Kernloop } from './kernel.js';
import { createMcpServer } from './mcp.js';
import { KERNEL_TOOL_NAMES } from './tools/index.js';

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

/** The distill emission the scripted claude answers with. */
const SKILL_EMISSION = JSON.stringify({
  name: 'mcp-distilled-probe',
  oneLiner: 'Probe the episodic store over MCP.',
  body: '# mcp-distilled-probe\n\nProbe the episodic store over MCP.\n\n## When to use\n\nWhen MCP needs a trace.\n\n## Steps\n\n1. Run memory.episodic.read.\n',
});

/** The forge generation emission the scripted claude answers with. */
const SOURCE_EMISSION = JSON.stringify({
  source: 'export function add(a, b) {\n  return a + b;\n}\n',
});

/**
 * A bin dir holding scripted `claude` (reads the prompt on stdin, answers
 * the matching canned emission in the real claude CLI JSON envelope) and
 * `docker` (exits 0 — the sandboxed acceptance test "passed"). Returned
 * PATH prepends it; the caller scopes process.env.PATH and restores it.
 */
function scriptedBin(): string {
  const bin = mkdtempSync(path.join(tmpdir(), 'kernloop-fake-bin-'));
  dirs.push(bin);
  const responses = [
    { match: 'distilling a reusable skill', result: SKILL_EMISSION },
    { match: 'workshop tool', result: SOURCE_EMISSION },
  ];
  writeFileSync(path.join(bin, 'responses.json'), JSON.stringify(responses));
  const claude = [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    "const path = require('path');",
    'const chunks = [];',
    "process.stdin.on('data', (c) => chunks.push(c));",
    "process.stdin.on('end', () => {",
    "  const prompt = Buffer.concat(chunks).toString('utf8');",
    "  const responses = JSON.parse(fs.readFileSync(path.join(__dirname, 'responses.json'), 'utf8'));",
    '  const match = responses.find((r) => prompt.includes(r.match));',
    '  process.stdout.write(JSON.stringify({',
    "    type: 'result', is_error: false, result: match ? match.result : '{}',",
    '    usage: { input_tokens: 10, output_tokens: 20 }, total_cost_usd: 0.001,',
    '  }));',
    '});',
    '',
  ].join('\n');
  writeFileSync(path.join(bin, 'claude'), claude);
  chmodSync(path.join(bin, 'claude'), 0o755);
  writeFileSync(path.join(bin, 'docker'), "#!/usr/bin/env node\nprocess.stdout.write('ok\\n');\n");
  chmodSync(path.join(bin, 'docker'), 0o755);
  return bin;
}

/** A complete, valid forge birth certificate. */
function toolSpec(name: string): Record<string, unknown> {
  return {
    claim: { id: 'CLM-0058', statement: `${name} adds two numbers` },
    acceptanceTest:
      'import test from "node:test";\n' +
      'import assert from "node:assert/strict";\n' +
      'import { add } from "./tool.mjs";\n' +
      'test("adds", () => { assert.equal(add(2, 3), 5); });\n',
    manifest: {
      name: `workshop/${name}`,
      version: '0.1.0',
      kind: 'workshopTool',
      capabilities: [{ name: `${name}.run` }],
      contracts: { consumes: ['TaskContract'], emits: ['Outcome'] },
      cost: { tokens: 0, usd: 0, latencyMs: 100 },
      tier: 'suggest',
      claims: ['CLM-0058'],
      maturity: 'experimental',
    },
  };
}

describe('MCP server surface', () => {
  it('exposes exactly the kernel eleven: run, status, brief, gate, recall, remember, distill, forge, manifest, audit, observe — and nothing else', async () => {
    const kern = freshKernloop();
    const { client, close } = await connectedClient(kern);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    expect(names).toEqual([...KERNEL_TOOL_NAMES].sort());
    expect(names).toHaveLength(11);
    expect(names).toContain('distill');
    expect(names).toContain('forge');
    // workshop creations are manifests, never additional MCP tools
    expect(names.some((n) => n.startsWith('workshop/'))).toBe(false);
    await close();
    kern.close();
  });

  it('advertises a JSON Schema for every tool input', async () => {
    const kern = freshKernloop();
    const { client, close } = await connectedClient(kern);
    const tools = (await client.listTools()).tools;
    expect(tools).toHaveLength(11);
    for (const tool of tools) {
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
      arguments: { fact: 'mcp surface is the kernel eleven', provenance: 'CLM-0033' },
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
    expect(manifests.manifests).toHaveLength(9);
    const audit = parseResult(
      await client.callTool({ name: 'audit', arguments: { op: 'verify' } }),
    ) as { result: { ok: boolean } };
    expect(audit.result.ok).toBe(true);
    const observed = parseResult(await client.callTool({ name: 'observe', arguments: {} })) as {
      audit: { verified: boolean };
      observer: { fitnessLedger: unknown[] };
    };
    expect(observed.audit.verified).toBe(true);
    expect(observed.observer.fitnessLedger).toEqual([]);
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
    expect(gate.isError).toBe(true); // vote requires a proposal — zod says so
    await close();
    kern.close();
  });

  it('serves distill over MCP: a recorded trace becomes a proposed skill through a scripted adapter', async () => {
    const kern = freshKernloop();
    const { client, close } = await connectedClient(kern);
    const realPath = process.env.PATH;
    process.env.PATH = `${scriptedBin()}${path.delimiter}${realPath ?? ''}`;
    try {
      const ran = parseResult(
        await client.callTool({
          name: 'run',
          arguments: {
            goal: 'record a trace',
            capability: 'memory.episodic.read',
            id: 'task-mcp-1',
          },
        }),
      ) as { kind: string };
      expect(ran.kind).toBe('outcome');
      const proposal = parseResult(
        await client.callTool({ name: 'distill', arguments: { trace: 'task-mcp-1' } }),
      ) as { name: string; tier: string; skillFile: string };
      expect(proposal.name).toBe('mcp-distilled-probe');
      expect(proposal.tier).toBe('suggest');
      expect(proposal.skillFile).toContain(path.join('skills', 'proposed', 'mcp-distilled-probe'));
      expect(existsSync(proposal.skillFile)).toBe(true);
    } finally {
      process.env.PATH = realPath;
    }
    await close();
    kern.close();
  });

  it('serves forge over MCP: a workshop tool is born through the sandbox via scripted adapter and docker', async () => {
    const kern = freshKernloop();
    const { client, close } = await connectedClient(kern);
    const realPath = process.env.PATH;
    process.env.PATH = `${scriptedBin()}${path.delimiter}${realPath ?? ''}`;
    try {
      const born = parseResult(
        await client.callTool({ name: 'forge', arguments: { spec: toolSpec('mcp-adder') } }),
      ) as { name: string; dir: string; manifest: { name: string; tier: string } };
      expect(born.name).toBe('mcp-adder');
      expect(born.manifest).toMatchObject({ name: 'workshop/mcp-adder', tier: 'suggest' });
      expect(existsSync(path.join(born.dir, 'tool.mjs'))).toBe(true);
      // the born tool is a registered workshop/* manifest, not tool #12
      expect(kern.registry.get('workshop/mcp-adder')?.tier).toBe('suggest');
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toHaveLength(11);
      expect(names).not.toContain('workshop/mcp-adder');
    } finally {
      process.env.PATH = realPath;
    }
    await close();
    kern.close();
  });

  it('surfaces forge birth refusals as typed MCP error results', async () => {
    const kern = freshKernloop();
    const { client, close } = await connectedClient(kern);
    const result = (await client.callTool({
      name: 'forge',
      arguments: { spec: { claim: { id: 'CLM-0058', statement: 'incomplete' } } },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('ForgeBirthError');
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

  it('rejects a tool name outside the eleven with the surface listed', async () => {
    const kern = freshKernloop();
    const { client, close } = await connectedClient(kern);
    const result = (await client.callTool({ name: 'research', arguments: {} })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('unknown_tool');
    expect(result.content[0]?.text).toContain('distill');
    expect(result.content[0]?.text).toContain('forge');
    await close();
    kern.close();
  });
});
