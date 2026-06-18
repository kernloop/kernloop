/**
 * The `run` command — route a TaskContract through a capability and record its
 * Outcome, with Ctrl-C COOPERATIVE ABORT (#317·P5): the first SIGINT fires the
 * abort signal (clean 'cancelled' halt, CLM-0143), a second escalates to a hard
 * exit. Extracted from cli.ts following the `*Command` module pattern (LOC gate).
 */
import path from 'node:path';
import { z } from 'zod';
import { ADAPTER_NAMES } from '@kernloop/kernel';
import { runTool } from './tools/index.js';
import { withSigintAbort } from './sigint-abort.js';
import { closeIssueAfterRun } from './run-close.js';
import { parseBudget } from './cli-flags.js';
import type { CliIo } from './cli.js';
import type { CommandHelpers } from './portability-commands.js';

const AdapterFlagSchema = z.enum(ADAPTER_NAMES);
const STR_FLAGS = [
  'goal',
  'capability',
  'workspace',
  'id',
  'adapter',
  'resume',
  'budget',
  'closes-issue',
] as const;
const BOOL_FLAGS = ['plan', 'async', 'unlimited'] as const;

/** Required string flag or a thrown usage error. */
function required(value: string | boolean | undefined, flag: string): string {
  if (typeof value !== 'string') throw new Error(`missing required flag ${flag}`);
  return value;
}

/** The `run` command handler (see {@link COMMANDS} in cli.ts). */
export function runCommand(args: string[], io: CliIo, h: CommandHelpers): Promise<number> {
  const v = h.mixedFlags(args, STR_FLAGS, BOOL_FLAGS);
  const [workspace, id, resume] = [h.str(v.workspace), h.str(v.id), h.str(v.resume)];
  // `--resume` replaces `--goal` (the checkpointed task is the truth).
  const goal = resume === undefined ? required(v.goal, '--goal') : h.str(v.goal);
  const adapter = h.str(v.adapter) === undefined ? undefined : AdapterFlagSchema.parse(v.adapter);
  const budget = parseBudget(h.str(v.budget));
  return h.withKernloop(io, v.dir, async (kern) => {
    // One-shot CLI: drain an async run's background settle before tear-down.
    let background: Promise<void> | undefined;
    const result = await withSigintAbort(
      process,
      () => process.exit(130),
      (signal) =>
        runTool(
          kern,
          {
            ...(goal === undefined ? {} : { goal }),
            capability: required(v.capability, '--capability'),
            ...(workspace === undefined ? {} : { workspaceDir: path.resolve(io.cwd, workspace) }),
            ...(v.plan === true ? { execute: false } : {}),
            ...(v.async === true ? { async: true } : {}),
            ...(v.unlimited === true ? { unlimited: true } : {}),
            ...(id === undefined ? {} : { id }),
            ...(adapter === undefined ? {} : { adapter }),
            ...(budget === undefined ? {} : { budget }),
            ...(resume === undefined ? {} : { resume }),
          },
          { onBackground: (settled) => (background = settled), signal },
        ),
    );
    if (background !== undefined) await background;
    // --closes-issue N (#211): on a SUCCESS Outcome, close issue N through the gated
    // tracker (enforce-tier). A non-success run skips it; never auto-merge.
    const closesIssue = h.str(v['closes-issue']);
    if (closesIssue === undefined) return result;
    const succeeded = result.kind === 'outcome' && result.outcome?.status === 'success';
    return { ...result, issueClose: await closeIssueAfterRun(kern, closesIssue, succeeded) };
  });
}
