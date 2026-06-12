/**
 * Gate-command flag shaping — maps `kernloop gate` flags onto the gate tool's
 * discriminated input (spec §5.3). Split out of cli.ts to keep that shell within
 * its LOC budget; the parsed adapter is passed in (cli.ts owns the adapter
 * enum), so this module stays a thin argument-shaping layer.
 */
import path from 'node:path';
import { z } from 'zod';
import type { AdapterName } from '@kernloop/kernel';
import { VOTE_STRATEGIES } from './overlay.js';
import type { GateInput } from './tools/index.js';

/** Vote panel size: 3 by default, 7 at ratification (spec §5.3). */
const PanelFlagSchema = z.union([z.literal(3), z.literal(7)]);
/** Vote strategy literal (spec §5.3). */
const StrategyFlagSchema = z.enum(VOTE_STRATEGIES);

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

/** Map gate flags onto the gate tool's discriminated input (spec §5.3). */
export function gateInputFrom(
  cwd: string,
  v: Record<string, string | boolean | undefined>,
  adapter: AdapterName | undefined,
): GateInput {
  const gateName = str(v.gate) ?? 'quality';
  const taskId = str(v['task-id']);
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
      ...(diffFile === undefined ? {} : { diffFile: path.resolve(cwd, diffFile) }),
      ...(context === undefined ? {} : { context }),
      ...(adapter === undefined ? {} : { adapter }),
    };
  }
  // quality (or an unknown name the tool rejects with its typed error)
  return {
    gateName: gateName as 'quality',
    taskId: required(v['task-id'], '--task-id'),
    workspaceDir: path.resolve(cwd, required(v.workspace, '--workspace')),
  };
}
