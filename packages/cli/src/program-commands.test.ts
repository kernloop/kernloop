/**
 * The `kernloop program decompose` CLI suite (CLM-0096). Proves the wired,
 * suggest-tier preview path: a valid goal+spec prints the proposed epic/story
 * child tree with correct child ids + altitude tags and audits
 * `cli.program.decompose` (goalChars, never the goal verbatim); a budget-breach
 * and a bad altitude exit 1 with a clear message; a missing `--goal`/`--spec`
 * throws a usage error. It is a pure preview — it mutates nothing (no GitHub).
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
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-program-cli-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A bare repo overlay (no tracker needed — decompose never touches one). */
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

/** A repo overlay carrying a tracker block at the given tier (emit needs one). */
function repoWithTracker(tier: 'suggest' | 'enforce'): string {
  const r = tmp();
  initOverlay(r);
  writeFileSync(
    path.join(r, '.kernloop', 'overlay.yaml'),
    `id: t\ntracker:\n  provider: github\n  repo: kernloop/kernloop\n  tier: ${tier}\n`,
  );
  return r;
}

/** A recording exec that resolves every gh create to issues/7 (execute mode). */
function recordingExec(): {
  exec: TrackerExec;
  calls: Array<{ command: string; argv: readonly string[] }>;
} {
  const calls: Array<{ command: string; argv: readonly string[] }> = [];
  const stdout = 'https://github.com/kernloop/kernloop/issues/7';
  const exec: TrackerExec = (command, argv) => {
    calls.push({ command, argv });
    return Promise.resolve<ExecResult>({ exitCode: 0, stdout, stderr: '' });
  };
  return { exec, calls };
}

/** An exec that throws — proves a dry-run / refused-execute spawns nothing. */
const throwingExec: TrackerExec = () => {
  throw new Error('emit must not spawn in dry-run / refused-execute');
};

interface NodeRow {
  id: string;
  labels: string[];
  proposal?: { argv: readonly string[] };
  result?: { ok: boolean; ref?: string; reason?: string };
}
interface EmitOut {
  mode: string;
  refusedExecute: boolean;
  nodeCount: number;
  notice: string;
  nodes: NodeRow[];
}

describe('kernloop program emit — the gated GitHub emission (no auto-action)', () => {
  it('dry-run prints per-node proposals + mapped labels and spawns nothing', async () => {
    const r = repoWithTracker('suggest');
    const spec = writeSpec(r, [
      STORY,
      { ...STORY, goal: 'Build logout', altitude: 'story', track: 'auth', sprint: 's1' },
    ]);
    const { io, out } = makeIo(r);
    const code = await programCommand(
      ['emit', '--goal', 'Ship auth', '--spec', spec, '--id', 'prog'],
      io,
      helpers,
      { exec: throwingExec },
    );
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as EmitOut;
    expect(report.mode).toBe('dry-run');
    expect(report.nodeCount).toBe(2);
    expect(report.notice).toContain('DRY RUN');
    expect(report.nodes[0]!.labels.sort()).toEqual(['agent:coder', 'altitude:story']);
    expect(report.nodes[1]!.labels.sort()).toEqual([
      'agent:coder',
      'altitude:story',
      'sprint:s1',
      'track:auth',
    ]);
    // The would-be gh invocation is surfaced as a proposal (nothing spawned).
    expect(report.nodes[0]!.proposal?.argv.slice(0, 2)).toEqual(['issue', 'create']);
  });

  it('refuses --execute at the suggest tier (stays dry-run, spawns nothing)', async () => {
    const r = repoWithTracker('suggest');
    const spec = writeSpec(r, [STORY]);
    const { io, out } = makeIo(r);
    const { exec, calls } = recordingExec();
    const code = await programCommand(
      ['emit', '--goal', 'G', '--spec', spec, '--execute'],
      io,
      helpers,
      { exec },
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    const report = JSON.parse(out[0]!) as EmitOut;
    expect(report.mode).toBe('dry-run');
    expect(report.refusedExecute).toBe(true);
    expect(report.notice).toContain('refused');
  });

  it('files one issue per node at enforce with the mapped labels and prints the refs', async () => {
    const r = repoWithTracker('enforce');
    const spec = writeSpec(r, [STORY, { ...STORY, goal: 'Build logout', track: 'auth' }]);
    const { io, out } = makeIo(r);
    const { exec, calls } = recordingExec();
    const code = await programCommand(
      ['emit', '--goal', 'G', '--spec', spec, '--execute'],
      io,
      helpers,
      { exec },
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(2); // one gh issue create per node
    expect(calls[0]!.command).toBe('gh');
    expect(calls[0]!.argv.slice(0, 2)).toEqual(['issue', 'create']);
    // The second node carries the track:auth label as a --label flag to gh.
    expect(calls[1]!.argv.some((a) => a === '--label=track:auth')).toBe(true);
    const report = JSON.parse(out[0]!) as EmitOut;
    expect(report.mode).toBe('execute');
    expect(report.nodes.every((n) => n.result?.ok === true)).toBe(true);
    expect(report.nodes[0]!.result?.ref).toBe('https://github.com/kernloop/kernloop/issues/7');
  });

  it('the spam guard refuses >20 nodes without --confirm-count, and proceeds with the exact count', async () => {
    const r = repoWithTracker('suggest');
    // 21 small stories: budgets sum within the default overlay (100k/1/30).
    const small = {
      goal: 'x',
      budget: { tokens: 4_000, usd: 0.04, wallClockMin: 1 },
      assignTo: 'coder',
      altitude: 'story',
    };
    const spec = writeSpec(r, Array<typeof small>(21).fill(small));
    const { io, err } = makeIo(r);
    const code = await programCommand(['emit', '--goal', 'G', '--spec', spec], io, helpers, {
      exec: throwingExec,
    });
    expect(code).toBe(1);
    const refused = JSON.parse(err[0]!) as { error: string; message: string };
    expect(refused.error).toBe('ProgramInputError');
    expect(refused.message).toContain('spam guard');
    // With the exact --confirm-count it proceeds (dry-run, 21 proposals).
    const { io: io2, out: out2 } = makeIo(r);
    const ok = await programCommand(
      ['emit', '--goal', 'G', '--spec', spec, '--confirm-count', '21'],
      io2,
      helpers,
      { exec: throwingExec },
    );
    expect(ok).toBe(0);
    expect((JSON.parse(out2[0]!) as EmitOut).nodeCount).toBe(21);
  });

  it('audits cli.program.emit once and never the node goal/body verbatim', async () => {
    const r = repoWithTracker('enforce');
    const SECRET = 'SECRET-NODE-GOAL-do-not-leak';
    const spec = writeSpec(r, [{ ...STORY, goal: SECRET }]);
    const { io } = makeIo(r);
    const { exec } = recordingExec();
    await programCommand(['emit', '--goal', 'G', '--spec', spec, '--execute'], io, helpers, {
      exec,
    });
    const raw = readFileSync(path.join(r, '.kernloop', 'audit.jsonl'), 'utf8');
    expect(raw).toContain('cli.program.emit');
    expect(raw).not.toContain(SECRET);
    const events = auditEvents(r).filter((e) => e.type === 'cli.program.emit');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.nodeCount).toBe(1);
    expect(events[0]!.payload.mode).toBe('execute');
  });

  it('an execute-mode tracker failure exits 1 (errors-as-data, not a throw)', async () => {
    const r = repoWithTracker('enforce');
    const spec = writeSpec(r, [STORY]);
    const { io, out } = makeIo(r);
    const failingExec: TrackerExec = () =>
      Promise.resolve<ExecResult>({ exitCode: 1, stdout: '', stderr: 'gh: not authenticated' });
    const code = await programCommand(
      ['emit', '--goal', 'G', '--spec', spec, '--execute'],
      io,
      helpers,
      { exec: failingExec },
    );
    expect(code).toBe(1);
    const report = JSON.parse(out[0]!) as EmitOut;
    expect(report.mode).toBe('execute');
    expect(report.nodes[0]!.result?.ok).toBe(false);
    expect(report.nodes[0]!.result?.reason).toBe('exit-nonzero');
  });

  it('a pure dry-run preview proceeds with NO tracker block, spawning nothing (#94)', async () => {
    const r = repo(); // bare overlay — no tracker block
    const spec = writeSpec(r, [STORY]);
    const { io, out } = makeIo(r);
    const code = await programCommand(['emit', '--goal', 'G', '--spec', spec], io, helpers, {
      exec: throwingExec,
    });
    expect(code).toBe(0); // a preview is not an error
    const report = JSON.parse(out[0]!) as EmitOut;
    expect(report.mode).toBe('dry-run');
    expect(report.notice).toContain('no tracker configured');
    expect(report.nodeCount).toBe(1);
    expect(report.nodes[0]!.proposal?.argv.slice(0, 2)).toEqual(['issue', 'create']);
  });

  it('--execute with no tracker block is a clean input error (#94)', async () => {
    const r = repo(); // bare overlay — no tracker block
    const spec = writeSpec(r, [STORY]);
    const { io, err } = makeIo(r);
    const code = await programCommand(
      ['emit', '--goal', 'G', '--spec', spec, '--execute'],
      io,
      helpers,
    );
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { message: string }).message).toContain('no tracker');
  });
});
