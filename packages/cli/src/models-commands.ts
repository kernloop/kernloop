/**
 * The model-discovery CLI subcommands — `models sync` and `models list`
 * [CLM-0086..0088] (spec §5.7). Split out of cli.ts to keep that shell within
 * its LOC budget; the dispatch helpers it needs (flag parsing, kernloop
 * assembly) are injected, so this stays a thin argument-shaping layer with the
 * behavior living in the tool functions. These are CLI VERBS, never MCP tools —
 * the kernel eleven stay frozen.
 */
import type { CliIo } from './cli.js';
import type { CommandHelpers } from './portability-commands.js';
import { modelsListTool, modelsSyncTool } from './tools/models.js';

/**
 * `kernloop models sync [--ollama-host H] [--no-ollama]` — discover every
 * registered endpoint (+ a local ollama unless skipped), normalize, replace each
 * source's discovered set in the machine-local cache, and audit the run.
 * `models list` — print the merged vendored + discovered catalog with freshness.
 */
export function modelsCommand(args: string[], io: CliIo, h: CommandHelpers): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === 'sync') {
    const v = h.mixedFlags(rest, ['ollama-host'], ['no-ollama']);
    const host = h.str(v['ollama-host']);
    return h.withKernloop(io, v.dir, (kern) =>
      modelsSyncTool(kern, {
        ...(host === undefined ? {} : { ollamaHost: host }),
        ...(v['no-ollama'] === true ? { skipOllama: true } : {}),
      }),
    );
  }
  if (sub === 'list') {
    const v = h.strFlags(rest, []);
    return h.withKernloop(io, v.dir, (kern) => modelsListTool(kern));
  }
  throw new Error('usage: kernloop models sync [--ollama-host <H>] [--no-ollama] | models list');
}
