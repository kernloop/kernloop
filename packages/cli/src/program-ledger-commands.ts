/**
 * The PROGRAM-LEDGER verbs of `kernloop program` (spec §5.4; CLM-0100):
 * `create | status | advance`. Together they persist a decomposed plan to the
 * resumable `.kernloop/programs.sqlite` ledger, report its rollup, and advance
 * one node a single poll-driven step at a time — NO daemon, every op a single
 * CLI invocation. Each op is audited (`cli.program.{create,status,advance}`)
 * with counts/ids only — never the goal verbatim.
 *
 * `create` reuses the EXACT parent/spec derivation of the preview/emit verbs
 * (`buildProgramParent` + `readSpecFile` + `decomposeGoal`), then records each
 * decomposed child as a `planned` ledger node. `status` rolls up the node
 * states. `advance` moves one node forward (`planned → emitted → done`),
 * requiring the filed issue ref to reach `emitted`. The store's typed errors
 * (duplicate / unknown-node / invalid-transition) surface as a clean exit 1.
 *
 * `program emit --program <id>` now AUTO-RECORDS filed refs into the ledger
 * (planned → emitted, #88); `program reconcile` now REALIZES GitHub-state
 * RECONCILIATION (#87, CLM-0102) — reading each emitted node's GitHub issue and
 * advancing it emitted → done when closed (see program-reconcile.ts).
 */
import { appendEvent } from '@kernloop/kernel';
import { decomposeGoal, programLabels } from '@kernloop/faculty-scrum';
import type { CliIo } from './cli.js';
import type { Kernloop } from './kernel.js';
import {
  buildProgramParent,
  checkIdLength,
  isCleanError,
  ProgramInputError,
  readSpecFile,
  taskFromRow,
} from './program-shared.js';
import type { ProgramNodeRow, ProgramNodeState } from './program-store.js';

/** The forward-only target states `program advance` accepts (`planned` is the
 * create-time start, never an advance target). */
const ADVANCE_STATES: readonly ProgramNodeState[] = ['emitted', 'done'];

type Str = (x: string | boolean | undefined) => string | undefined;

/** The printable per-node row (no taskJson/updatedAt — the rollup view). */
function nodeView(node: ProgramNodeRow): {
  nodeId: string;
  goal: string;
  state: ProgramNodeState;
  issueRef: string | null;
} {
  return { nodeId: node.nodeId, goal: node.goal, state: node.state, issueRef: node.issueRef };
}

/** Tally a program's nodes by state for the status rollup. */
function countByState(nodes: readonly ProgramNodeRow[]): {
  planned: number;
  emitted: number;
  done: number;
} {
  const counts = { planned: 0, emitted: 0, done: 0 };
  for (const node of nodes) counts[node.state] += 1;
  return counts;
}

/**
 * Run `program create` [CLM-0100]: build the parent + decompose the spec (the
 * same derivation the preview verb uses), then persist the program and its
 * children as `planned` ledger nodes. Prints `{ op, programId, goal, nodeCount }`
 * and audits `cli.program.create` with counts only (never the goal verbatim).
 * A duplicate id / bad spec / budget breach surfaces as a clean exit 1.
 */
export function createOp(
  kern: Kernloop,
  io: CliIo,
  v: Record<string, string | boolean>,
  str: Str,
): number {
  const goal = str(v.goal);
  const specFile = str(v.spec);
  if (goal === undefined || specFile === undefined) throw new Error(LEDGER_USAGE);
  const id = str(v.id) ?? str(v.parent) ?? 'program-root';
  try {
    checkIdLength(id);
    const specs = readSpecFile(io, specFile);
    const parent = buildProgramParent(kern, id, goal);
    const children = decomposeGoal({ parent, subtasks: specs });
    // Store the program root AS a node (parentId null — the umbrella issue emit
    // files first) and each decomposed child pointing at it, so emit can
    // parents-first body-ref-link the tree (#84). nodeCount stays the
    // decomposition size (the work items), not the +1 umbrella.
    const rootNode = {
      nodeId: parent.id,
      parentId: null,
      goal: parent.goal,
      labels: programLabels(parent.constraints),
      taskJson: JSON.stringify(parent),
    };
    const childNodes = children.map((c) => ({
      nodeId: c.id,
      parentId: parent.id,
      goal: c.goal,
      labels: programLabels(c.constraints),
      taskJson: JSON.stringify(c),
    }));
    kern.programs.createProgram({ programId: id, goal, nodes: [rootNode, ...childNodes] });
    appendEvent(kern.store, {
      type: 'cli.program.create',
      payload: { op: 'create', programId: id, nodeCount: children.length, goalChars: goal.length },
    });
    io.out(
      JSON.stringify({ op: 'create', programId: id, goal, nodeCount: children.length }, null, 2),
    );
    return 0;
  } catch (error) {
    return cleanExit(io, error);
  }
}

/**
 * Run `program decompose-node` [CLM-0114] (#118): load stored node N from program P, run
 * `decomposeGoal` with N's TaskContract as the parent + the spec's subtasks, and
 * insert the children as NEW ledger nodes pointing at N (`parentId = N`) — growing
 * the tree deeper than the one-shot `create`. `decomposeGoal` enforces altitude
 * descent (epic→story→task; a `task` leaf cannot decompose), so depth is bounded.
 * The children are STORED only — a later `program emit` files them, parents-first,
 * body-ref-linking each to N. Re-running on a node that already has these children
 * is a clean error (the store refuses to overwrite). Audited as
 * `cli.program.decompose-node` (counts/ids only).
 *
 * KNOWN EDGE (#118): if N was already EMITTED in a prior run, a later emit files
 * the new children and links them UP to N, but #84's epic-body merge only edits
 * parents filed THIS run — so N's GitHub task-list is not re-edited to show them.
 */
export function decomposeNodeOp(
  kern: Kernloop,
  io: CliIo,
  v: Record<string, string | boolean>,
  str: Str,
): number {
  const programId = str(v.program);
  const nodeId = str(v.node);
  const specFile = str(v.spec);
  if (programId === undefined || nodeId === undefined || specFile === undefined) {
    throw new Error(LEDGER_USAGE);
  }
  try {
    const node = kern.programs.getNode(programId, nodeId);
    if (node === undefined) {
      throw new ProgramInputError(`no node "${nodeId}" in program "${programId}"`);
    }
    const parent = taskFromRow(node.nodeId, node.taskJson);
    const children = decomposeGoal({ parent, subtasks: readSpecFile(io, specFile) });
    kern.programs.addNodes({
      programId,
      nodes: children.map((c) => ({
        nodeId: c.id,
        parentId: node.nodeId,
        goal: c.goal,
        labels: programLabels(c.constraints),
        taskJson: JSON.stringify(c),
      })),
    });
    const summary = {
      op: 'decompose-node',
      programId,
      parentNodeId: nodeId,
      childCount: children.length,
    };
    appendEvent(kern.store, { type: 'cli.program.decompose-node', payload: summary });
    io.out(JSON.stringify(summary, null, 2));
    return 0;
  } catch (error) {
    return cleanExit(io, error);
  }
}

/**
 * Run `program status` [CLM-0100]: resolve the program + its nodes from the
 * ledger and print `{ op, programId, goal, counts, nodes }`. An unknown program
 * is a clean exit 1. Audits `cli.program.status` with the node count only.
 */
export function statusOp(
  kern: Kernloop,
  io: CliIo,
  v: Record<string, string | boolean>,
  str: Str,
): number {
  const programId = str(v.program);
  if (programId === undefined) throw new Error(LEDGER_USAGE);
  try {
    checkIdLength(programId);
    const program = kern.programs.getProgram(programId);
    if (program === undefined) {
      throw new ProgramInputError(`no program "${programId}" in the ledger`);
    }
    const nodes = kern.programs.listNodes(programId);
    appendEvent(kern.store, {
      type: 'cli.program.status',
      payload: { op: 'status', programId, nodeCount: nodes.length },
    });
    io.out(
      JSON.stringify(
        {
          op: 'status',
          programId,
          goal: program.goal,
          counts: countByState(nodes),
          nodes: nodes.map(nodeView),
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (error) {
    return cleanExit(io, error);
  }
}

/**
 * Run `program advance` [CLM-0100]: move one node forward a single step
 * (`planned → emitted → done`), requiring `--ref` to reach `emitted`. Prints
 * the updated node row; audits `cli.program.advance` with `{ programId, nodeId,
 * state, refSupplied }` — never the ref content. The store's typed errors
 * (unknown-node / invalid-transition / emitted-without-ref) are a clean exit 1.
 */
export function advanceOp(
  kern: Kernloop,
  io: CliIo,
  v: Record<string, string | boolean>,
  str: Str,
): number {
  const programId = str(v.program);
  const nodeId = str(v.node);
  const stateRaw = str(v.state);
  if (programId === undefined || nodeId === undefined || stateRaw === undefined) {
    throw new Error(LEDGER_USAGE);
  }
  const ref = str(v.ref);
  try {
    if (!(ADVANCE_STATES as readonly string[]).includes(stateRaw)) {
      throw new ProgramInputError(`--state must be one of: ${ADVANCE_STATES.join(', ')}`);
    }
    const state = stateRaw as ProgramNodeState;
    checkIdLength(programId);
    checkIdLength(nodeId);
    const updated = kern.programs.advanceNode({
      programId,
      nodeId,
      state,
      ...(ref === undefined ? {} : { issueRef: ref }),
    });
    appendEvent(kern.store, {
      type: 'cli.program.advance',
      payload: {
        op: 'advance',
        programId,
        nodeId,
        state,
        refSupplied: ref !== undefined && ref !== '',
      },
    });
    io.out(JSON.stringify({ op: 'advance', node: nodeView(updated) }, null, 2));
    return 0;
  } catch (error) {
    return cleanExit(io, error);
  }
}

/**
 * Run `program list` [CLM-0100]: print the persisted programs (newest first,
 * id + goal + createdAt). Read-only; audits `cli.program.list` with the count.
 */
export function listOp(kern: Kernloop, io: CliIo): number {
  const programs = kern.programs.listPrograms();
  appendEvent(kern.store, {
    type: 'cli.program.list',
    payload: { op: 'list', count: programs.length },
  });
  io.out(
    JSON.stringify(
      {
        op: 'list',
        programs: programs.map((p) => ({
          programId: p.programId,
          goal: p.goal,
          createdAt: p.createdAt,
        })),
      },
      null,
      2,
    ),
  );
  return 0;
}

/** The shared usage line the ledger verbs reject bad input with. */
export const LEDGER_USAGE =
  'usage: kernloop program create --goal G --spec F [--id ID] | list | status --program ID | ' +
  'advance --program ID --node NODE --state emitted|done [--ref URL] | ' +
  'decompose-node --program ID --node NODE --spec F';

/** Surface a store/input error as a clean exit 1, or rethrow an unexpected one. */
function cleanExit(io: CliIo, error: unknown): number {
  if (isCleanError(error)) {
    io.err(JSON.stringify({ error: error.name, message: error.message }, null, 2));
    return 1;
  }
  throw error;
}
