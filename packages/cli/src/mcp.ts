/**
 * MCP server — the resident process per session (spec §3.3). Exposes
 * EXACTLY the nine P1 kernel tools (spec §3.4, §11 P1 row) [CLM-0033];
 * `distill` and `forge` are P3 and absent, not stubbed. Tool inputs are
 * zod-validated by the same schemas the typed tool functions use; input
 * JSON Schemas advertised over `tools/list` are generated from those same
 * zod schemas, so the wire contract cannot drift from the implementation.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Kernloop } from './kernel.js';
import {
  AuditInputSchema,
  BriefInputSchema,
  GateInputSchema,
  ManifestInputSchema,
  ObserveInputSchema,
  RecallInputSchema,
  RememberInputSchema,
  RunInputSchema,
  StatusInputSchema,
  auditTool,
  briefTool,
  gateTool,
  manifestTool,
  observeTool,
  recallTool,
  rememberTool,
  runTool,
  statusTool,
  type P1ToolName,
} from './tools/index.js';

/** One MCP-exposed tool: description, input schema, and dispatcher. */
interface ToolEntry {
  readonly description: string;
  readonly schema: z.ZodType;
  readonly handler: (kern: Kernloop, args: unknown) => Promise<unknown> | unknown;
}

/** The nine-tool dispatch table — the complete P1 MCP surface [CLM-0033]. */
export const TOOL_TABLE: Readonly<Record<P1ToolName, ToolEntry>> = {
  run: {
    description:
      'The entry point: route a goal/TaskContract via manifests and execute the selected capability, returning an Outcome. execute:false returns the routing decision only.',
    schema: RunInputSchema,
    handler: (kern, args) => runTool(kern, RunInputSchema.parse(args)),
  },
  status: {
    description: 'Inspect a task cross-session: its recorded episodic trace summary.',
    schema: StatusInputSchema,
    handler: (kern, args) => statusTool(kern, StatusInputSchema.parse(args)),
  },
  brief: {
    description:
      'Compile a context Brief for a goal without executing anything (dry-run the compiler over real gathered sources).',
    schema: BriefInputSchema,
    handler: (kern, args) => briefTool(kern, BriefInputSchema.parse(args)),
  },
  gate: {
    description:
      'Invoke a gate uniformly and get a Verdict. P1 ships the quality gate (typecheck/lint/test over a workspace).',
    schema: GateInputSchema,
    handler: (kern, args) => gateTool(kern, GateInputSchema.parse(args)),
  },
  recall: {
    description: 'Memory read: recall semantic facts for a query, provenance-tagged and ranked.',
    schema: RecallInputSchema,
    handler: (kern, args) => recallTool(kern, RecallInputSchema.parse(args)),
  },
  remember: {
    description: 'Memory write: store a typed fact. Provenance is mandatory.',
    schema: RememberInputSchema,
    handler: (kern, args) => rememberTool(kern, RememberInputSchema.parse(args)),
  },
  manifest: {
    description: 'Registry ops: list, get, or register capability manifests.',
    schema: ManifestInputSchema,
    handler: (kern, args) => manifestTool(kern, ManifestInputSchema.parse(args)),
  },
  audit: {
    description: 'Audit chain ops: verify the hash chain, or query events by range and type.',
    schema: AuditInputSchema,
    handler: (kern, args) => auditTool(kern, AuditInputSchema.parse(args)),
  },
  observe: {
    description:
      'Telemetry derived from the audit chain and memory: event counts, routing and verdict statistics, measured cost, adapter availability.',
    schema: ObserveInputSchema,
    handler: (kern, args) => observeTool(kern, ObserveInputSchema.parse(args)),
  },
};

/** Render a tool result (or error) as an MCP text content block. */
function textResult(
  value: unknown,
  isError = false,
): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  const text = JSON.stringify(value, null, 2);
  return isError
    ? { content: [{ type: 'text', text }], isError: true }
    : { content: [{ type: 'text', text }] };
}

/**
 * Build the MCP server over one assembled kernloop. Registers exactly the
 * nine P1 tools [CLM-0033]; tool calls zod-validate their inputs and report
 * failures as typed MCP error results, never silent ones.
 */
export function createMcpServer(kern: Kernloop): Server {
  const server = new Server(
    { name: 'kernloop', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: Object.entries(TOOL_TABLE).map(([name, entry]) => ({
      name,
      description: entry.description,
      // MCP requires a top-level `type: "object"`; discriminated unions
      // (manifest, audit) generate `anyOf` of objects, so the type is stated
      // explicitly — every variant is an object.
      inputSchema: {
        ...z.toJSONSchema(entry.schema, { io: 'input', target: 'draft-7' }),
        type: 'object' as const,
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const entry = (TOOL_TABLE as Record<string, ToolEntry | undefined>)[request.params.name];
    if (entry === undefined) {
      return textResult(
        {
          error: 'unknown_tool',
          message: `no tool named "${request.params.name}" — the P1 surface is exactly: ${Object.keys(TOOL_TABLE).join(', ')}`,
        },
        true,
      );
    }
    try {
      return textResult(await entry.handler(kern, request.params.arguments ?? {}));
    } catch (error) {
      return textResult(
        {
          error: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        },
        true,
      );
    }
  });
  return server;
}

/** Serve MCP over stdio — `kernloop serve` (spec §3.3: no daemon). */
export async function serveStdio(kern: Kernloop): Promise<Server> {
  const server = createMcpServer(kern);
  await server.connect(new StdioServerTransport());
  return server;
}
