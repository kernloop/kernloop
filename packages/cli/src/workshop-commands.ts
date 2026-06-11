/**
 * The `workshop` CLI subcommands — `run` (invoke a born tool against a stdin
 * contract JSON in the ratified sandbox; CLM-0071), `sweep` (the decay trigger;
 * CLM-0072), and `list` (live tools + their ladder tier). Split out of cli.ts
 * to keep that shell within its LOC budget; the dispatch helpers it needs are
 * injected, so this stays a thin argument-shaping layer (behavior lives in the
 * workshop tool functions).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CliIo } from './cli.js';
import type { CommandHelpers } from './portability-commands.js';
import { workshopListTool, workshopRunTool, workshopSweepTool } from './tools/index.js';

/** Resolve `workshop run`'s input: exactly one of --input <file> / --input-json. */
function workshopInput(
  io: CliIo,
  v: Record<string, string | boolean>,
  str: CommandHelpers['str'],
): unknown {
  const file = str(v.input);
  const json = str(v['input-json']);
  if ((file === undefined) === (json === undefined)) {
    throw new Error('provide exactly one of --input <file> or --input-json <json>');
  }
  const raw =
    file === undefined ? (json as string) : readFileSync(path.resolve(io.cwd, file), 'utf8');
  return JSON.parse(raw);
}

/** `kernloop workshop run <name> … | sweep | list` (spec §5.6 runtime + decay). */
export function workshopCommand(args: string[], io: CliIo, h: CommandHelpers): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === 'run') {
    const [name, ...flagArgs] = rest;
    if (name === undefined || name.startsWith('-')) {
      throw new Error('usage: kernloop workshop run <name> (--input <file> | --input-json <json>)');
    }
    const v = h.strFlags(flagArgs, ['input', 'input-json']);
    return h.withKernloop(io, v.dir, (kern) =>
      workshopRunTool(kern, { name, input: workshopInput(io, v, h.str) }),
    );
  }
  if (sub === 'sweep') {
    const v = h.strFlags(rest, []);
    return h.withKernloop(io, v.dir, (kern) => workshopSweepTool(kern));
  }
  if (sub === 'list') {
    const v = h.strFlags(rest, []);
    return h.withKernloop(io, v.dir, (kern) => workshopListTool(kern));
  }
  throw new Error(`unknown workshop subcommand "${sub ?? ''}" — use run, sweep, or list`);
}
