#!/usr/bin/env node
/**
 * The `kernloop` CLI (spec §9): init/doctor/serve plus the kernel eleven
 * (spec §3.4) as subcommands, JSON on stdout. A thin shell — argument parsing
 * here, behavior in the tool functions; `serve` exposes the same eleven-tool
 * surface over stdio [CLM-0033, CLM-0058].
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ADAPTER_NAMES } from '@kernloop/kernel';
import { OVERLAY_DIR_NAME, initOverlay } from './overlay.js';
import { runCommand } from './run-command.js';
import { doctor } from './doctor.js';
import { createProductionKernloop, type Kernloop } from './kernel.js';
import { serveStdio } from './mcp.js';
import {
  auditTool,
  briefTool,
  distillTool,
  listDistillCandidates,
  forgeTool,
  gateTool,
  manifestTool,
  observeTool,
  recallTool,
  rememberTool,
  statusTool,
} from './tools/index.js';
import { metricsCommand } from './metrics-commands.js';
import { watchCommand } from './watch-commands.js';
import { gateInputFrom } from './gate-flags.js';
import { memoryCommand, priorsCommand, type CommandHelpers } from './portability-commands.js';
import { workshopCommand } from './workshop-commands.js';
import { modelsCommand } from './models-commands.js';
import { trackerCommand } from './tracker-commands.js';
import { observerCommand } from './observer-commands.js';
import { programCommand } from './program-commands.js';
import { USAGE } from './usage.js';

/** Injectable I/O so tests can capture output. */
export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  cwd: string;
}

/** Common string- and boolean-flag declarations, spread into command options. */
const S = { type: 'string' } as const;
const B = { type: 'boolean' } as const;
/** `--adapter` flag space (spec §3.1); panel/strategy schemas live in gate-flags.ts. */
const AdapterFlagSchema = z.enum(ADAPTER_NAMES);

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
  const kern = createProductionKernloop({ overlayDir: overlayDirFor(io, dir) });
  try {
    io.out(JSON.stringify(await fn(kern), null, 2));
    return 0;
  } finally {
    kern.close();
  }
}

/**
 * Like {@link withKernloop}, but the command picks its own exit CODE from the
 * tool result — so an integrity/verdict command can FAIL CLOSED (exit nonzero)
 * instead of the default 0. The `json` is still printed; `code` is the exit.
 */
async function withKernloopCode(
  io: CliIo,
  dir: string | boolean | undefined,
  fn: (kern: Kernloop) => { json: unknown; code: number },
): Promise<number> {
  const kern = createProductionKernloop({ overlayDir: overlayDirFor(io, dir) });
  try {
    const { json, code } = fn(kern);
    io.out(JSON.stringify(json, null, 2));
    return code;
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

/** Dispatch helpers shared with the extracted portability subcommands. */
const commandHelpers: CommandHelpers = {
  outFlags: (args) => flags(args, { out: S }),
  strFlags: (args, names) =>
    flags(args, Object.fromEntries(names.map((n) => [n, S]))) as Record<string, string | boolean>,
  mixedFlags: (args, strs, bools) =>
    flags(args, {
      ...Object.fromEntries(strs.map((n) => [n, S])),
      ...Object.fromEntries(bools.map((n) => [n, B])),
    }) as Record<string, string | boolean>,
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
    await serveStdio(createProductionKernloop({ overlayDir: overlayDirFor(io, v.dir) }));
    return 0; // the stdio transport holds the process open
  },
  /* v8 ignore stop */
  run: (args, io) => runCommand(args, io, commandHelpers),
  status: (args, io) => {
    const v = flags(args, { 'task-id': S, job: S });
    const job = str(v.job);
    return withKernloop(io, v.dir, (kern) =>
      statusTool(
        kern,
        job === undefined ? { taskId: required(v['task-id'], '--task-id') } : { job },
      ),
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
    const adapter = str(v.adapter) === undefined ? undefined : AdapterFlagSchema.parse(v.adapter);
    return withKernloop(io, v.dir, (kern) => gateTool(kern, gateInputFrom(io.cwd, v, adapter)));
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
    return withKernloopCode(io, v.dir, (kern) => {
      if ((str(v.op) ?? 'verify') === 'verify') {
        const json = auditTool(kern, { op: 'verify' });
        // An integrity verb FAILS CLOSED: a broken/tampered chain is exit 1, so
        // `kernloop audit --op verify && …` can never treat tampering as success.
        const code = json.op === 'verify' && !json.result.ok ? 1 : 0;
        return { json, code };
      }
      return {
        json: auditTool(kern, {
          op: 'query',
          ...(from === undefined ? {} : { fromSeq: Number(from) }),
          ...(to === undefined ? {} : { toSeq: Number(to) }),
          ...(type === undefined ? {} : { type }),
        }),
        code: 0,
      };
    });
  },
  observe: (args, io) => {
    const v = flags(args, {});
    return withKernloop(io, v.dir, (kern) => observeTool(kern, {}));
  },
  metrics: (args, io) => metricsCommand(args, io),
  watch: (args, io) => watchCommand(args, io),
  memory: (args, io) => memoryCommand(args, io, commandHelpers),
  priors: (args, io) => priorsCommand(args, io, commandHelpers),
  models: (args, io) => modelsCommand(args, io, commandHelpers),
  distill: (args, io) => {
    const v = flags(args, { trace: S, adapter: S, list: B });
    // `distill --list`: the distill-candidate NOMINATION surface (#228 P3·4) — print
    // the loop-flagged distill-worthy traces and exit, distilling nothing.
    if (v.list === true) {
      return withKernloop(io, v.dir, (kern) => Promise.resolve(listDistillCandidates(kern)));
    }
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
  workshop: (args, io) => workshopCommand(args, io, commandHelpers),
  tracker: (args, io) => trackerCommand(args, io, commandHelpers),
  observer: (args, io) => observerCommand(args, io, commandHelpers),
  program: (args, io) => programCommand(args, io, commandHelpers),
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
