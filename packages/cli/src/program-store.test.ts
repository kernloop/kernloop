/**
 * Unit tests for the persisted program ledger [CLM-0099]: create persists the
 * program + its nodes at `planned`; a FRESH handle over the same file resolves
 * a prior program (cross-session, file-backed); a duplicate id is refused;
 * advanceNode is forward-only (`planned → emitted → done`), requires the issue
 * ref to reach `emitted`, rejects an unknown node and a backward move; listNodes
 * parses labels back in order; and a SQL-injection-shaped goal/nodeId is stored
 * as DATA (parameterized), never executed.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DuplicateProgramError,
  InvalidNodeTransitionError,
  UnknownProgramNodeError,
  createProgramStore,
  type ProgramStore,
} from './program-store.js';

const dirs: string[] = [];
function freshDbPath(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-programs-'));
  dirs.push(dir);
  return path.join(dir, 'programs.sqlite');
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A monotonic injected clock so createdAt/updatedAt are deterministic. */
function tickingClock(start = 1_000): () => number {
  let t = start;
  return () => (t += 1);
}

/** Two `planned` nodes for a freshly-created program (both roots here; the
 * parentId round-trip is covered by its own test). */
const NODES = [
  {
    nodeId: 'p.1',
    parentId: null,
    goal: 'Build login',
    labels: ['altitude:story', 'agent:coder'],
    taskJson: '{"id":"p.1"}',
  },
  {
    nodeId: 'p.2',
    parentId: null,
    goal: 'Build logout',
    labels: ['altitude:story'],
    taskJson: '{"id":"p.2"}',
  },
];

function seed(store: ProgramStore, programId = 'p'): void {
  store.createProgram({ programId, goal: 'Ship auth', nodes: NODES });
}

describe('program ledger store', () => {
  it('persists the program + all nodes at the planned state', () => {
    const store = createProgramStore(freshDbPath(), { clock: tickingClock() });
    const program = store.createProgram({ programId: 'p', goal: 'Ship auth', nodes: NODES });
    expect(program.goal).toBe('Ship auth');
    const nodes = store.listNodes('p');
    expect(nodes.map((n) => n.nodeId)).toEqual(['p.1', 'p.2']);
    expect(nodes.every((n) => n.state === 'planned')).toBe(true);
    expect(nodes.every((n) => n.issueRef === null)).toBe(true);
    store.close();
  });

  it('round-trips a node parentId (the tree edge), null for a root', () => {
    const store = createProgramStore(freshDbPath(), { clock: tickingClock() });
    store.createProgram({
      programId: 'p',
      goal: 'Ship auth',
      nodes: [
        { nodeId: 'p', parentId: null, goal: 'Ship auth', labels: [], taskJson: '{"id":"p"}' },
        {
          nodeId: 'p.1',
          parentId: 'p',
          goal: 'Build login',
          labels: ['altitude:story'],
          taskJson: '{"id":"p.1"}',
        },
      ],
    });
    const byId = Object.fromEntries(store.listNodes('p').map((n) => [n.nodeId, n]));
    expect(byId['p']?.parentId).toBeNull();
    expect(byId['p.1']?.parentId).toBe('p');
    store.close();
  });

  it('migrates a pre-parentId ledger: ALTER adds the column, reads back null', () => {
    const dbPath = freshDbPath();
    // Hand-build the ORIGINAL schema (no parentId column) and seed a node.
    const legacy = new Database(dbPath);
    legacy.exec(
      'CREATE TABLE programs (programId TEXT PRIMARY KEY, goal TEXT NOT NULL, createdAt INTEGER NOT NULL);' +
        'CREATE TABLE program_nodes (programId TEXT NOT NULL, nodeId TEXT NOT NULL, goal TEXT NOT NULL, ' +
        'labelsJson TEXT NOT NULL, taskJson TEXT NOT NULL, state TEXT NOT NULL, issueRef TEXT, ' +
        'updatedAt INTEGER NOT NULL, PRIMARY KEY (programId, nodeId));',
    );
    legacy.prepare('INSERT INTO programs VALUES (?, ?, ?)').run('p', 'Ship auth', 1);
    legacy
      .prepare(
        'INSERT INTO program_nodes (programId, nodeId, goal, labelsJson, taskJson, state, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('p', 'p.1', 'Build login', '[]', '{"id":"p.1"}', 'planned', 1);
    legacy.close();
    // Reopening through the store migrates the table; the legacy node reads back
    // with parentId null and the ledger stays functional.
    const store = createProgramStore(dbPath);
    const nodes = store.listNodes('p');
    expect(nodes.map((n) => n.nodeId)).toEqual(['p.1']);
    expect(nodes[0]?.parentId).toBeNull();
    store.close();
  });

  it('resolves a program written by a prior handle from a FRESH handle (cross-session)', () => {
    const dbPath = freshDbPath();
    const first = createProgramStore(dbPath, { clock: tickingClock() });
    seed(first);
    first.close();
    // A separate process is modeled by a separate store over the same file.
    const second = createProgramStore(dbPath);
    expect(second.getProgram('p')?.goal).toBe('Ship auth');
    expect(second.listNodes('p').map((n) => n.nodeId)).toEqual(['p.1', 'p.2']);
    second.close();
  });

  it('reports an absent program as undefined — never invented', () => {
    const store = createProgramStore(freshDbPath());
    expect(store.getProgram('nope')).toBeUndefined();
    expect(store.listNodes('nope')).toEqual([]);
    store.close();
  });

  it('refuses a duplicate program id with DuplicateProgramError (no silent overwrite)', () => {
    const store = createProgramStore(freshDbPath(), { clock: tickingClock() });
    seed(store);
    expect(() => store.createProgram({ programId: 'p', goal: 'other', nodes: [] })).toThrow(
      DuplicateProgramError,
    );
    // The original goal is untouched.
    expect(store.getProgram('p')?.goal).toBe('Ship auth');
    store.close();
  });

  it('advances a node planned → emitted (requires ref) → done, stamping updatedAt', () => {
    const store = createProgramStore(freshDbPath(), { clock: tickingClock() });
    seed(store);
    const emitted = store.advanceNode({
      programId: 'p',
      nodeId: 'p.1',
      state: 'emitted',
      issueRef: 'https://github.com/o/r/issues/7',
    });
    expect(emitted.state).toBe('emitted');
    expect(emitted.issueRef).toBe('https://github.com/o/r/issues/7');
    const done = store.advanceNode({ programId: 'p', nodeId: 'p.1', state: 'done' });
    expect(done.state).toBe('done');
    // The ref carried forward when not re-supplied.
    expect(done.issueRef).toBe('https://github.com/o/r/issues/7');
    expect(done.updatedAt).toBeGreaterThan(emitted.updatedAt);
    store.close();
  });

  it('rejects advancing an unknown node with UnknownProgramNodeError', () => {
    const store = createProgramStore(freshDbPath());
    seed(store);
    expect(() => store.advanceNode({ programId: 'p', nodeId: 'p.99', state: 'done' })).toThrow(
      UnknownProgramNodeError,
    );
    store.close();
  });

  it('rejects a backward transition (done → planned) with InvalidNodeTransitionError', () => {
    const store = createProgramStore(freshDbPath());
    seed(store);
    store.advanceNode({ programId: 'p', nodeId: 'p.1', state: 'emitted', issueRef: 'x' });
    store.advanceNode({ programId: 'p', nodeId: 'p.1', state: 'done' });
    expect(() => store.advanceNode({ programId: 'p', nodeId: 'p.1', state: 'planned' })).toThrow(
      InvalidNodeTransitionError,
    );
    store.close();
  });

  it('rejects skipping a rung (planned → done) — a node cannot reach done unemitted', () => {
    const store = createProgramStore(freshDbPath());
    seed(store);
    expect(() => store.advanceNode({ programId: 'p', nodeId: 'p.1', state: 'done' })).toThrow(
      InvalidNodeTransitionError,
    );
    store.close();
  });

  it('rejects a non-https URL ref, an over-long ref, and a ref with control characters', () => {
    const store = createProgramStore(freshDbPath());
    seed(store);
    const bad = (issueRef: string): void => {
      store.advanceNode({ programId: 'p', nodeId: 'p.1', state: 'emitted', issueRef });
    };
    expect(() => bad('http://x/1')).toThrow(InvalidNodeTransitionError); // not https
    expect(() => bad('a\u0007b')).toThrow(InvalidNodeTransitionError); // control char
    expect(() => bad('x'.repeat(513))).toThrow(InvalidNodeTransitionError); // over REF_MAX
    store.close();
  });

  it('rejects advancing to emitted without an issue ref', () => {
    const store = createProgramStore(freshDbPath());
    seed(store);
    expect(() => store.advanceNode({ programId: 'p', nodeId: 'p.1', state: 'emitted' })).toThrow(
      InvalidNodeTransitionError,
    );
    expect(() =>
      store.advanceNode({ programId: 'p', nodeId: 'p.1', state: 'emitted', issueRef: '  ' }),
    ).toThrow(InvalidNodeTransitionError);
    store.close();
  });

  it('rejects a non-https URL-shaped issue ref to emitted', () => {
    const store = createProgramStore(freshDbPath());
    seed(store);
    expect(() =>
      store.advanceNode({
        programId: 'p',
        nodeId: 'p.1',
        state: 'emitted',
        issueRef: 'http://github.com/o/r/issues/7',
      }),
    ).toThrow(InvalidNodeTransitionError);
    // A non-URL ref (e.g. "owner/repo#7") is accepted.
    const ok = store.advanceNode({
      programId: 'p',
      nodeId: 'p.2',
      state: 'emitted',
      issueRef: 'o/r#7',
    });
    expect(ok.issueRef).toBe('o/r#7');
    store.close();
  });

  it('lists nodes in nodeId order with labels parsed back to string[]', () => {
    const store = createProgramStore(freshDbPath());
    store.createProgram({
      programId: 'p',
      goal: 'g',
      nodes: [
        { nodeId: 'p.2', goal: 'b', labels: ['altitude:task'], taskJson: '{}' },
        { nodeId: 'p.1', goal: 'a', labels: ['altitude:story', 'track:auth'], taskJson: '{}' },
      ],
    });
    const nodes = store.listNodes('p');
    expect(nodes.map((n) => n.nodeId)).toEqual(['p.1', 'p.2']);
    expect(nodes[0]!.labels).toEqual(['altitude:story', 'track:auth']);
    store.close();
  });

  it('lists programs newest-first capped at the limit', () => {
    const store = createProgramStore(freshDbPath(), { clock: tickingClock() });
    store.createProgram({ programId: 'a', goal: 'g', nodes: [] });
    store.createProgram({ programId: 'b', goal: 'g', nodes: [] });
    store.createProgram({ programId: 'c', goal: 'g', nodes: [] });
    expect(store.listPrograms().map((p) => p.programId)).toEqual(['c', 'b', 'a']);
    expect(store.listPrograms({ limit: 2 }).map((p) => p.programId)).toEqual(['c', 'b']);
    store.close();
  });

  it('stores a SQL-injection-shaped goal/nodeId as DATA (parameterized)', () => {
    const store = createProgramStore(freshDbPath());
    const evil = "p'); DROP TABLE programs;--";
    store.createProgram({
      programId: evil,
      goal: "g'); DROP TABLE program_nodes;--",
      nodes: [{ nodeId: evil, goal: 'x', labels: [], taskJson: '{}' }],
    });
    // Both tables survive; the literal injection string is stored verbatim.
    expect(store.getProgram(evil)?.goal).toBe("g'); DROP TABLE program_nodes;--");
    expect(store.listNodes(evil).map((n) => n.nodeId)).toEqual([evil]);
    store.close();
  });
});
