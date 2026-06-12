/**
 * The `kernloop program` CLI surface (spec §5.4). A CLI VERB, NOT a 12th MCP
 * tool: `program decompose|emit`.
 *
 * `decompose` [CLM-0096] is the wiring-complete bridge from the scrum faculty's
 * pure `decomposeGoal` to a real entry point, and it is a DRY-RUN PREVIEW: it
 * NEVER mutates anything — no GitHub, no DB writes beyond a single audit event.
 * It builds a parent program TaskContract from `--goal` (id from
 * `--parent`/`--id` or a stable default, budget from the overlay), reads an
 * array of story specs from `--spec <file>`, calls `decomposeGoal`, and prints
 * the proposed epic/story child TaskContract tree as JSON. The op is audited as
 * `cli.program.decompose` with `{ op, parentId, childCount, goalChars }` —
 * never the goal or spec verbatim.
 *
 * `emit` [CLM-0097] re-decomposes the same tree and FILES each child as a
 * labeled GitHub issue through the hardened @kernloop/tracker — dry-run-first,
 * enforce-tier-gated, issue-spam-guarded, audited (see program-emit.ts).
 *
 * Typed faculty/input errors surface as a clean nonzero exit with a clear
 * message, never an unhandled throw.
 */
import path from 'node:path';
import { appendEvent } from '@kernloop/kernel';
import { decomposeGoal } from '@kernloop/faculty-scrum';
import type { TrackerExec } from '@kernloop/tracker';
import type { CliIo } from './cli.js';
import { createKernloop, type Kernloop } from './kernel.js';
import type { CommandHelpers } from './portability-commands.js';
import { buildProgramParent, checkIdLength, isCleanError, readSpecFile } from './program-shared.js';
import { emitOp } from './program-emit.js';
import { advanceOp, createOp, listOp, statusOp } from './program-ledger-commands.js';

export { ProgramInputError } from './program-shared.js';

/** The program verbs this surface exposes (decompose=inc1, emit=inc2, the
 * ledger verbs create|list|status|advance=inc3). */
export const PROGRAM_OPS = ['decompose', 'emit', 'create', 'list', 'status', 'advance'] as const;

/** The shared usage line every program entry point rejects bad input with. */
const PROGRAM_USAGE =
  'usage: kernloop program decompose|emit --goal G --spec F [--parent ID] [--id ID] [--execute] [--confirm-count N]\n' +
  '       kernloop program create --goal G --spec F [--id ID] | status --program ID | advance --program ID --node NODE --state emitted|done [--ref URL]';

/** Run `program decompose`: build the parent, decompose, print the tree, audit. */
function decomposeOp(
  kern: Kernloop,
  io: CliIo,
  v: Record<string, string | boolean>,
  str: (x: string | boolean | undefined) => string | undefined,
): number {
  const goal = str(v.goal);
  const specFile = str(v.spec);
  if (goal === undefined || specFile === undefined) throw new Error(PROGRAM_USAGE);
  const id = str(v.id) ?? str(v.parent) ?? 'program-root';
  try {
    checkIdLength(id);
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
 * `kernloop program <op> ...` — the program decomposition, emission, and LEDGER
 * CLI. `decompose` [CLM-0096] prints the proposed epic/story child tree (a pure
 * preview, no GitHub). `emit` [CLM-0097] files each child as a labeled GitHub
 * issue through the gated tracker (dry-run by default; enforce-tier + --execute
 * to act; issue-spam-guarded). The LEDGER verbs [CLM-0100] `create|status|advance`
 * persist a decomposed plan to the resumable `.kernloop/programs.sqlite` ledger,
 * report its rollup, and advance a node one poll-driven step at a time (no
 * daemon) — each op audited without the goal verbatim. `options.exec` is the
 * tracker test seam.
 */
export async function programCommand(
  args: string[],
  io: CliIo,
  h: CommandHelpers,
  options: { exec?: TrackerExec } = {},
): Promise<number> {
  const [op, ...rest] = args;
  if (op === undefined || !(PROGRAM_OPS as readonly string[]).includes(op)) {
    throw new Error(PROGRAM_USAGE);
  }
  const v = h.mixedFlags(
    rest,
    ['goal', 'spec', 'parent', 'id', 'confirm-count', 'program', 'node', 'state', 'ref'],
    ['execute'],
  );
  const kern = createKernloop({
    overlayDir: path.join(path.resolve(io.cwd, h.str(v.dir) ?? '.'), '.kernloop'),
  });
  try {
    if (op === 'emit') return await emitOp(kern, io, v, h.str, options.exec);
    if (op === 'create') return createOp(kern, io, v, h.str);
    if (op === 'list') return listOp(kern, io);
    if (op === 'status') return statusOp(kern, io, v, h.str);
    if (op === 'advance') return advanceOp(kern, io, v, h.str);
    return decomposeOp(kern, io, v, h.str);
  } finally {
    kern.close();
  }
}
