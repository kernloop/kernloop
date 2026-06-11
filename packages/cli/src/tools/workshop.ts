/**
 * `workshop` — invoke, maintain, and inspect born workshop tools (spec §5.6
 * runtime + ladder/decay) [CLM-0071, CLM-0072]. The composition root's
 * binding of the toolsmith RUN path:
 *
 * - `run` invokes a born tool in the ratified Docker sandbox against a stdin
 *   contract JSON, parses its stdout contract JSON, advances the ladder via
 *   recordRun (clean runs climb suggest → advisory), and appends a
 *   `cli.workshop.invocation` audit event — the "every invocation appends
 *   provenance" leg of the build/test/invocation triad (rule 7).
 * - `sweep` runs sweepDecay — the decay trigger that was previously
 *   unreachable — and appends `cli.workshop.sweep` when anything decayed.
 * - `list` reports each live tool with its current ladder tier.
 *
 * Workshop tools NEVER extend the MCP surface; they live under `workshop/*`,
 * not as tool #12 (spec §3.4).
 */
import { appendEvent } from '@kernloop/kernel';
import {
  type LifecycleEvent,
  type RunWorkshopToolResult,
  type WorkshopToolInfo,
  listTools,
  loadLifecycle,
  runWorkshopTool,
  sweepDecay,
} from '@kernloop/faculty-toolsmith';
import type { Kernloop } from '../kernel.js';

/** Injectable clock (epoch ms) so the run/sweep timestamps are testable. */
export interface WorkshopClock {
  now?: () => number;
}

/** Result of `workshop run` — the tool output plus its audit provenance. */
export interface WorkshopRunResult {
  readonly name: string;
  readonly clean: boolean;
  readonly exitCode: number;
  /** The parsed stdout contract — undefined when the run was unclean. */
  readonly output: unknown;
  /** The tool's ladder tier after the run (promotion already applied). */
  readonly tier: string;
}

/** Injectable seams (tests script docker); the defaults are real. */
export interface WorkshopRunOptions extends WorkshopClock {
  /** Docker binary; injectable so success/refusal paths are testable. */
  dockerBin?: string;
}

/**
 * `workshop run <name>` — invoke a born tool against an input contract. The
 * input is serialized to the tool's stdin; its stdout contract is parsed and
 * returned. An unclean run (non-zero exit or non-JSON stdout) is reported
 * honestly, never thrown. Every invocation is audited (spec §5.6).
 */
export async function workshopRunTool(
  kern: Kernloop,
  input: { name: string; input: unknown },
  options: WorkshopRunOptions = {},
): Promise<WorkshopRunResult> {
  const now = (options.now ?? Date.now)();
  const result: RunWorkshopToolResult = await runWorkshopTool({
    overlayDir: kern.paths.dir,
    name: input.name,
    input: input.input,
    now,
    ...(options.dockerBin === undefined ? {} : { dockerBin: options.dockerBin }),
  });
  appendEvent(kern.store, {
    type: 'cli.workshop.invocation',
    payload: { name: result.name, clean: result.clean, exitCode: result.exitCode },
  });
  return {
    name: result.name,
    clean: result.clean,
    exitCode: result.exitCode,
    output: result.output,
    tier: result.lifecycle.tier,
  };
}

/** Result of `workshop sweep` — the decay transitions applied this sweep. */
export interface WorkshopSweepResult {
  readonly swept: readonly LifecycleEvent[];
  /** Names whose removal this sweep proposed (decayed to suggest, still idle). */
  readonly removalProposed: readonly string[];
}

/**
 * `workshop sweep` — run the decay sweep (spec §5.6 auto-decay): a tool unused
 * past the ratified decay window is demoted one tier per sweep; one already at
 * `suggest` and still idle is marked `removal_proposed` (removal itself still
 * needs human-ratified retire()). Appends `cli.workshop.sweep` when anything
 * decayed.
 */
export function workshopSweepTool(
  kern: Kernloop,
  options: WorkshopClock = {},
): WorkshopSweepResult {
  const now = (options.now ?? Date.now)();
  const swept = sweepDecay({ overlayDir: kern.paths.dir, now });
  const removalProposed = swept.filter((e) => e.event === 'removal_proposed').map((e) => e.tool);
  if (swept.length > 0) {
    appendEvent(kern.store, {
      type: 'cli.workshop.sweep',
      payload: { count: swept.length, removalProposed },
    });
  }
  return { swept, removalProposed };
}

/** One row of `workshop list`: the tool, its version, and its ladder tier. */
export interface WorkshopListRow {
  readonly name: string;
  readonly version: string;
  readonly tier: string;
  readonly status: string;
  readonly cleanRuns: number;
}

/** `workshop list` — the live tools and their current lifecycle tier. */
export function workshopListTool(kern: Kernloop): { tools: WorkshopListRow[] } {
  const lifecycle = loadLifecycle(kern.paths.dir);
  const tools = listTools(kern.paths.dir).map((info: WorkshopToolInfo): WorkshopListRow => {
    const life = lifecycle.tools[info.name];
    return {
      name: info.name,
      version: info.manifest.version,
      tier: life?.tier ?? info.manifest.tier,
      status: life?.status ?? 'live',
      cleanRuns: life?.cleanRuns ?? 0,
    };
  });
  return { tools };
}
