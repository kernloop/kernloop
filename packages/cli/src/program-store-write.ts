/**
 * The `addNodes` write path for the program ledger (#118) — appends NEW child
 * nodes to an EXISTING program so `decompose-node` can grow the tree deeper.
 * Extracted from program-store.ts to keep that file within its LOC budget; it
 * shares the same open DB handle and reads.
 */
import type Database from 'better-sqlite3';
import type { AddNodesInput, ProgramNodeRow } from './program-store.js';
import {
  DuplicateProgramNodeError,
  UnknownProgramError,
  UnknownProgramNodeError,
} from './program-store-errors.js';

/** The reads {@link makeAddNodes} needs to validate the program + return rows. */
export interface LedgerReads {
  getProgram(programId: string): unknown;
  getNode(programId: string, nodeId: string): ProgramNodeRow | undefined;
}

/** No-orphan guard (#202): every non-null `parentId` must reference a node that
 * already exists OR is inserted in this same batch. */
function assertParentsResolve(
  reads: LedgerReads,
  programId: string,
  nodes: AddNodesInput['nodes'],
): void {
  const batch = new Set(nodes.map((n) => n.nodeId));
  for (const n of nodes) {
    if (
      n.parentId !== null &&
      !batch.has(n.parentId) &&
      reads.getNode(programId, n.parentId) === undefined
    ) {
      throw new UnknownProgramNodeError(programId, n.parentId);
    }
  }
}

/**
 * Build the `addNodes` operation over one open DB handle: insert each new child
 * (at `planned`) in ONE transaction, rejecting a node-id collision (no silent
 * overwrite) and a missing program. Returns the inserted rows.
 */
export function makeAddNodes(
  db: Database.Database,
  reads: LedgerReads,
  clock: () => number,
): (input: AddNodesInput) => ProgramNodeRow[] {
  const insertNode = db.prepare(
    'INSERT INTO program_nodes (programId, nodeId, parentId, goal, labelsJson, taskJson, state, issueRef, updatedAt) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const exists = db.prepare('SELECT 1 FROM program_nodes WHERE programId = ? AND nodeId = ?');
  const addNodesTxn = db.transaction((input: AddNodesInput, ts: number) => {
    for (const node of input.nodes) {
      if (exists.get(input.programId, node.nodeId) !== undefined) {
        throw new DuplicateProgramNodeError(input.programId, node.nodeId);
      }
      insertNode.run(
        input.programId,
        node.nodeId,
        node.parentId,
        node.goal,
        JSON.stringify(node.labels),
        node.taskJson,
        'planned',
        null,
        ts,
      );
    }
  });
  return (input) => {
    if (reads.getProgram(input.programId) === undefined) {
      throw new UnknownProgramError(input.programId);
    }
    assertParentsResolve(reads, input.programId, input.nodes);
    const ts = clock();
    addNodesTxn(input, ts);
    return input.nodes.map((n) => {
      const row = reads.getNode(input.programId, n.nodeId);
      if (row === undefined) throw new Error(`node "${n.nodeId}" vanished after insert`);
      return row;
    });
  };
}
