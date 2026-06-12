/**
 * The `kernloop program` CLI surface (spec §5.4) [CLM-0096]. A CLI VERB, NOT a
 * 12th MCP tool: `program decompose`. It is the wiring-complete bridge from the
 * scrum faculty's pure `decomposeGoal` to a real entry point, and it is a
 * DRY-RUN PREVIEW: it NEVER mutates anything — no GitHub, no DB writes beyond a
 * single audit event. It builds a parent program TaskContract from `--goal`
 * (id from `--parent`/`--id` or a stable default, budget from the overlay),
 * reads an array of story specs from `--spec <file>`, calls `decomposeGoal`,
 * and prints the proposed epic/story child TaskContract tree as JSON. The op is
 * audited as `cli.program.decompose` with `{ op, parentId, childCount,
 * goalChars }` — never the goal or spec verbatim. Typed faculty errors (a bad
 * spec file, a budget breach, an invalid altitude) surface as a clean nonzero
 * exit with a clear message, never an unhandled throw.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { appendEvent } from '@kernloop/kernel';
import { TaskContractSchema, type TaskContract } from '@kernloop/contracts';
import {
  decomposeGoal,
  InvalidParentError,
  InvalidStorySpecError,
  ScrumBudgetExceededError,
  type StorySpec,
} from '@kernloop/faculty-scrum';
import type { CliIo } from './cli.js';
import { createKernloop, type Kernloop } from './kernel.js';
import type { CommandHelpers } from './portability-commands.js';

/** The program verbs this surface exposes (decompose is increment 1). */
export const PROGRAM_OPS = ['decompose'] as const;

/** Max length of a `--id`/`--parent` value (it is audited verbatim as parentId). */
const ID_MAX = 256;
/** Max `--spec` file size in bytes — bounds the in-memory read (a story-spec
 * array is small; a multi-MB file is a mistake, not a program plan). */
const SPEC_MAX_BYTES = 1_048_576;

/** A bad `--id`/`--spec` input (missing/oversize/malformed/non-array) — surfaced
 * as a clean nonzero exit, never an unhandled throw. */
export class ProgramInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgramInputError';
  }
}

/** The typed errors `decompose` surfaces as a clean nonzero exit (faculty + input). */
function isCleanError(error: unknown): error is Error {
  return (
    error instanceof ScrumBudgetExceededError ||
    error instanceof InvalidParentError ||
    error instanceof InvalidStorySpecError ||
    error instanceof ProgramInputError
  );
}

/** Build the parent program TaskContract from the goal + overlay defaults. */
function buildProgramParent(kern: Kernloop, id: string, goal: string): TaskContract {
  return TaskContractSchema.parse({
    id,
    goal,
    constraints: [],
    budget: kern.config.budgets,
    evidence: [],
    definitionOfDone: [],
    // Program decomposition is a suggest-tier preview; children clamp to suggest.
    authorityCeiling: 'suggest',
    overlay: kern.config.id,
  });
}

/** Read + JSON.parse the `--spec` file (size-gated), requiring a top-level
 * array. Every failure (missing/oversize/unreadable/malformed/non-array) is a
 * typed {@link ProgramInputError} so the caller surfaces a clean exit, never a
 * raw fs/JSON throw — honoring this module's errors-as-clean-exit contract. */
function readSpecFile(io: CliIo, file: string): StorySpec[] {
  const resolved = path.resolve(io.cwd, file);
  let text: string;
  try {
    const size = statSync(resolved).size;
    if (size > SPEC_MAX_BYTES) {
      throw new ProgramInputError(
        `--spec file is ${String(size)} bytes (max ${String(SPEC_MAX_BYTES)})`,
      );
    }
    text = readFileSync(resolved, 'utf8');
  } catch (error) {
    if (error instanceof ProgramInputError) throw error;
    throw new ProgramInputError(
      `--spec file could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ProgramInputError(
      `--spec file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new ProgramInputError(
      `--spec file must be a JSON array of story specs (got ${typeof parsed})`,
    );
  }
  return parsed as StorySpec[];
}

/** Run `program decompose`: build the parent, decompose, print the tree, audit. */
function decomposeOp(
  kern: Kernloop,
  io: CliIo,
  v: Record<string, string | boolean>,
  str: (x: string | boolean | undefined) => string | undefined,
): number {
  const goal = str(v.goal);
  const specFile = str(v.spec);
  if (goal === undefined || specFile === undefined) {
    throw new Error('usage: kernloop program decompose --goal G --spec F [--parent ID] [--id ID]');
  }
  const id = str(v.id) ?? str(v.parent) ?? 'program-root';
  try {
    if (id.length > ID_MAX) {
      throw new ProgramInputError(
        `--id/--parent is too long (${String(id.length)} > ${String(ID_MAX)})`,
      );
    }
    const specs = readSpecFile(io, specFile);
    const parent = buildProgramParent(kern, id, goal);
    const children = decomposeGoal({ parent, subtasks: specs });
    appendEvent(kern.store, {
      type: 'cli.program.decompose',
      payload: {
        op: 'decompose',
        parentId: id,
        childCount: children.length,
        goalChars: goal.length,
      },
    });
    io.out(JSON.stringify({ op: 'decompose', parent, children }, null, 2));
    return 0;
  } catch (error) {
    if (isCleanError(error)) {
      io.err(JSON.stringify({ error: error.name, message: error.message }, null, 2));
      return 1;
    }
    throw error;
  }
}

/**
 * `kernloop program <op> ...` — the suggest-tier program decomposition CLI
 * [CLM-0096]. `decompose` builds a parent program TaskContract, reads the story
 * specs from `--spec`, and prints the proposed epic/story child tree. It is a
 * pure preview: it never mutates anything (no GitHub) and writes only the
 * `cli.program.decompose` audit event (goalChars, never the goal verbatim).
 */
export async function programCommand(
  args: string[],
  io: CliIo,
  h: CommandHelpers,
): Promise<number> {
  const [op, ...rest] = args;
  if (op === undefined || !(PROGRAM_OPS as readonly string[]).includes(op)) {
    throw new Error('usage: kernloop program decompose --goal G --spec F [--parent ID] [--id ID]');
  }
  const v = h.mixedFlags(rest, ['goal', 'spec', 'parent', 'id'], []);
  const kern = createKernloop({
    overlayDir: path.join(path.resolve(io.cwd, h.str(v.dir) ?? '.'), '.kernloop'),
  });
  try {
    return decomposeOp(kern, io, v, h.str);
  } finally {
    kern.close();
  }
}
