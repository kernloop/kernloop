#!/usr/bin/env node
/**
 * The `kernloop` CLI (spec §9): init/doctor/serve plus the kernel eleven
 * (spec §3.4) as subcommands, JSON on stdout. The CLI is a thin shell —
 * argument parsing here, behavior in the tool functions; the MCP server
 * (`serve`) exposes the same eleven-tool surface over stdio [CLM-0033,
 * CLM-0058].
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ADAPTER_NAMES } from '@kernloop/kernel';
import { OVERLAY_DIR_NAME, VOTE_STRATEGIES, initOverlay } from './overlay.js';
import { doctor } from './doctor.js';
import { createKernloop, type Kernloop } from './kernel.js';
import { serveStdio } from './mcp.js';
import {
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
  type GateInput,
} from './tools/index.js';
import { memoryCommand, priorsCommand, type CommandHelpers } from './portability-commands.js';

/** Injectable I/O so tests can capture output. */
export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd: string;
}

const USAGE = [
  'usage: kernloop <command> [flags]',
  '  init      [--dir <repo>]                        scaffold .kernloop/',
  '  doctor    [--dir <repo>]                        validate the overlay',
  '  serve     [--dir <repo>]                        MCP server on stdio',
  '  run       --goal G --capability C [--workspace D] [--adapter A] [--plan] [--id I]',
  '            --resume RUNID --capability workflow.canonical [--workspace D] [--adapter A]',
  '  status    --task-id T',
  '  brief     --goal G [--id I]',
  '  gate      --gate quality --task-id T --workspace D',
  '            --gate vote --proposal P [--brief-goal G] [--panel 3|7] [--strategy S] [--adapter A] [--task-id T]',
  '            --gate review (--diff D | --diff-file F) [--context C] [--adapter A] [--task-id T]',
  '  recall    --query Q [--limit N]',
  '  remember  --fact F --provenance P [--confidence C]',
  '  distill   --trace <taskId|runId> [--adapter A]   propose a skill from a trace (suggest tier)',
  '  forge     --spec-file <tool-spec.json> [--adapter A]   birth a workshop/* tool in the sandbox',
  '  manifest  --op list|get|register [--name N] [--version V] [--file J]',
  '  audit     [--op verify|query] [--from N] [--to N] [--type T]',
  '  observe',
  '  memory    export [--out <file>]                 portable memory export (JSON; default stdout)',
  '            import <file>                          load a memory export (upserts, audited)',
  '  priors    export [--out <file>]                 routing priors → .kernloop/priors.yaml (YAML)',
].join('\n');

/** Common string-flag declaration, spread into each command's options. */
const S = { type: 'string' } as const;

/** `--adapter` value space: the five kernel adapters (spec §3.1). */
const AdapterFlagSchema = z.enum(ADAPTER_NAMES);

/** `--panel` / `--strategy` value spaces (spec §5.3). */
const PanelFlagSchema = z.union([z.literal(3), z.literal(7)]);
const StrategyFlagSchema = z.enum(VOTE_STRATEGIES);

/** Parse flags for one command; unknown flags fail loudly. */
function flags<const O extends Record<string, { type: 'string' | 'boolean' }>>(
  args: string[],
  options: O,
): { [K in keyof O | 'dir']?: string | boolean } {
  return parseArgs({ args, options: { ...options, dir: S }, allowPositionals: false }).values as {
    [K in keyof O | 'dir']?: string | boolean;
  };
}

/** Narrow a parsed flag to its string value, or undefined. */
function str(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Required string flag or a thrown usage error. */
function required(value: string | boolean | undefined, flag: string): string {
  const s = str(value);
  if (s === undefined) throw new Error(`missing required flag ${flag}`);
  return s;
}

/** Resolve the overlay directory for a command (`--dir` or cwd). */
function overlayDirFor(io: CliIo, dir: string | boolean | undefined): string {
  return path.join(path.resolve(io.cwd, str(dir) ?? '.'), OVERLAY_DIR_NAME);
}

/** Run one tool-backed command against an assembled kernloop, then close. */
async function withKernloop(
  io: CliIo,
  dir: string | boolean | undefined,
  fn: (kern: Kernloop) => Promise<unknown> | unknown,
): Promise<number> {
  const kern = createKernloop({ overlayDir: overlayDirFor(io, dir) });
  try {
    io.out(JSON.stringify(await fn(kern), null, 2));
    return 0;
  } finally {
    kern.close();
  }
}

type Handler = (args: string[], io: CliIo) => Promise<number>;

/** The manifest subcommand body (op dispatch). */
function manifestOp(
  kern: Kernloop,
  io: CliIo,
  v: {
    op?: string | boolean;
    name?: string | boolean;
    version?: string | boolean;
    file?: string | boolean;
  },
): unknown {
  const op = required(v.op, '--op');
  if (op === 'list') return manifestTool(kern, { op: 'list' });
  if (op === 'get') {
    const version = str(v.version);
    return manifestTool(kern, {
      op: 'get',
      name: required(v.name, '--name'),
      ...(version === undefined ? {} : { version }),
    });
  }
  if (op === 'register') {
    const file = path.resolve(io.cwd, required(v.file, '--file'));
    const manifest: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return manifestTool(kern, { op: 'register', manifest } as never);
  }
  throw new Error(`unknown manifest op "${op}" — use list, get, or register`);
}

/** Map gate flags onto the gate tool's discriminated input (spec §5.3). */
function gateInputFrom(io: CliIo, v: Record<string, string | boolean | undefined>): GateInput {
  const gateName = str(v.gate) ?? 'quality';
  const taskId = str(v['task-id']);
  const adapter = str(v.adapter) === undefined ? undefined : AdapterFlagSchema.parse(v.adapter);
  if (gateName === 'vote') {
    const [briefGoal, panel, strategy] = [str(v['brief-goal']), str(v.panel), str(v.strategy)];
    return {
      gateName,
      proposal: required(v.proposal, '--proposal'),
      ...(taskId === undefined ? {} : { taskId }),
      ...(briefGoal === undefined ? {} : { briefGoal }),
      ...(panel === undefined ? {} : { panel: PanelFlagSchema.parse(Number(panel)) }),
      ...(strategy === undefined ? {} : { strategy: StrategyFlagSchema.parse(strategy) }),
      ...(adapter === undefined ? {} : { adapter }),
    };
  }
  if (gateName === 'review') {
    const [diff, diffFile, context] = [str(v.diff), str(v['diff-file']), str(v.context)];
    return {
      gateName,
      ...(taskId === undefined ? {} : { taskId }),
      ...(diff === undefined ? {} : { diff }),
      ...(diffFile === undefined ? {} : { diffFile: path.resolve(io.cwd, diffFile) }),
      ...(context === undefined ? {} : { context }),
      ...(adapter === undefined ? {} : { adapter }),
    };
  }
  // quality (or an unknown name the tool rejects with its typed error)
  return {
    gateName: gateName as 'quality',
    taskId: required(v['task-id'], '--task-id'),
    workspaceDir: path.resolve(io.cwd, required(v.workspace, '--workspace')),
  };
}

/** Dispatch helpers shared with the extracted portability subcommands. */
const commandHelpers: CommandHelpers = {
  outFlags: (args) => flags(args, { out: S }),
  withKernloop,
  str,
};

const HANDLERS: Record<string, Handler> = {
  init: (args, io) => {
    const v = flags(args, {});
    io.out(JSON.stringify(initOverlay(path.resolve(io.cwd, str(v.dir) ?? '.')), null, 2));
    return Promise.resolve(0);
  },
  doctor: (args, io) => {
    const v = flags(args, {});
    const result = doctor(overlayDirFor(io, v.dir));
    io.out(JSON.stringify(result, null, 2));
    return Promise.resolve(result.ok ? 0 : 1);
  },
  /* v8 ignore start -- holds the process on stdio; exercised by `kernloop serve` */
  serve: async (args, io) => {
    const v = flags(args, {});
    await serveStdio(createKernloop({ overlayDir: overlayDirFor(io, v.dir) }));
    return 0; // the stdio transport holds the process open
  },
  /* v8 ignore stop */
  run: (args, io) => {
    const v = flags(args, {
      goal: S,
      capability: S,
      workspace: S,
      id: S,
      adapter: S,
      resume: S,
      plan: { type: 'boolean' },
    });
    const [workspace, id, resume] = [str(v.workspace), str(v.id), str(v.resume)];
    // `--resume` replaces `--goal` (the checkpointed task is the truth).
    const goal = resume === undefined ? required(v.goal, '--goal') : str(v.goal);
    const adapter = str(v.adapter) === undefined ? undefined : AdapterFlagSchema.parse(v.adapter);
    return withKernloop(io, v.dir, (kern) =>
      runTool(kern, {
        ...(goal === undefined ? {} : { goal }),
        capability: required(v.capability, '--capability'),
        ...(workspace === undefined ? {} : { workspaceDir: path.resolve(io.cwd, workspace) }),
        ...(v.plan === true ? { execute: false } : {}),
        ...(id === undefined ? {} : { id }),
        ...(adapter === undefined ? {} : { adapter }),
        ...(resume === undefined ? {} : { resume }),
      }),
    );
  },
  status: (args, io) => {
    const v = flags(args, { 'task-id': S });
    return withKernloop(io, v.dir, (kern) =>
      statusTool(kern, { taskId: required(v['task-id'], '--task-id') }),
    );
  },
  brief: (args, io) => {
    const v = flags(args, { goal: S, id: S });
    const id = str(v.id);
    return withKernloop(io, v.dir, (kern) =>
      briefTool(kern, { goal: required(v.goal, '--goal'), ...(id === undefined ? {} : { id }) }),
    );
  },
  gate: (args, io) => {
    const v = flags(args, {
      'task-id': S,
      workspace: S,
      gate: S,
      proposal: S,
      'brief-goal': S,
      panel: S,
      strategy: S,
      diff: S,
      'diff-file': S,
      context: S,
      adapter: S,
    });
    return withKernloop(io, v.dir, (kern) => gateTool(kern, gateInputFrom(io, v)));
  },
  recall: (args, io) => {
    const v = flags(args, { query: S, limit: S });
    const limit = str(v.limit);
    return withKernloop(io, v.dir, (kern) =>
      recallTool(kern, {
        query: required(v.query, '--query'),
        ...(limit === undefined ? {} : { limit: Number(limit) }),
      }),
    );
  },
  remember: (args, io) => {
    const v = flags(args, { fact: S, provenance: S, confidence: S });
    const confidence = str(v.confidence);
    return withKernloop(io, v.dir, (kern) =>
      rememberTool(kern, {
        fact: required(v.fact, '--fact'),
        provenance: required(v.provenance, '--provenance'),
        ...(confidence === undefined ? {} : { confidence: Number(confidence) }),
      }),
    );
  },
  manifest: (args, io) => {
    const v = flags(args, { op: S, name: S, version: S, file: S });
    return withKernloop(io, v.dir, (kern) => manifestOp(kern, io, v));
  },
  audit: (args, io) => {
    const v = flags(args, { op: S, from: S, to: S, type: S });
    const [from, to, type] = [str(v.from), str(v.to), str(v.type)];
    return withKernloop(io, v.dir, (kern) => {
      if ((str(v.op) ?? 'verify') === 'verify') return auditTool(kern, { op: 'verify' });
      return auditTool(kern, {
        op: 'query',
        ...(from === undefined ? {} : { fromSeq: Number(from) }),
        ...(to === undefined ? {} : { toSeq: Number(to) }),
        ...(type === undefined ? {} : { type }),
      });
    });
  },
  observe: (args, io) => {
    const v = flags(args, {});
    return withKernloop(io, v.dir, (kern) => observeTool(kern, {}));
  },
  memory: (args, io) => memoryCommand(args, io, commandHelpers),
  priors: (args, io) => priorsCommand(args, io, commandHelpers),
  distill: (args, io) => {
    const v = flags(args, { trace: S, adapter: S });
    const adapter = str(v.adapter) === undefined ? undefined : AdapterFlagSchema.parse(v.adapter);
    return withKernloop(io, v.dir, (kern) =>
      distillTool(kern, {
        trace: required(v.trace, '--trace'),
        ...(adapter === undefined ? {} : { adapter }),
      }),
    );
  },
  forge: (args, io) => {
    const v = flags(args, { 'spec-file': S, adapter: S });
    const adapter = str(v.adapter) === undefined ? undefined : AdapterFlagSchema.parse(v.adapter);
    return withKernloop(io, v.dir, (kern) =>
      forgeTool(kern, {
        specFile: path.resolve(io.cwd, required(v['spec-file'], '--spec-file')),
        ...(adapter === undefined ? {} : { adapter }),
      }),
    );
  },
};

/** Dispatch one CLI invocation; returns the process exit code. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help') {
    io.out(USAGE);
    return command === undefined ? 1 : 0;
  }
  const handler = HANDLERS[command];
  if (handler === undefined) {
    io.err(`unknown command "${command}"\n${USAGE}`);
    return 1;
  }
  try {
    return await handler(rest, io);
  } catch (error) {
    io.err(
      JSON.stringify(
        {
          error: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    return 1;
  }
}

/* v8 ignore start -- process entry; runCli is covered directly */
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const io: CliIo = {
    out: (text) => process.stdout.write(text + '\n'),
    err: (text) => process.stderr.write(text + '\n'),
    cwd: process.cwd(),
  };
  const code = await runCli(process.argv.slice(2), io);
  if (process.argv[2] !== 'serve') process.exitCode = code;
}
/* v8 ignore stop */
