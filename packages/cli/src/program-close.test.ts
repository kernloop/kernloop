/**
 * The `kernloop program close --program <id>` suite (CLM-0116, EPIC #50). Proves
 * the LEDGER-authoritative closure: each `done` node's filed GitHub issue is READ
 * (a mock getIssue exec) and, when OPEN, CLOSED via the tracker — but only at the
 * `enforce` tier with `--execute`; otherwise a dry-run proposes the closes and
 * spawns no close. Only `done` nodes are targeted (an emitted node is left
 * alone); an already-closed issue is a no-op; a failed close exits 1; the op
 * audits once with counts only.
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

function repoWithTracker(tier: 'suggest' | 'enforce' = 'suggest'): string {
  const r = mkdtempSync(path.join(tmpdir(), 'kernloop-close-'));
  dirs.push(r);
  initOverlay(r);
  writeFileSync(
    path.join(r, '.kernloop', 'overlay.yaml'),
    `id: t\ntracker:\n  provider: github\n  repo: kernloop/kernloop\n  tier: ${tier}\n`,
  );
  return r;
}

function repoNoTracker(): string {
  const r = mkdtempSync(path.join(tmpdir(), 'kernloop-close-'));
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

interface CloseOut {
  op: string;
  mode: string;
  refusedExecute: boolean;
  tier: string;
  notice: string;
  checked: number;
  closed: number;
  wouldClose: number;
  alreadyClosed: number;
  failed: number;
  nodes: Array<{
    nodeId: string;
    issueRef: string;
    githubState?: string;
    action: string;
    reason?: string;
  }>;
}

/** A mock gh exec dispatching `issue view` (read) and `issue close` (mutation). */
function closeExec(stateByNumber: Record<string, 'OPEN' | 'CLOSED'>, closeFailFor: string[] = []) {
  const views: string[] = [];
  const closes: Array<{ num: string; argv: readonly string[] }> = [];
  const exec: TrackerExec = (_command, argv) => {
    const sub = argv[1];
    const num = argv.at(-1) as string;
    if (sub === 'view') {
      views.push(num);
      const state = stateByNumber[num] ?? 'OPEN';
      return Promise.resolve<ExecResult>({
        exitCode: 0,
        stdout: JSON.stringify({ number: Number(num), state }),
        stderr: '',
      });
    }
    if (sub === 'close') {
      closes.push({ num, argv });
      const fail = closeFailFor.includes(num);
      return Promise.resolve<ExecResult>({
        exitCode: fail ? 1 : 0,
        stdout: '',
        stderr: fail ? 'denied' : '',
      });
    }
    return Promise.resolve<ExecResult>({ exitCode: 1, stdout: '', stderr: 'unexpected sub' });
  };
  return { exec, views, closes };
}

/** prog.1 → done (ref 1); prog.2 → emitted (ref 2). Only prog.1 is a close target. */
async function oneDoneOneEmitted(tier: 'suggest' | 'enforce' = 'enforce'): Promise<string> {
  const r = repoWithTracker(tier);
  const spec = writeSpec(r, [STORY, { ...STORY, goal: 'Build logout' }]);
  await programCommand(
    ['create', '--goal', 'Ship auth', '--spec', spec, '--id', 'prog'],
    makeIo(r).io,
    helpers,
  );
  await programCommand(
    ['advance', '--program', 'prog', '--node', 'prog.1', '--state', 'emitted', '--ref', '1'],
    makeIo(r).io,
    helpers,
  );
  await programCommand(
    ['advance', '--program', 'prog', '--node', 'prog.1', '--state', 'done'],
    makeIo(r).io,
    helpers,
  );
  await programCommand(
    ['advance', '--program', 'prog', '--node', 'prog.2', '--state', 'emitted', '--ref', '2'],
    makeIo(r).io,
    helpers,
  );
  return r;
}

describe('kernloop program close — ledger-authoritative issue closure (#50)', () => {
  it('dry-run proposes closing the done node’s OPEN issue and spawns no close; emitted node untouched', async () => {
    const r = await oneDoneOneEmitted('suggest');
    const { exec, closes } = closeExec({ '1': 'OPEN' });
    const { io, out } = makeIo(r);
    const code = await programCommand(['close', '--program', 'prog'], io, helpers, { exec });
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as CloseOut;
    expect(report.mode).toBe('dry-run');
    expect(report.notice).toContain('DRY RUN');
    expect(report.checked).toBe(1); // ONLY prog.1 (done); prog.2 (emitted) is not a target
    expect(report.wouldClose).toBe(1);
    expect(report.closed).toBe(0);
    expect(report.nodes[0]!).toMatchObject({
      nodeId: 'prog.1',
      action: 'would-close',
      githubState: 'open',
    });
    expect(closes).toHaveLength(0); // dry-run mutates nothing
  });

  it('--execute at ENFORCE tier closes the open issue', async () => {
    const r = await oneDoneOneEmitted('enforce');
    const { exec, closes } = closeExec({ '1': 'OPEN' });
    const { io, out } = makeIo(r);
    const code = await programCommand(['close', '--program', 'prog', '--execute'], io, helpers, {
      exec,
    });
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as CloseOut;
    expect(report.mode).toBe('execute');
    expect(report.closed).toBe(1);
    expect(report.nodes[0]!.action).toBe('closed');
    expect(closes).toHaveLength(1);
    expect(closes[0]!.num).toBe('1');
    expect(closes[0]!.argv.some((a) => a === '--reason=completed')).toBe(true); // default reason
  });

  it('--execute at SUGGEST tier is REFUSED: stays dry-run, spawns no close, spells out the promotion', async () => {
    const r = await oneDoneOneEmitted('suggest');
    const { exec, closes } = closeExec({ '1': 'OPEN' });
    const { io, out } = makeIo(r);
    const code = await programCommand(['close', '--program', 'prog', '--execute'], io, helpers, {
      exec,
    });
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as CloseOut;
    expect(report.mode).toBe('dry-run');
    expect(report.refusedExecute).toBe(true);
    expect(report.notice).toContain('tracker tier is not enforce');
    expect(closes).toHaveLength(0);
  });

  it('an already-CLOSED issue is a no-op (no close spawned), exit 0', async () => {
    const r = await oneDoneOneEmitted('enforce');
    const { exec, closes } = closeExec({ '1': 'CLOSED' });
    const { io, out } = makeIo(r);
    const code = await programCommand(['close', '--program', 'prog', '--execute'], io, helpers, {
      exec,
    });
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as CloseOut;
    expect(report.alreadyClosed).toBe(1);
    expect(report.closed).toBe(0);
    expect(report.nodes[0]!.action).toBe('already-closed');
    expect(closes).toHaveLength(0);
  });

  it('a failed close is reported and exits 1', async () => {
    const r = await oneDoneOneEmitted('enforce');
    const { exec } = closeExec({ '1': 'OPEN' }, ['1']); // close of #1 fails
    const { io, out } = makeIo(r);
    const code = await programCommand(['close', '--program', 'prog', '--execute'], io, helpers, {
      exec,
    });
    expect(code).toBe(1);
    const report = JSON.parse(out[0]!) as CloseOut;
    expect(report.failed).toBe(1);
    expect(report.nodes[0]!).toMatchObject({ action: 'close-failed', reason: 'exit-nonzero' });
  });

  it('--node narrows to a single done node; a custom --reason is passed through', async () => {
    const r = await oneDoneOneEmitted('enforce');
    const { exec, closes } = closeExec({ '1': 'OPEN' });
    const { io, out } = makeIo(r);
    const code = await programCommand(
      ['close', '--program', 'prog', '--node', 'prog.1', '--reason', 'not planned', '--execute'],
      io,
      helpers,
      { exec },
    );
    expect(code).toBe(0);
    expect((JSON.parse(out[0]!) as CloseOut).checked).toBe(1);
    expect(closes[0]!.argv.some((a) => a === '--reason=not planned')).toBe(true);
  });

  it('a program with no done nodes closes to a clean exit 0 (nothing to close)', async () => {
    const r = repoWithTracker('enforce');
    const spec = writeSpec(r, [STORY]);
    await programCommand(
      ['create', '--goal', 'Ship auth', '--spec', spec, '--id', 'prog'],
      makeIo(r).io,
      helpers,
    );
    const { exec, views, closes } = closeExec({});
    const { io, out } = makeIo(r);
    const code = await programCommand(['close', '--program', 'prog', '--execute'], io, helpers, {
      exec,
    });
    expect(code).toBe(0);
    expect(views).toHaveLength(0);
    expect(closes).toHaveLength(0);
    expect((JSON.parse(out[0]!) as CloseOut).checked).toBe(0);
  });

  it('close of a nonexistent program exits 1 cleanly', async () => {
    const r = repoWithTracker();
    const { exec } = closeExec({});
    const { io, err } = makeIo(r);
    const code = await programCommand(['close', '--program', 'never-made'], io, helpers, { exec });
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('ProgramInputError');
  });

  it('close with no tracker configured exits 1 cleanly', async () => {
    const r = repoNoTracker();
    const spec = writeSpec(r, [STORY]);
    await programCommand(
      ['create', '--goal', 'Ship auth', '--spec', spec, '--id', 'prog'],
      makeIo(r).io,
      helpers,
    );
    await programCommand(
      ['advance', '--program', 'prog', '--node', 'prog.1', '--state', 'emitted', '--ref', '1'],
      makeIo(r).io,
      helpers,
    );
    await programCommand(
      ['advance', '--program', 'prog', '--node', 'prog.1', '--state', 'done'],
      makeIo(r).io,
      helpers,
    );
    const { io, err } = makeIo(r);
    const code = await programCommand(['close', '--program', 'prog', '--execute'], io, helpers);
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('ProgramInputError');
  });

  it('audits cli.program.close ONCE with counts only (no goal verbatim)', async () => {
    const r = await oneDoneOneEmitted('enforce');
    const { exec } = closeExec({ '1': 'OPEN' });
    await programCommand(['close', '--program', 'prog', '--execute'], makeIo(r).io, helpers, {
      exec,
    });
    const events = auditEvents(r).filter((e) => e.type === 'cli.program.close');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      op: 'close',
      programId: 'prog',
      mode: 'execute',
      refusedExecute: false,
      tier: 'enforce',
      checked: 1,
      closed: 1,
      alreadyClosed: 0,
      failed: 0,
    });
    const text = readFileSync(path.join(r, '.kernloop', 'audit.jsonl'), 'utf8');
    expect(text).not.toContain('Build login');
    expect(text).not.toContain('Ship auth');
  });
});
