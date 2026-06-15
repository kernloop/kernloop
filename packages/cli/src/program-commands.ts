/**
 * The `kernloop program` CLI surface (spec §5.4). A CLI VERB, NOT a 12th MCP
 * tool: `program decompose|author|emit`.
 *
 * `author` [CLM-0103] is `decompose` with the story specs PROPOSED BY A MODEL
 * (suggest-tier) instead of read from `--spec`: it invokes the chosen adapter
 * for a JSON array of story specs, parses it robustly, and runs it through the
 * same `decomposeGoal` — the model proposes, the faculty enforces, the human
 * ratifies; it mutates nothing (see program-author.ts).
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
 * `emit` [CLM-0098] FILES each child as a labeled GitHub issue through the
 * hardened @kernloop/tracker — dry-run-first, enforce-tier-gated,
 * issue-spam-guarded, audited. Two mutually-exclusive modes: ad-hoc
 * `--goal/--spec` re-decomposes and files (see program-emit.ts); ledger-driven
 * `--program <id>` files a persisted program's planned nodes and AUTO-RECORDS
 * each filed ref into the ledger (see program-emit-ledger.ts, #88).
 *
 * `reconcile` [CLM-0102] READS each `emitted` node's GitHub issue via the
 * tracker and, GitHub being authoritative, advances the node `emitted → done`
 * when its issue is closed (see program-reconcile.ts, #87) — the gh READ runs
 * at any tier (a read is not a mutation), dry-run-default, audited; only the
 * LOCAL ledger write is `--execute`-gated.
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
import type { LoopInvoke } from './loop/invoke.js';
import { buildProgramParent, checkIdLength, isCleanError, readSpecFile } from './program-shared.js';
import { authorOp } from './program-author.js';
import { emitOp } from './program-emit.js';
import {
  advanceOp,
  createOp,
  decomposeNodeOp,
  listOp,
  statusOp,
} from './program-ledger-commands.js';
import { reconcileOp } from './program-reconcile.js';
import { closeOp } from './program-close.js';

export { ProgramInputError } from './program-shared.js';

/** The program verbs this surface exposes (decompose=inc1, emit=inc2, the
 * ledger verbs create|list|status|advance=inc3, reconcile=#87). */
export const PROGRAM_OPS = [
  'decompose',
  'decompose-node',
  'author',
  'emit',
  'create',
  'list',
  'status',
  'advance',
  'reconcile',
  'close',
] as const;

/** The shared usage line every program entry point rejects bad input with. */
const PROGRAM_USAGE =
  'usage: kernloop program decompose --goal G --spec F [--parent ID] [--id ID]\n' +
  '       kernloop program author --goal G [--id ID] [--adapter A]\n' +
  '       kernloop program emit (--goal G --spec F [--id ID] | --program ID) [--execute] [--confirm-count N]\n' +
  '       kernloop program create --goal G --spec F [--id ID] | list | status --program ID | advance --program ID --node NODE --state emitted|done [--ref URL]\n' +
  '       kernloop program decompose-node --program ID --node NODE --spec F\n' +
  '       kernloop program reconcile --program ID [--execute]\n' +
  '       kernloop program close --program ID [--node NODE] [--reason completed|"not planned"] [--execute]';

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

/** Run `program reconcile`: extract `--program`/`--execute`, reconcile against
 * GitHub, surface a typed input error as a clean exit 1 (never an unhandled
 * throw). The gh READ runs at any tier; only the ledger write is --execute-gated. */
async function reconcileForOp(
  kern: Kernloop,
  io: CliIo,
  v: Record<string, string | boolean>,
  str: (x: string | boolean | undefined) => string | undefined,
  exec: TrackerExec | undefined,
): Promise<number> {
  const programId = str(v.program);
  if (programId === undefined) throw new Error(PROGRAM_USAGE);
  try {
    return await reconcileOp(kern, io, programId, v.execute === true, exec);
  } catch (error) {
    if (isCleanError(error)) {
      io.err(JSON.stringify({ error: error.name, message: error.message }, null, 2));
      return 1;
    }
    throw error;
  }
}

/** Run `program close`: close the GitHub issues of `done` ledger nodes, tier-gated
 * + audited (#50). The gh READ runs at any tier; the CLOSE is --execute + enforce
 * gated. A typed input error becomes a clean exit 1, never an unhandled throw. */
async function closeForOp(
  kern: Kernloop,
  io: CliIo,
  v: Record<string, string | boolean>,
  str: (x: string | boolean | undefined) => string | undefined,
  exec: TrackerExec | undefined,
): Promise<number> {
  const programId = str(v.program);
  if (programId === undefined) throw new Error(PROGRAM_USAGE);
  const opts = {
    ...(str(v.node) === undefined ? {} : { node: str(v.node) as string }),
    closeReason: str(v.reason) ?? 'completed',
    executeFlag: v.execute === true,
  };
  try {
    return await closeOp(kern, io, programId, opts, exec);
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
 * daemon) — each op audited without the goal verbatim. `reconcile` [CLM-0102]
 * reads each emitted node's GitHub issue and advances it `emitted → done` when
 * the issue is closed (the read runs at any tier; only the ledger write is
 * --execute-gated). `close` [CLM-0116] is its ledger-authoritative inverse:
 * it closes the GitHub issues of nodes the ledger already holds in `done` state
 * (read at any tier; the close double-gated by --execute + enforce; never
 * auto-merge). `author` [CLM-0103] invokes a model to PROPOSE the story
 * specs and runs them through the same `decomposeGoal` (suggest-tier, mutating
 * nothing). `options.exec` is the tracker test seam; `options.invoke` is the
 * model seam author threads to the adapter (tests script it).
 */
export async function programCommand(
  args: string[],
  io: CliIo,
  h: CommandHelpers,
  options: { exec?: TrackerExec; invoke?: LoopInvoke } = {},
): Promise<number> {
  const [op, ...rest] = args;
  if (op === undefined || !(PROGRAM_OPS as readonly string[]).includes(op)) {
    throw new Error(PROGRAM_USAGE);
  }
  const v = h.mixedFlags(
    rest,
    [
      'goal',
      'spec',
      'parent',
      'id',
      'adapter',
      'confirm-count',
      'program',
      'node',
      'state',
      'ref',
      'reason',
    ],
    ['execute'],
  );
  const kern = createKernloop({
    overlayDir: path.join(path.resolve(io.cwd, h.str(v.dir) ?? '.'), '.kernloop'),
  });
  try {
    if (op === 'author') return await authorOp(kern, io, v, h.str, options.invoke);
    if (op === 'emit') return await emitOp(kern, io, v, h.str, options.exec);
    if (op === 'create') return createOp(kern, io, v, h.str);
    if (op === 'list') return listOp(kern, io);
    if (op === 'status') return statusOp(kern, io, v, h.str);
    if (op === 'advance') return advanceOp(kern, io, v, h.str);
    if (op === 'decompose-node') return decomposeNodeOp(kern, io, v, h.str);
    if (op === 'reconcile') return await reconcileForOp(kern, io, v, h.str, options.exec);
    if (op === 'close') return await closeForOp(kern, io, v, h.str, options.exec);
    return decomposeOp(kern, io, v, h.str);
  } finally {
    kern.close();
  }
}
