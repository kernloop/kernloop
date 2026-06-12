/**
 * The overlay data-portability CLI subcommands — `memory export`/`import`
 * (CLM-0069) and `priors export` (CLM-0070). Split out of cli.ts to keep that
 * shell within its LOC budget; the dispatch helpers it needs (flag parsing,
 * kernloop assembly) are injected so this stays a thin argument-shaping layer,
 * behavior living in the tool functions.
 */
import path from 'node:path';
import type { CliIo } from './cli.js';
import type { Kernloop } from './kernel.js';
import { memoryExportTool, memoryImportTool } from './tools/memory.js';
import { priorsExportTool } from './tools/priors.js';

/** The dispatch helpers cli.ts owns, injected so this module reuses them. */
export interface CommandHelpers {
  /** Parse `--out` (and the shared `--dir`); unknown flags fail loudly. */
  outFlags: (args: string[]) => { out?: string | boolean; dir?: string | boolean };
  /** Parse the named string flags (plus the shared `--dir`); unknown flags fail loudly. */
  strFlags: (args: string[], names: readonly string[]) => Record<string, string | boolean>;
  /** Parse named string flags + named boolean flags (plus `--dir`); unknown flags fail loudly. */
  mixedFlags: (
    args: string[],
    strs: readonly string[],
    bools: readonly string[],
  ) => Record<string, string | boolean>;
  /** Assemble a kernloop over the overlay, run `fn`, print JSON, then close. */
  withKernloop: (
    io: CliIo,
    dir: string | boolean | undefined,
    fn: (kern: Kernloop) => Promise<unknown> | unknown,
  ) => Promise<number>;
  /** Narrow a parsed flag to its string value, or undefined. */
  str: (value: string | boolean | undefined) => string | undefined;
}

/** `kernloop memory export [--out <file>] | import <file>`. */
export function memoryCommand(args: string[], io: CliIo, h: CommandHelpers): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === 'export') {
    const v = h.outFlags(rest);
    const out = h.str(v.out);
    return h.withKernloop(io, v.dir, (kern) =>
      memoryExportTool(kern, { ...(out === undefined ? {} : { out: path.resolve(io.cwd, out) }) }),
    );
  }
  if (sub === 'import') {
    // the export file is the one positional; flags follow it
    const [file, ...flagArgs] = rest;
    const v = h.outFlags(flagArgs);
    if (file === undefined) throw new Error('usage: kernloop memory import <file>');
    return h.withKernloop(io, v.dir, (kern) =>
      memoryImportTool(kern, { file: path.resolve(io.cwd, file) }),
    );
  }
  throw new Error('usage: kernloop memory export [--out <file>] | import <file>');
}

/** `kernloop priors export [--out <file>]` → reviewable priors.yaml. */
export function priorsCommand(args: string[], io: CliIo, h: CommandHelpers): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === 'export') {
    const v = h.outFlags(rest);
    const out = h.str(v.out);
    return h.withKernloop(io, v.dir, (kern) =>
      priorsExportTool(kern, { ...(out === undefined ? {} : { out: path.resolve(io.cwd, out) }) }),
    );
  }
  throw new Error('usage: kernloop priors export [--out <file>]');
}
