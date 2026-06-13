/**
 * The `kernloop program reconcile --program <id>` suite (CLM-0102, #87). Proves
 * the GitHub-authoritative reconciliation: each `emitted` node's GitHub issue is
 * READ via the tracker (a mock getIssue exec) and, when the issue is CLOSED, the
 * node advances `emitted → done`. Dry-run (default) reads but writes NOTHING to
 * the ledger; `--execute` applies the advances. A read failure is reported and
 * makes the run exit 1 with the node unchanged; a program with no emitted nodes
 * exits 0; a nonexistent program exits 1; the op audits once with counts only.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecResult, TrackerExec } from '@kernloop/tracker';
import { initOverlay } from './overlay.js';
import { programCommand } from './program-commands.js';
import type { CliIo } from './cli.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repo overlay carrying a tracker block (reconcile needs one to read). */
function repoWithTracker(tier: 'suggest' | 'enforce' = 'suggest'): string {
  const r = mkdtempSync(path.join(tmpdir(), 'kernloop-reconcile-'));
  dirs.push(r);
  initOverlay(r);
  writeFileSync(
    path.join(r, '.kernloop', 'overlay.yaml'),
    `id: t\ntracker:\n  provider: github\n  repo: kernloop/kernloop\n  tier: ${tier}\n`,
  );
  return r;
}

/** A bare overlay with NO tracker block (to prove the clean "no tracker" error). */
function repoNoTracker(): string {
  const r = mkdtempSync(path.join(tmpdir(), 'kernloop-reconcile-'));
  dirs.push(r);
  initOverlay(r);
  return r;
}

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

interface ReconcileOut {
  op: string;
  mode: string;
  programId: string;
  notice: string;
  checked: number;
  closed: number;
  advanced: number;
  readFailed: number;
  nodes: Array<{
    nodeId: string;
    issueRef: string;
    githubState?: string;
    action: string;
    reason?: string;
  }>;
}

interface StatusOut {
  counts: { planned: number; emitted: number; done: number };
  nodes: Array<{ nodeId: string; state: string; issueRef: string | null }>;
}

/** A getIssue mock: returns the configured state per issue NUMBER on gh stdout,
 * or fails (nonzero exit) for a number in `failFor`. */
function viewExec(
  stateByNumber: Record<string, 'OPEN' | 'CLOSED'>,
  failFor: string[] = [],
): {
  exec: TrackerExec;
  calls: Array<{ argv: readonly string[] }>;
} {
  const calls: Array<{ argv: readonly string[] }> = [];
  const exec: TrackerExec = (_command, argv) => {
    calls.push({ argv });
    const num = argv.at(-1) as string; // the ref is the sole positional behind `--`
    if (failFor.includes(num)) {
      return Promise.resolve<ExecResult>({ exitCode: 1, stdout: '', stderr: 'not found' });
    }
    const state = stateByNumber[num] ?? 'OPEN';
    return Promise.resolve<ExecResult>({
      exitCode: 0,
      stdout: JSON.stringify({ number: Number(num), state }),
      stderr: '',
    });
  };
  return { exec, calls };
}

/** Create a two-node program and advance BOTH nodes to `emitted` with refs 1 and 2. */
async function twoEmittedNodes(tier: 'suggest' | 'enforce' = 'suggest'): Promise<string> {
  const r = repoWithTracker(tier);
  const spec = writeSpec(r, [STORY, { ...STORY, goal: 'Build logout' }]);
  expect(
    await programCommand(
      ['create', '--goal', 'Ship auth', '--spec', spec, '--id', 'prog'],
      makeIo(r).io,
      helpers,
    ),
  ).toBe(0);
  for (const [node, ref] of [
    ['prog.1', '1'],
    ['prog.2', '2'],
  ] as const) {
    expect(
      await programCommand(
        ['advance', '--program', 'prog', '--node', node, '--state', 'emitted', '--ref', ref],
        makeIo(r).io,
        helpers,
      ),
    ).toBe(0);
  }
  return r;
}

async function statusOf(r: string, id = 'prog'): Promise<StatusOut> {
  const { io, out } = makeIo(r);
  expect(await programCommand(['status', '--program', id], io, helpers)).toBe(0);
  return JSON.parse(out[0]!) as StatusOut;
}

describe('kernloop program reconcile — GitHub-authoritative reconciliation', () => {
  it('dry-run shows advance-to-done for the closed issue + no-change for the open one, ledger UNCHANGED', async () => {
    const r = await twoEmittedNodes();
    const { exec } = viewExec({ '1': 'CLOSED', '2': 'OPEN' });
    const { io, out } = makeIo(r);
    const code = await programCommand(['reconcile', '--program', 'prog'], io, helpers, { exec });
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as ReconcileOut;
    expect(report.mode).toBe('dry-run');
    expect(report.notice).toContain('DRY RUN');
    expect(report.checked).toBe(2);
    expect(report.closed).toBe(1);
    expect(report.advanced).toBe(0); // dry-run writes nothing
    const closed = report.nodes.find((n) => n.nodeId === 'prog.1')!;
    expect(closed.action).toBe('advance-to-done');
    expect(closed.githubState).toBe('closed');
    const open = report.nodes.find((n) => n.nodeId === 'prog.2')!;
    expect(open.action).toBe('no-change');
    expect(open.githubState).toBe('open');
    // The ledger is UNCHANGED — both nodes still emitted.
    const status = await statusOf(r);
    expect(status.counts.emitted).toBe(2);
    expect(status.counts.done).toBe(0);
  });

  it('--execute advances the closed-issue node to done and leaves the open one emitted', async () => {
    const r = await twoEmittedNodes();
    const { exec } = viewExec({ '1': 'CLOSED', '2': 'OPEN' });
    const { io, out } = makeIo(r);
    const code = await programCommand(
      ['reconcile', '--program', 'prog', '--execute'],
      io,
      helpers,
      {
        exec,
      },
    );
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as ReconcileOut;
    expect(report.mode).toBe('execute');
    expect(report.advanced).toBe(1);
    // The ledger now shows prog.1 done, prog.2 still emitted.
    const status = await statusOf(r);
    expect(status.counts.done).toBe(1);
    expect(status.counts.emitted).toBe(1);
    expect(status.nodes.find((n) => n.nodeId === 'prog.1')?.state).toBe('done');
    expect(status.nodes.find((n) => n.nodeId === 'prog.2')?.state).toBe('emitted');
  });

  it('a getIssue read failure is reported, exits 1, and leaves the node unchanged', async () => {
    const r = await twoEmittedNodes();
    const { exec } = viewExec({ '2': 'CLOSED' }, ['1']); // node prog.1's read fails
    const { io, out } = makeIo(r);
    const code = await programCommand(
      ['reconcile', '--program', 'prog', '--execute'],
      io,
      helpers,
      {
        exec,
      },
    );
    expect(code).toBe(1); // a broken reconcile is visible
    const report = JSON.parse(out[0]!) as ReconcileOut;
    expect(report.readFailed).toBe(1);
    const failed = report.nodes.find((n) => n.nodeId === 'prog.1')!;
    expect(failed.action).toBe('read-failed');
    expect(failed.reason).toBe('exit-nonzero');
    // prog.1 (failed read) stays emitted; prog.2 (closed) advanced to done.
    const status = await statusOf(r);
    expect(status.nodes.find((n) => n.nodeId === 'prog.1')?.state).toBe('emitted');
    expect(status.nodes.find((n) => n.nodeId === 'prog.2')?.state).toBe('done');
  });

  it('reads GitHub regardless of tier (suggest tier still reads — a read is not a mutation)', async () => {
    const r = await twoEmittedNodes('suggest');
    const { exec, calls } = viewExec({ '1': 'CLOSED', '2': 'CLOSED' });
    const code = await programCommand(
      ['reconcile', '--program', 'prog', '--execute'],
      makeIo(r).io,
      helpers,
      {
        exec,
      },
    );
    expect(code).toBe(0);
    // Both issues were READ even at suggest tier; both advanced (no enforce gate on the read/local write).
    expect(calls).toHaveLength(2);
    const status = await statusOf(r);
    expect(status.counts.done).toBe(2);
  });

  it('a program with no emitted nodes reconciles to a clean exit 0 (nothing to check)', async () => {
    const r = repoWithTracker();
    const spec = writeSpec(r, [STORY]);
    await programCommand(
      ['create', '--goal', 'Ship auth', '--spec', spec, '--id', 'prog'],
      makeIo(r).io,
      helpers,
    );
    const { exec, calls } = viewExec({});
    const { io, out } = makeIo(r);
    const code = await programCommand(['reconcile', '--program', 'prog'], io, helpers, { exec });
    expect(code).toBe(0);
    expect(calls).toHaveLength(0); // no emitted node to read
    expect((JSON.parse(out[0]!) as ReconcileOut).checked).toBe(0);
  });

  it('reconcile of a nonexistent program exits 1 cleanly', async () => {
    const r = repoWithTracker();
    const { exec } = viewExec({});
    const { io, err } = makeIo(r);
    const code = await programCommand(['reconcile', '--program', 'never-made'], io, helpers, {
      exec,
    });
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('ProgramInputError');
  });

  it('reconcile with no tracker configured exits 1 cleanly', async () => {
    const r = repoNoTracker();
    const spec = writeSpec(r, [STORY]);
    await programCommand(
      ['create', '--goal', 'Ship auth', '--spec', spec, '--id', 'prog'],
      makeIo(r).io,
      helpers,
    );
    // Advance the single node to emitted so reconcile reaches the provider build.
    await programCommand(
      ['advance', '--program', 'prog', '--node', 'prog.1', '--state', 'emitted', '--ref', '1'],
      makeIo(r).io,
      helpers,
    );
    const { io, err } = makeIo(r);
    const code = await programCommand(['reconcile', '--program', 'prog'], io, helpers);
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('ProgramInputError');
  });

  it('audits cli.program.reconcile ONCE with counts only (no goal verbatim)', async () => {
    const r = await twoEmittedNodes();
    const { exec } = viewExec({ '1': 'CLOSED', '2': 'OPEN' });
    await programCommand(['reconcile', '--program', 'prog', '--execute'], makeIo(r).io, helpers, {
      exec,
    });
    const events = auditEvents(r).filter((e) => e.type === 'cli.program.reconcile');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      op: 'reconcile',
      programId: 'prog',
      mode: 'execute',
      checked: 2,
      closed: 1,
      advanced: 1,
      readFailed: 0,
    });
    // No node goal ever appears in the audit trail.
    const text = readFileSync(path.join(r, '.kernloop', 'audit.jsonl'), 'utf8');
    expect(text).not.toContain('Build login');
    expect(text).not.toContain('Ship auth');
  });
});
