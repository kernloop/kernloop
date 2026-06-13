/**
 * The `kernloop program emit --program <id>` LEDGER-DRIVEN suite (CLM-0098,
 * #88). Proves the auto-recording path: emitting a persisted program files its
 * `planned` nodes from the STORED rows through the gated tracker and records
 * each filed ref back into the ledger (planned → emitted) on a real execute,
 * idempotently (a re-emit skips and files nothing). Dry-run proposes and records
 * nothing; --execute at suggest is refused; an unknown program / both
 * --program+--goal exit 1 cleanly; an execute failure leaves the node planned;
 * the op audits once with counts/ids, never a node goal verbatim.
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

/** A repo overlay carrying a tracker block at the given tier (emit needs one). */
function repoWithTracker(tier: 'suggest' | 'enforce'): string {
  const r = mkdtempSync(path.join(tmpdir(), 'kernloop-emit-ledger-'));
  dirs.push(r);
  initOverlay(r);
  writeFileSync(
    path.join(r, '.kernloop', 'overlay.yaml'),
    `id: t\ntracker:\n  provider: github\n  repo: kernloop/kernloop\n  tier: ${tier}\n`,
  );
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

/** A recording exec that resolves every gh create to issues/7 (execute mode). */
function recordingExec(): { exec: TrackerExec; calls: Array<{ argv: readonly string[] }> } {
  const calls: Array<{ argv: readonly string[] }> = [];
  const stdout = 'https://github.com/kernloop/kernloop/issues/7';
  const exec: TrackerExec = (_command, argv) => {
    calls.push({ argv });
    return Promise.resolve<ExecResult>({ exitCode: 0, stdout, stderr: '' });
  };
  return { exec, calls };
}

/** An exec that throws — proves a dry-run / refused-execute spawns nothing. */
const throwingExec: TrackerExec = () => {
  throw new Error('emit must not spawn in dry-run / refused-execute');
};

const STORY = {
  goal: 'Build login',
  budget: { tokens: 4_000, usd: 0.4, wallClockMin: 10 },
  assignTo: 'coder',
  altitude: 'story',
};

interface LedgerEmitOut {
  op: string;
  mode: string;
  refusedExecute: boolean;
  programId: string;
  notice: string;
  plannedCount: number;
  emittedCount: number;
  skippedCount: number;
  nodes: Array<{
    nodeId: string;
    state: string;
    parentRef?: string;
    proposal?: { argv: readonly string[] };
    result?: { ok: boolean; ref?: string; reason?: string };
  }>;
  skipped: Array<{ nodeId: string; state: string }>;
  links: Array<{ parentNodeId: string; childNodeId: string }>;
  epicUpdates: Array<{ nodeId: string; childCount: number; ok: boolean; reason?: string }>;
}

interface StatusOut {
  counts: { planned: number; emitted: number; done: number };
  nodes: Array<{ nodeId: string; state: string; issueRef: string | null }>;
}

/** Create a program with a root umbrella + 2 story children (3 ledger nodes,
 * #84), returning the repo dir. */
async function createTwoNodeProgram(tier: 'suggest' | 'enforce', id = 'prog'): Promise<string> {
  const r = repoWithTracker(tier);
  const spec = writeSpec(r, [STORY, { ...STORY, goal: 'Build logout', track: 'auth' }]);
  const code = await programCommand(
    ['create', '--goal', 'Ship auth', '--spec', spec, '--id', id],
    makeIo(r).io,
    helpers,
  );
  expect(code).toBe(0);
  return r;
}

/** Read the `program status` rollup for `id` from repo dir `r`. */
async function statusOf(r: string, id = 'prog'): Promise<StatusOut> {
  const { io, out } = makeIo(r);
  const code = await programCommand(['status', '--program', id], io, helpers);
  expect(code).toBe(0);
  return JSON.parse(out[0]!) as StatusOut;
}

describe('kernloop program emit --program — the ledger-driven, auto-recording emission', () => {
  it('dry-run files nothing and leaves the ledger nodes planned (poisoned exec)', async () => {
    const r = await createTwoNodeProgram('suggest');
    const { io, out } = makeIo(r);
    const code = await programCommand(['emit', '--program', 'prog'], io, helpers, {
      exec: throwingExec,
    });
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as LedgerEmitOut;
    expect(report.mode).toBe('dry-run');
    expect(report.notice).toContain('DRY RUN');
    // 3 planned nodes: the root umbrella + 2 story children (#84).
    expect(report.plannedCount).toBe(3);
    expect(report.emittedCount).toBe(0);
    expect(report.nodes.every((n) => n.state === 'planned')).toBe(true);
    // The root umbrella is filed first (parents-first ordering).
    expect(report.nodes[0]!.nodeId).toBe('prog');
    expect(report.nodes[0]!.proposal?.argv.slice(0, 2)).toEqual(['issue', 'create']);
    // The would-be sub-issue edges are reported; no epic edits in dry-run.
    expect(report.links).toEqual([
      { parentNodeId: 'prog', childNodeId: 'prog.1' },
      { parentNodeId: 'prog', childNodeId: 'prog.2' },
    ]);
    expect(report.epicUpdates).toEqual([]);
    // The ledger nodes STAY planned.
    const status = await statusOf(r);
    expect(status.counts.planned).toBe(3);
    expect(status.counts.emitted).toBe(0);
  });

  it('--execute files the umbrella first, links children, edits the epic body, records refs', async () => {
    const r = await createTwoNodeProgram('enforce');
    const { io, out } = makeIo(r);
    const { exec, calls } = recordingExec();
    const code = await programCommand(['emit', '--program', 'prog', '--execute'], io, helpers, {
      exec,
    });
    expect(code).toBe(0);
    // 3 creates (root + 2 children) + 1 edit (epic sub-issue task-list).
    expect(calls).toHaveLength(4);
    expect(calls[0]!.argv.slice(0, 2)).toEqual(['issue', 'create']); // umbrella first
    expect(calls.some((c) => c.argv.slice(0, 2).join(' ') === 'issue edit')).toBe(true);
    // A child's STORED track:auth label is passed to gh (the stored row is the source).
    expect(calls.some((c) => c.argv.some((a) => a === '--label=track:auth'))).toBe(true);
    const report = JSON.parse(out[0]!) as LedgerEmitOut;
    expect(report.mode).toBe('execute');
    expect(report.emittedCount).toBe(3);
    expect(report.nodes.every((n) => n.state === 'emitted' && n.result?.ok === true)).toBe(true);
    // Each child carries a Parent back-link to the umbrella's filed number (#7).
    const children = report.nodes.filter((n) => n.nodeId !== 'prog');
    expect(children.every((n) => n.parentRef === '#7')).toBe(true);
    // The umbrella's body was edited once with its 2 sub-issues.
    expect(report.epicUpdates).toEqual([{ nodeId: 'prog', childCount: 2, ok: true }]);
    // AUTO-advanced in the ledger to emitted with the returned ref — no manual advance.
    const status = await statusOf(r);
    expect(status.counts.emitted).toBe(3);
    expect(status.counts.planned).toBe(0);
    for (const node of status.nodes) {
      expect(node.state).toBe('emitted');
      expect(node.issueRef).toBe('https://github.com/kernloop/kernloop/issues/7');
    }
  });

  it('is idempotent: a second --execute files NOTHING, exits 0, reports skipped', async () => {
    const r = await createTwoNodeProgram('enforce');
    const first = recordingExec();
    await programCommand(['emit', '--program', 'prog', '--execute'], makeIo(r).io, helpers, {
      exec: first.exec,
    });
    expect(first.calls).toHaveLength(4); // 3 creates + 1 epic-body edit
    // Second emit: all nodes already emitted → nothing to do, zero new gh calls.
    const { io, out } = makeIo(r);
    const second = recordingExec();
    const code = await programCommand(['emit', '--program', 'prog', '--execute'], io, helpers, {
      exec: second.exec,
    });
    expect(code).toBe(0);
    expect(second.calls).toHaveLength(0);
    const report = JSON.parse(out[0]!) as LedgerEmitOut;
    expect(report.notice).toContain('nothing to emit');
    expect(report.skipped.map((s) => s.state)).toEqual(['emitted', 'emitted', 'emitted']);
    expect(report.nodes).toHaveLength(0);
  });

  it('refuses --execute at suggest (stays dry-run, ledger unchanged, spawns nothing)', async () => {
    const r = await createTwoNodeProgram('suggest');
    const { io, out } = makeIo(r);
    const { exec, calls } = recordingExec();
    const code = await programCommand(['emit', '--program', 'prog', '--execute'], io, helpers, {
      exec,
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    const report = JSON.parse(out[0]!) as LedgerEmitOut;
    expect(report.mode).toBe('dry-run');
    expect(report.refusedExecute).toBe(true);
    expect(report.notice).toContain('refused');
    const status = await statusOf(r);
    expect(status.counts.planned).toBe(3);
  });

  it('an epic-body edit failure (children filed) is errors-as-data → exit 1', async () => {
    const r = await createTwoNodeProgram('enforce');
    const { io, out } = makeIo(r);
    // Succeed on every `issue create`, FAIL the `issue edit` (the epic task-list).
    const editFailsExec: TrackerExec = (_command, argv) => {
      if (argv[0] === 'issue' && argv[1] === 'edit') {
        return Promise.resolve<ExecResult>({ exitCode: 1, stdout: '', stderr: 'gh: edit denied' });
      }
      return Promise.resolve<ExecResult>({
        exitCode: 0,
        stdout: 'https://github.com/kernloop/kernloop/issues/7',
        stderr: '',
      });
    };
    const code = await programCommand(['emit', '--program', 'prog', '--execute'], io, helpers, {
      exec: editFailsExec,
    });
    expect(code).toBe(1); // the failed epic edit is a visible failure
    const report = JSON.parse(out[0]!) as LedgerEmitOut;
    // The children still filed-and-recorded; only the umbrella's body edit failed.
    expect(report.emittedCount).toBe(3);
    expect(report.epicUpdates).toEqual([
      { nodeId: 'prog', childCount: 2, ok: false, reason: 'exit-nonzero' },
    ]);
  });

  it('an unknown --program exits 1 with a clean ProgramInputError', async () => {
    const r = repoWithTracker('enforce');
    const { io, err } = makeIo(r);
    const code = await programCommand(['emit', '--program', 'nonexistent'], io, helpers, {
      exec: throwingExec,
    });
    expect(code).toBe(1);
    const report = JSON.parse(err[0]!) as { error: string; message: string };
    expect(report.error).toBe('ProgramInputError');
    expect(report.message).toContain('no program');
  });

  it('--program with --goal/--spec is mutually exclusive (clean exit 1)', async () => {
    const r = await createTwoNodeProgram('enforce');
    const spec = writeSpec(r, [STORY]);
    const { io, err } = makeIo(r);
    const code = await programCommand(
      ['emit', '--program', 'prog', '--goal', 'G', '--spec', spec],
      io,
      helpers,
      { exec: throwingExec },
    );
    expect(code).toBe(1);
    const report = JSON.parse(err[0]!) as { error: string; message: string };
    expect(report.error).toBe('ProgramInputError');
    expect(report.message).toContain('mutually exclusive');
  });

  it('an execute-mode failure on a node exits 1 and that node STAYS planned', async () => {
    const r = await createTwoNodeProgram('enforce');
    const { io, out } = makeIo(r);
    const failingExec: TrackerExec = () =>
      Promise.resolve<ExecResult>({ exitCode: 1, stdout: '', stderr: 'gh: not authenticated' });
    const code = await programCommand(['emit', '--program', 'prog', '--execute'], io, helpers, {
      exec: failingExec,
    });
    expect(code).toBe(1);
    const report = JSON.parse(out[0]!) as LedgerEmitOut;
    expect(report.nodes.every((n) => n.result?.ok === false)).toBe(true);
    expect(report.emittedCount).toBe(0);
    // The umbrella create failed, so no child could link and no epic was edited.
    expect(report.epicUpdates).toEqual([]);
    // The failed nodes stay planned in the ledger (not advanced).
    const status = await statusOf(r);
    expect(status.counts.planned).toBe(3);
    expect(status.counts.emitted).toBe(0);
  });

  it('a filed issue with an unrecordable (non-https) ref is reported, exits 1, stays planned (#98)', async () => {
    const r = await createTwoNodeProgram('enforce');
    const { io, out } = makeIo(r);
    // gh "succeeds" but returns a non-https URL: refFromOutput surfaces it, then
    // advanceNode's https-only ref shape rejects it — the issue is already filed.
    const badRefExec: TrackerExec = () =>
      Promise.resolve<ExecResult>({
        exitCode: 0,
        stdout: 'http://github.com/kernloop/kernloop/issues/9',
        stderr: '',
      });
    const code = await programCommand(['emit', '--program', 'prog', '--execute'], io, helpers, {
      exec: badRefExec,
    });
    expect(code).toBe(1); // the filed-but-unrecorded node is a visible failure
    const report = JSON.parse(out[0]!) as LedgerEmitOut;
    expect(report.emittedCount).toBe(0);
    // Each node is reported filed-but-NOT-recorded, carrying its ref for recovery.
    expect(report.nodes.every((n) => n.result?.ok === false)).toBe(true);
    expect(report.nodes.every((n) => n.result?.reason?.includes('filed but NOT recorded'))).toBe(
      true,
    );
    expect(
      report.nodes.every((n) => n.result?.ref === 'http://github.com/kernloop/kernloop/issues/9'),
    ).toBe(true);
    // The ledger did NOT advance — the nodes stay planned (no false "emitted").
    const status = await statusOf(r);
    expect(status.counts.planned).toBe(3);
    expect(status.counts.emitted).toBe(0);
  });

  it('audits cli.program.emit once with program counts and never a node goal verbatim', async () => {
    const SECRET = 'SECRET-LEDGER-NODE-GOAL';
    const r = repoWithTracker('enforce');
    const spec = writeSpec(r, [{ ...STORY, goal: SECRET }]);
    await programCommand(
      ['create', '--goal', 'G', '--spec', spec, '--id', 'p2'],
      makeIo(r).io,
      helpers,
    );
    const { exec } = recordingExec();
    await programCommand(['emit', '--program', 'p2', '--execute'], makeIo(r).io, helpers, { exec });
    const raw = readFileSync(path.join(r, '.kernloop', 'audit.jsonl'), 'utf8');
    expect(raw).not.toContain(SECRET);
    const events = auditEvents(r).filter((e) => e.type === 'cli.program.emit');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.programId).toBe('p2');
    // The umbrella root + 1 story child = 2 planned/emitted; 1 epic body edit.
    expect(events[0]!.payload.plannedCount).toBe(2);
    expect(events[0]!.payload.emittedCount).toBe(2);
    expect(events[0]!.payload.epicUpdatedCount).toBe(1);
  });
});
