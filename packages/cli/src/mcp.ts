/**
 * MCP server — the resident process per session (spec §3.3). Exposes
 * EXACTLY the kernel eleven (spec §3.4) [CLM-0033]: run, status, brief,
 * gate, recall, remember, distill, forge, manifest, audit, observe — and
 * nothing else [CLM-0058]. Workshop creations register under the
 * `workshop/*` manifest namespace and never extend this surface. Tool
 * inputs are zod-validated by the same schemas the typed tool functions
 * use; input JSON Schemas advertised over `tools/list` are generated from
 * those same zod schemas, so the wire contract cannot drift from the
 * implementation.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Kernloop } from './kernel.js';
import {
  AuditInputSchema,
  BriefInputSchema,
  DistillInputSchema,
  ForgeInputSchema,
  GateInputSchema,
  ManifestInputSchema,
  ObserveInputSchema,
  RecallInputSchema,
  RememberInputSchema,
  RunInputSchema,
  StatusInputSchema,
  auditTool,
  briefTool,
  distillTool,
  forgeTool,
  gateTool,
  manifestTool,
  observeTool,
  recallTool,
  rememberTool,
  runTool,
  statusTool,
  type KernelToolName,
} from './tools/index.js';

/** One MCP-exposed tool: description, input schema, and dispatcher. */
interface ToolEntry {
  readonly description: string;
  readonly schema: z.ZodType;
  readonly handler: (kern: Kernloop, args: unknown) => Promise<unknown> | unknown;
}

/** The eleven-tool dispatch table — the complete MCP surface [CLM-0033]. */
export const TOOL_TABLE: Readonly<Record<KernelToolName, ToolEntry>> = {
  run: {
    description:
      'The entry point: route a goal/TaskContract via manifests and execute the selected capability, returning an Outcome. execute:false returns the routing decision only. async:true returns a job id immediately and runs the work in this resident process; inspect it with status --job.',
    schema: RunInputSchema,
    handler: (kern, args) => runTool(kern, RunInputSchema.parse(args)),
  },
  status: {
    description:
      'Inspect cross-session, by task id (its recorded episodic trace summary) OR by job id (the persisted job registry: running/done/failed, with traceRef or error). Exactly one of taskId or job.',
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
      'Invoke any gate uniformly and get a Verdict: quality (typecheck/lint/test over a workspace), vote (voter panel over one shared compiled Brief), or review (adversarial reviewer panel over a diff).',
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
  distill: {
    description:
      'Propose a SKILL.md from a recorded episodic trace, at suggest tier: the proposal lands under skills/proposed/ and goes live only through the human-reviewed ratification path.',
    schema: DistillInputSchema,
    handler: (kern, args) => distillTool(kern, DistillInputSchema.parse(args)),
  },
  forge: {
    description:
      'Toolsmith entry: birth a workshop/* tool from a spec (claim + acceptance test + manifest required), generated via the chosen adapter and proven inside the ratified Docker sandbox before install.',
    schema: ForgeInputSchema,
    handler: (kern, args) => forgeTool(kern, ForgeInputSchema.parse(args)),
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
 * kernel eleven [CLM-0033, CLM-0058]; tool calls zod-validate their inputs
 * and report failures as typed MCP error results, never silent ones.
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
          message: `no tool named "${request.params.name}" — the kernel surface is exactly: ${Object.keys(TOOL_TABLE).join(', ')}`,
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
