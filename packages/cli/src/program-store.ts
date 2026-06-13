/**
 * The persisted PROGRAM LEDGER (spec §5.4; CLM-0099). A resumable, poll-driven,
 * NO-daemon local record of a decomposed program — a root goal and its story
 * nodes — that advances ONE step per CLI invocation and survives a session
 * reset. Cross-session is by construction: the ledger is a SQLite file
 * (`.kernloop/programs.sqlite`), so a fresh Kernloop over the same overlay
 * resolves a prior program by id (mirroring `jobs.ts`).
 *
 * The CLI is the composition root (spec §9), so it MAY use better-sqlite3
 * directly here, exactly as `jobs.ts` does — no faculty owns this, and no
 * faculty imports another (constitutional rule 5); this is root code.
 *
 * Each node advances FORWARD-ONLY through `planned → emitted → done`: a node
 * is `planned` at create, `emitted` once its issue is filed (carrying the
 * filed issue ref), and `done` once its work lands. A backward move (e.g.
 * `done → planned`) is rejected, so the ledger cannot lie about progress.
 * Timestamps are epoch milliseconds; the clock is injectable so create/advance
 * tests are deterministic. All queries are parameterized — a goal or nodeId is
 * stored as DATA, never interpolated into SQL.
 *
 * `program emit --program <id>` AUTO-RECORDS each filed issue ref here on a real
 * execute (planned → emitted, #88); `program advance` drives out-of-band /
 * `done` transitions. GitHub-state RECONCILIATION is now REALIZED (#87,
 * CLM-0102): `program reconcile` READS each emitted node's GitHub issue via the
 * tracker and advances it emitted → done when the issue is closed — GitHub is
 * the live authority and the ledger is a reconciled cache of it.
 */
import Database from 'better-sqlite3';

/** A node's lifecycle rung — forward-only `planned → emitted → done`. */
export type ProgramNodeState = 'planned' | 'emitted' | 'done';

/** One persisted program (root goal) row. */
export interface ProgramRow {
  readonly programId: string;
  readonly goal: string;
  readonly createdAt: number;
}

/** One persisted program-node row. `labels` is parsed back from `labelsJson`. */
export interface ProgramNodeRow {
  readonly programId: string;
  readonly nodeId: string;
  readonly goal: string;
  readonly labels: string[];
  readonly taskJson: string;
  readonly state: ProgramNodeState;
  readonly issueRef: string | null;
  readonly updatedAt: number;
}

/** Fields {@link ProgramStore.createProgram} requires — a program + its nodes. */
export interface CreateProgramInput {
  readonly programId: string;
  readonly goal: string;
  readonly nodes: ReadonlyArray<{
    readonly nodeId: string;
    readonly goal: string;
    readonly labels: string[];
    readonly taskJson: string;
  }>;
}

/** Fields {@link ProgramStore.advanceNode} requires — the forward move + ref. */
export interface AdvanceNodeInput {
  readonly programId: string;
  readonly nodeId: string;
  readonly state: ProgramNodeState;
  readonly issueRef?: string;
}

/** The program-ledger API over one overlay's `programs.sqlite`. */
export interface ProgramStore {
  /** Insert the program + all nodes (at `planned`) in ONE transaction. Throws
   * {@link DuplicateProgramError} if the program id already exists. */
  createProgram(input: CreateProgramInput): ProgramRow;
  /** One program by id, or `undefined` when absent — never invented. */
  getProgram(programId: string): ProgramRow | undefined;
  /** Programs newest-first, capped at `limit` (default {@link DEFAULT_PROGRAM_LIMIT}). */
  listPrograms(options?: { limit?: number }): ProgramRow[];
  /** A program's nodes in `nodeId` order (labels parsed back to string[]). */
  listNodes(programId: string): ProgramNodeRow[];
  /** Advance one node forward (+ issueRef), stamping `updatedAt`. Throws
   * {@link UnknownProgramNodeError} / {@link InvalidNodeTransitionError}. */
  advanceNode(input: AdvanceNodeInput): ProgramNodeRow;
  /** Close the underlying database handle. */
  close(): void;
}

/** Default number of rows {@link ProgramStore.listPrograms} returns. */
export const DEFAULT_PROGRAM_LIMIT = 20;

/** Inserting a program whose id already exists — no silent overwrite. */
export class DuplicateProgramError extends Error {
  constructor(programId: string) {
    super(`program "${programId}" already exists — refusing to overwrite`);
    this.name = 'DuplicateProgramError';
  }
}

/** Advancing a (programId, nodeId) the ledger does not hold — never invented. */
export class UnknownProgramNodeError extends Error {
  constructor(programId: string, nodeId: string) {
    super(`no node "${nodeId}" in program "${programId}"`);
    this.name = 'UnknownProgramNodeError';
  }
}

/** A backward or otherwise-illegal node transition (the ledger is forward-only). */
export class InvalidNodeTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNodeTransitionError';
  }
}

/** Forward-only rung order; an advance moves exactly one rung forward. */
const STATE_ORDER: readonly ProgramNodeState[] = ['planned', 'emitted', 'done'];

/** Max length of an issue ref (it is stored + printed in `status`). */
const REF_MAX = 512;

/**
 * The program-ledger schema. Two idempotent `CREATE TABLE IF NOT EXISTS`
 * tables, so deleting the file and reopening yields a functional empty ledger
 * and reopening an existing file preserves state (mirrors `jobs.ts`).
 */
export const PROGRAMS_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS programs (
  programId TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS program_nodes (
  programId TEXT NOT NULL,
  nodeId TEXT NOT NULL,
  goal TEXT NOT NULL,
  labelsJson TEXT NOT NULL,
  taskJson TEXT NOT NULL,
  state TEXT NOT NULL,
  issueRef TEXT,
  updatedAt INTEGER NOT NULL,
  PRIMARY KEY (programId, nodeId)
);
`;

/** Map a raw program row to a typed {@link ProgramRow}. */
function toProgramRow(row: { programId: string; goal: string; createdAt: number }): ProgramRow {
  return { programId: row.programId, goal: row.goal, createdAt: row.createdAt };
}

/** Map a raw node row to a typed {@link ProgramNodeRow} (labelsJson → string[]). */
function toNodeRow(row: {
  programId: string;
  nodeId: string;
  goal: string;
  labelsJson: string;
  taskJson: string;
  state: string;
  issueRef: string | null;
  updatedAt: number;
}): ProgramNodeRow {
  return {
    programId: row.programId,
    nodeId: row.nodeId,
    goal: row.goal,
    labels: JSON.parse(row.labelsJson) as string[],
    taskJson: row.taskJson,
    state: row.state as ProgramNodeState,
    issueRef: row.issueRef,
    updatedAt: row.updatedAt,
  };
}

/** Validate the trimmed issue ref's shape (length, no control chars, https-only
 * if it is a URL), or throw. A bare ref (e.g. an issue number `42`) is allowed. */
function validateRefShape(ref: string): void {
  if (ref.length > REF_MAX) {
    throw new InvalidNodeTransitionError(`issue ref exceeds ${String(REF_MAX)} chars`);
  }
  if (/[\u0000-\u001f\u007f]/.test(ref)) {
    throw new InvalidNodeTransitionError('issue ref contains control characters');
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref) && !/^https:\/\//i.test(ref)) {
    throw new InvalidNodeTransitionError(
      `issue ref "${ref}" is a URL but not https:// — refusing a non-https issue ref`,
    );
  }
}

/**
 * Validate a forward move is legal, returning the (clean) issueRef to persist.
 * The ledger advances ONE rung at a time (planned → emitted → done): skipping a
 * rung (planned → done) is rejected, so a node can never reach `done` without
 * having been `emitted` with a filed ref — the ledger cannot lie about progress.
 */
function validateTransition(
  from: ProgramNodeState,
  to: ProgramNodeState,
  issueRef: string | undefined,
): string | null {
  const fromIdx = STATE_ORDER.indexOf(from);
  const toIdx = STATE_ORDER.indexOf(to);
  if (toIdx !== fromIdx + 1) {
    throw new InvalidNodeTransitionError(
      `cannot move node from "${from}" to "${to}" — advance one rung forward at a time (planned → emitted → done)`,
    );
  }
  const ref = issueRef?.trim();
  if (ref !== undefined && ref !== '') validateRefShape(ref);
  if (to === 'emitted') {
    if (ref === undefined || ref === '') {
      throw new InvalidNodeTransitionError(
        'advancing a node to "emitted" requires a non-empty --ref (the filed issue ref)',
      );
    }
    return ref;
  }
  // Advancing to `done` (from `emitted`) may carry a new ref (e.g. a PR) or keep the prior one.
  return ref === undefined || ref === '' ? null : ref;
}

/** The point reads + the create transaction over one open DB handle. */
interface StoreInternals {
  getProgram(programId: string): ProgramRow | undefined;
  getNode(programId: string, nodeId: string): ProgramNodeRow | undefined;
  createTxn(input: CreateProgramInput, ts: number): void;
}

/** Build the prepared reads + the create transaction (keeps the API assembly lean). */
function buildInternals(db: Database.Database): StoreInternals {
  const insertNode = db.prepare(
    'INSERT INTO program_nodes (programId, nodeId, goal, labelsJson, taskJson, state, issueRef, updatedAt) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  return {
    getProgram: (programId) => {
      const row = db.prepare('SELECT * FROM programs WHERE programId = ?').get(programId);
      return row === undefined
        ? undefined
        : toProgramRow(row as Parameters<typeof toProgramRow>[0]);
    },
    getNode: (programId, nodeId) => {
      const row = db
        .prepare('SELECT * FROM program_nodes WHERE programId = ? AND nodeId = ?')
        .get(programId, nodeId);
      return row === undefined ? undefined : toNodeRow(row as Parameters<typeof toNodeRow>[0]);
    },
    createTxn: db.transaction((input: CreateProgramInput, ts: number) => {
      db.prepare('INSERT INTO programs (programId, goal, createdAt) VALUES (?, ?, ?)').run(
        input.programId,
        input.goal,
        ts,
      );
      for (const node of input.nodes) {
        insertNode.run(
          input.programId,
          node.nodeId,
          node.goal,
          JSON.stringify(node.labels),
          node.taskJson,
          'planned',
          null,
          ts,
        );
      }
    }),
  };
}

/**
 * Open (creating and migrating if absent) the program ledger at `dbPath` and
 * return its API (CLM-0099). `clock` returns epoch ms (default `Date.now`),
 * injected so createdAt/updatedAt are deterministic under test. All writes are
 * parameterized; `createProgram` is one transaction; `advanceNode` is
 * forward-only and requires the filed issue ref to reach `emitted`.
 */
export function createProgramStore(
  dbPath: string,
  options: { clock?: () => number } = {},
): ProgramStore {
  const clock = options.clock ?? Date.now;
  const db = new Database(dbPath);
  db.exec(PROGRAMS_SCHEMA_DDL);
  const { getProgram, getNode, createTxn } = buildInternals(db);
  return {
    createProgram: (input) => {
      if (getProgram(input.programId) !== undefined) {
        throw new DuplicateProgramError(input.programId);
      }
      const ts = clock();
      createTxn(input, ts);
      const row = getProgram(input.programId);
      if (row === undefined) throw new Error(`program "${input.programId}" vanished after insert`);
      return row;
    },
    getProgram,
    listPrograms: (opts) => {
      const limit = opts?.limit ?? DEFAULT_PROGRAM_LIMIT;
      const rows = db
        .prepare('SELECT * FROM programs ORDER BY createdAt DESC, programId DESC LIMIT ?')
        .all(limit);
      return rows.map((r) => toProgramRow(r as Parameters<typeof toProgramRow>[0]));
    },
    listNodes: (programId) => {
      const rows = db
        .prepare('SELECT * FROM program_nodes WHERE programId = ? ORDER BY nodeId ASC')
        .all(programId);
      return rows.map((r) => toNodeRow(r as Parameters<typeof toNodeRow>[0]));
    },
    advanceNode: (input) => {
      const current = getNode(input.programId, input.nodeId);
      if (current === undefined) {
        throw new UnknownProgramNodeError(input.programId, input.nodeId);
      }
      const ref = validateTransition(current.state, input.state, input.issueRef);
      const updatedAt = clock();
      db.prepare(
        'UPDATE program_nodes SET state = ?, issueRef = ?, updatedAt = ? WHERE programId = ? AND nodeId = ?',
      ).run(input.state, ref ?? current.issueRef, updatedAt, input.programId, input.nodeId);
      const row = getNode(input.programId, input.nodeId);
      if (row === undefined) throw new Error(`node "${input.nodeId}" vanished after update`);
      return row;
    },
    close: () => db.close(),
  };
}
