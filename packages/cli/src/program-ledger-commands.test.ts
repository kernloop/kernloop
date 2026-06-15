/**
 * The `kernloop program create|status|advance` CLI suite (CLM-0100). Proves the
 * wired, resumable LEDGER path: `create` persists a decomposed plan; `status`
 * reports the planned/emitted/done rollup; `advance` moves a node forward one
 * poll-driven step (requiring `--ref` to reach `emitted`). A duplicate id, an
 * unknown program/node, a backward transition, and an emitted-without-ref each
 * exit 1 cleanly, and every op audits without the goal verbatim.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initOverlay } from './overlay.js';
import { programCommand } from './program-commands.js';
import type { CliIo } from './cli.js';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-program-ledger-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A bare repo overlay (the ledger never needs a tracker). */
function repo(): string {
  const r = tmp();
  initOverlay(r);
  return r;
}

/** Write a spec JSON file into the repo and return its path. */
function writeSpec(r: string, specs: unknown): string {
  const file = path.join(r, 'spec.json');
  writeFileSync(file, JSON.stringify(specs));
  return file;
}

function makeIo(cwd: string): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t) => out.push(t), err: (t) => err.push(t), cwd }, out, err };
}

const helpers = {
  outFlags: () => ({}),
  strFlags: () => ({}),
  mixedFlags: (args: string[], _strs: readonly string[], bools: readonly string[]) => {
    const v: Record<string, string | boolean> = {};
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a.startsWith('--')) {
        const name = a.slice(2);
        if (bools.includes(name)) v[name] = true;
        else v[name] = args[++i]!;
      }
    }
    return v;
  },
  withKernloop: async () => 0,
  str: (x: string | boolean | undefined) => (typeof x === 'string' ? x : undefined),
} as unknown as Parameters<typeof programCommand>[2];

function auditEvents(r: string): Array<{ type: string; payload: Record<string, unknown> }> {
  return readFileSync(path.join(r, '.kernloop', 'audit.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> });
}

const STORY = {
  goal: 'Build login',
  budget: { tokens: 4_000, usd: 0.4, wallClockMin: 10 },
  assignTo: 'coder',
  altitude: 'story',
};

interface StatusOut {
  programId: string;
  goal: string;
  counts: { planned: number; emitted: number; done: number };
  nodes: Array<{ nodeId: string; goal: string; state: string; issueRef: string | null }>;
}

/** Create a program with the given id + a single story; return its repo. */
async function createOne(id: string): Promise<string> {
  const r = repo();
  const spec = writeSpec(r, [STORY]);
  await programCommand(
    ['create', '--goal', 'G', '--spec', spec, '--id', id],
    makeIo(r).io,
    helpers,
  );
  return r;
}

describe('kernloop program create|status|advance — the resumable ledger', () => {
  it('list shows the persisted programs (id + goal)', async () => {
    const r = await createOne('p-one');
    const spec = writeSpec(r, [STORY]);
    await programCommand(
      ['create', '--goal', 'Second', '--spec', spec, '--id', 'p-two'],
      makeIo(r).io,
      helpers,
    );
    const { io, out } = makeIo(r);
    const code = await programCommand(['list'], io, helpers);
    expect(code).toBe(0);
    const listed = JSON.parse(out[0]!) as { programs: Array<{ programId: string }> };
    expect(listed.programs.map((p) => p.programId).sort()).toEqual(['p-one', 'p-two']);
    expect(auditEvents(r).some((e) => e.type === 'cli.program.list')).toBe(true);
  });

  it('advance rejects a --state outside emitted|done with a clean usage error', async () => {
    const r = await createOne('st');
    const { io, err } = makeIo(r);
    const code = await programCommand(
      ['advance', '--program', 'st', '--node', 'st.1', '--state', 'planned'],
      io,
      helpers,
    );
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('ProgramInputError');
  });

  it('create persists a program; status shows N planned nodes with the right counts', async () => {
    const r = repo();
    const spec = writeSpec(r, [STORY, { ...STORY, goal: 'Build logout' }]);
    const { io, out } = makeIo(r);
    const code = await programCommand(
      ['create', '--goal', 'Ship auth', '--spec', spec, '--id', 'prog'],
      io,
      helpers,
    );
    expect(code).toBe(0);
    // nodeCount is the decomposition size (the 2 work items), not the +1 umbrella.
    expect((JSON.parse(out[0]!) as { programId: string; nodeCount: number }).nodeCount).toBe(2);

    const { io: io2, out: out2 } = makeIo(r);
    const code2 = await programCommand(['status', '--program', 'prog'], io2, helpers);
    expect(code2).toBe(0);
    const status = JSON.parse(out2[0]!) as StatusOut;
    // The program root is stored AS a node (the umbrella emit files first), so
    // status surfaces it alongside the 2 children: 3 planned nodes (#84).
    expect(status.counts).toEqual({ planned: 3, emitted: 0, done: 0 });
    expect(status.nodes.map((n) => n.nodeId)).toEqual(['prog', 'prog.1', 'prog.2']);
    expect(status.nodes.every((n) => n.state === 'planned')).toBe(true);
  });

  it('create with a duplicate id exits 1 with a clean DuplicateProgramError', async () => {
    const r = await createOne('dup');
    const spec = path.join(r, 'spec.json');
    const { io, err } = makeIo(r);
    const code = await programCommand(
      ['create', '--goal', 'G', '--spec', spec, '--id', 'dup'],
      io,
      helpers,
    );
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('DuplicateProgramError');
  });

  it('status of an unknown program exits 1 with a clear message', async () => {
    const r = repo();
    const { io, err } = makeIo(r);
    const code = await programCommand(['status', '--program', 'nope'], io, helpers);
    expect(code).toBe(1);
    const report = JSON.parse(err[0]!) as { error: string; message: string };
    expect(report.error).toBe('ProgramInputError');
    expect(report.message).toContain('no program');
  });

  it('advance planned → emitted (with --ref) then status shows it emitted with the ref', async () => {
    const r = await createOne('adv');
    const { io, out } = makeIo(r);
    const code = await programCommand(
      [
        'advance',
        '--program',
        'adv',
        '--node',
        'adv.1',
        '--state',
        'emitted',
        '--ref',
        'https://github.com/o/r/issues/9',
      ],
      io,
      helpers,
    );
    expect(code).toBe(0);
    expect((JSON.parse(out[0]!) as { node: { state: string } }).node.state).toBe('emitted');

    const { io: io2, out: out2 } = makeIo(r);
    await programCommand(['status', '--program', 'adv'], io2, helpers);
    const status = JSON.parse(out2[0]!) as StatusOut;
    expect(status.counts.emitted).toBe(1);
    const advanced = status.nodes.find((n) => n.nodeId === 'adv.1');
    expect(advanced?.issueRef).toBe('https://github.com/o/r/issues/9');
  });

  it('advance to emitted WITHOUT --ref exits 1', async () => {
    const r = await createOne('nr');
    const { io, err } = makeIo(r);
    const code = await programCommand(
      ['advance', '--program', 'nr', '--node', 'nr.1', '--state', 'emitted'],
      io,
      helpers,
    );
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('InvalidNodeTransitionError');
  });

  it('advance an unknown node exits 1', async () => {
    const r = await createOne('un');
    const { io, err } = makeIo(r);
    const code = await programCommand(
      ['advance', '--program', 'un', '--node', 'un.99', '--state', 'done'],
      io,
      helpers,
    );
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('UnknownProgramNodeError');
  });

  it('a backward transition (done → emitted) exits 1', async () => {
    const r = await createOne('bk');
    await programCommand(
      ['advance', '--program', 'bk', '--node', 'bk.1', '--state', 'emitted', '--ref', 'o/r#1'],
      makeIo(r).io,
      helpers,
    );
    await programCommand(
      ['advance', '--program', 'bk', '--node', 'bk.1', '--state', 'done'],
      makeIo(r).io,
      helpers,
    );
    const { io, err } = makeIo(r);
    const code = await programCommand(
      ['advance', '--program', 'bk', '--node', 'bk.1', '--state', 'emitted', '--ref', 'o/r#1'],
      io,
      helpers,
    );
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('InvalidNodeTransitionError');
  });

  it('each op writes its audit event without the goal verbatim', async () => {
    const r = repo();
    const SECRET = 'SECRET-LEDGER-GOAL-do-not-leak';
    const spec = writeSpec(r, [STORY]);
    await programCommand(
      ['create', '--goal', SECRET, '--spec', spec, '--id', 'au'],
      makeIo(r).io,
      helpers,
    );
    await programCommand(['status', '--program', 'au'], makeIo(r).io, helpers);
    await programCommand(
      ['advance', '--program', 'au', '--node', 'au.1', '--state', 'emitted', '--ref', 'o/r#1'],
      makeIo(r).io,
      helpers,
    );
    const raw = readFileSync(path.join(r, '.kernloop', 'audit.jsonl'), 'utf8');
    expect(raw).not.toContain(SECRET);
    const types = auditEvents(r).map((e) => e.type);
    expect(types).toContain('cli.program.create');
    expect(types).toContain('cli.program.status');
    expect(types).toContain('cli.program.advance');
    const create = auditEvents(r).find((e) => e.type === 'cli.program.create');
    expect(create?.payload.goalChars).toBe(SECRET.length);
  });
});

const TASK = {
  goal: 'Write the login form',
  budget: { tokens: 1_000, usd: 0.1, wallClockMin: 5 },
  assignTo: 'coder',
  altitude: 'task',
};

describe('kernloop program decompose-node — growing the tree deeper (#118)', () => {
  it('decomposes a stored story node into task children stored under it (parentId = N)', async () => {
    const r = await createOne('p'); // p (root) + p.1 (story)
    const { io, out } = makeIo(r);
    const code = await programCommand(
      ['decompose-node', '--program', 'p', '--node', 'p.1', '--spec', writeSpec(r, [TASK])],
      io,
      helpers,
    );
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as { childCount: number; parentNodeId: string };
    expect(report).toMatchObject({ parentNodeId: 'p.1', childCount: 1 });
    // status now shows the deeper task node p.1.1 as a planned node.
    const { io: io2, out: out2 } = makeIo(r);
    await programCommand(['status', '--program', 'p'], io2, helpers);
    const status = JSON.parse(out2[0]!) as StatusOut;
    expect(status.nodes.some((n) => n.nodeId === 'p.1.1' && n.state === 'planned')).toBe(true);
    // and the create-time umbrella + story remain (the tree grew, nothing replaced).
    expect(status.nodes.map((n) => n.nodeId)).toEqual(
      expect.arrayContaining(['p', 'p.1', 'p.1.1']),
    );
  });

  it('refuses to decompose a stored TASK leaf — altitude descent (a task cannot decompose)', async () => {
    const r = repo();
    await programCommand(
      ['create', '--goal', 'G', '--spec', writeSpec(r, [TASK]), '--id', 'q'],
      makeIo(r).io,
      helpers,
    );
    const { io, err } = makeIo(r);
    const code = await programCommand(
      ['decompose-node', '--program', 'q', '--node', 'q.1', '--spec', writeSpec(r, [TASK])],
      io,
      helpers,
    );
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('AltitudeDescentError');
  });

  it('an unknown node is a clean ProgramInputError exit', async () => {
    const r = await createOne('p');
    const { io, err } = makeIo(r);
    const code = await programCommand(
      ['decompose-node', '--program', 'p', '--node', 'p.99', '--spec', writeSpec(r, [TASK])],
      io,
      helpers,
    );
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('ProgramInputError');
  });

  it('re-decomposing the same node refuses to overwrite the children (no double-insert)', async () => {
    const r = await createOne('p');
    const spec = writeSpec(r, [TASK]);
    await programCommand(
      ['decompose-node', '--program', 'p', '--node', 'p.1', '--spec', spec],
      makeIo(r).io,
      helpers,
    );
    const { io, err } = makeIo(r);
    const code = await programCommand(
      ['decompose-node', '--program', 'p', '--node', 'p.1', '--spec', spec],
      io,
      helpers,
    );
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('DuplicateProgramNodeError');
  });
});
