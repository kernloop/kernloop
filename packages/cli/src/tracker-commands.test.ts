/**
 * The `kernloop tracker` CLI consumer suite (CLM-0093). Proves the gated,
 * dry-run-first wiring: dry-run is the default (and spawns nothing), an
 * `--execute` is honored ONLY at the enforce tier, every op is audited as
 * `cli.tracker.<op>` without the body verbatim, and the repo scope comes from
 * the overlay config.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecResult, TrackerExec } from '@kernloop/tracker';
import { initOverlay } from './overlay.js';
import { trackerCommand, resolveMode } from './tracker-commands.js';
import type { CliIo } from './cli.js';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-tracker-cli-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repo overlay with a tracker block at the given tier. */
function repoWithTracker(tier: 'suggest' | 'enforce'): string {
  const repo = tmp();
  initOverlay(repo);
  writeFileSync(
    path.join(repo, '.kernloop', 'overlay.yaml'),
    `id: t\ntracker:\n  provider: github\n  repo: kernloop/kernloop\n  tier: ${tier}\n`,
  );
  return repo;
}

/** Capture stdout/stderr; cwd is the repo so the overlay loads from there. */
function makeIo(cwd: string): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t) => out.push(t), err: (t) => err.push(t), cwd }, out, err };
}

const helpers = {
  outFlags: () => ({}),
  strFlags: () => ({}),
  mixedFlags: (args: string[], strs: readonly string[], bools: readonly string[]) => {
    const v: Record<string, string | boolean> = {};
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a.startsWith('--')) {
        const name = a.slice(2);
        if (bools.includes(name)) v[name] = true;
        else if (strs.includes(name)) v[name] = args[++i]!;
      }
    }
    return v;
  },
  withKernloop: async () => 0,
  str: (x: string | boolean | undefined) => (typeof x === 'string' ? x : undefined),
} as unknown as Parameters<typeof trackerCommand>[2];

/** A recording exec for the execute-mode tests. */
function recordingExec(): {
  exec: TrackerExec;
  calls: Array<{ command: string; argv: readonly string[] }>;
} {
  const calls: Array<{ command: string; argv: readonly string[] }> = [];
  const exec: TrackerExec = (command, argv) => {
    calls.push({ command, argv });
    return Promise.resolve<ExecResult>({
      exitCode: 0,
      stdout: 'https://github.com/kernloop/kernloop/issues/1',
      stderr: '',
    });
  };
  return { exec, calls };
}

function auditTypes(repo: string): string[] {
  const file = path.join(repo, '.kernloop', 'audit.jsonl');
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { type: string }).type);
}

describe('resolveMode — the enforce-tier gate', () => {
  it('no --execute → dry-run', () => {
    expect(resolveMode('enforce', false)).toEqual({ mode: 'dry-run', refusedExecute: false });
  });
  it('--execute at enforce → execute', () => {
    expect(resolveMode('enforce', true)).toEqual({ mode: 'execute', refusedExecute: false });
  });
  it('--execute at suggest → dry-run, refused (never defaults upward)', () => {
    expect(resolveMode('suggest', true)).toEqual({ mode: 'dry-run', refusedExecute: true });
  });
  it('--execute with no tier → dry-run, refused', () => {
    expect(resolveMode(undefined, true)).toEqual({ mode: 'dry-run', refusedExecute: true });
  });
});

describe('kernloop tracker — dry-run by default', () => {
  it('create with no --execute prints a DRY RUN proposal and spawns nothing', async () => {
    const repo = repoWithTracker('suggest');
    const bodyFile = path.join(repo, 'body.md');
    writeFileSync(bodyFile, 'the issue body');
    const { io, out } = makeIo(repo);
    const never: TrackerExec = () => {
      throw new Error('a dry-run must not spawn');
    };
    const code = await trackerCommand(
      ['create', '--title', 'Hello', '--body-file', bodyFile],
      io,
      helpers,
      { exec: never },
    );
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as { notice: string; proposal: { argv: string[] } };
    expect(report.notice).toContain('DRY RUN');
    expect(report.proposal.argv).toContain('--title=Hello');
    expect(report.proposal.argv).toContain('kernloop/kernloop'); // repo from config
  });

  it('audits the op as cli.tracker.create without the body verbatim', async () => {
    const repo = repoWithTracker('suggest');
    const bodyFile = path.join(repo, 'body.md');
    writeFileSync(bodyFile, 'SECRET-BODY-TEXT');
    const { io } = makeIo(repo);
    await trackerCommand(['create', '--title', 'T', '--body-file', bodyFile], io, helpers);
    const audit = readFileSync(path.join(repo, '.kernloop', 'audit.jsonl'), 'utf8');
    expect(audit).toContain('cli.tracker.create');
    expect(audit).not.toContain('SECRET-BODY-TEXT');
    expect(audit).toContain('"bodyChars"');
  });
});

describe('kernloop tracker — the enforce-tier gate', () => {
  it('refuses --execute at the suggest tier (stays dry-run)', async () => {
    const repo = repoWithTracker('suggest');
    const bodyFile = path.join(repo, 'b.md');
    writeFileSync(bodyFile, 'body');
    const { io, out } = makeIo(repo);
    const { exec, calls } = recordingExec();
    const code = await trackerCommand(
      ['create', '--title', 'T', '--body-file', bodyFile, '--execute'],
      io,
      helpers,
      { exec },
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(0); // never spawned
    const report = JSON.parse(out[0]!) as { mode: string; refusedExecute: boolean; notice: string };
    expect(report.mode).toBe('dry-run');
    expect(report.refusedExecute).toBe(true);
    expect(report.notice).toContain('refused');
  });

  it('honors --execute at the enforce tier and runs the allowlisted gh op', async () => {
    const repo = repoWithTracker('enforce');
    const bodyFile = path.join(repo, 'b.md');
    writeFileSync(bodyFile, 'body');
    const { io, out } = makeIo(repo);
    const { exec, calls } = recordingExec();
    const code = await trackerCommand(
      ['create', '--title', 'T', '--body-file', bodyFile, '--execute'],
      io,
      helpers,
      { exec },
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('gh');
    expect(calls[0]!.argv.slice(0, 2)).toEqual(['issue', 'create']);
    const report = JSON.parse(out[0]!) as { mode: string; result: { ok: boolean } };
    expect(report.mode).toBe('execute');
    expect(report.result.ok).toBe(true);
    expect(auditTypes(repo)).toContain('cli.tracker.create');
  });
});

describe('kernloop tracker — close/comment/label verbs + errors', () => {
  it('close <ref> at enforce builds gh issue close with the ref', async () => {
    const repo = repoWithTracker('enforce');
    const { io } = makeIo(repo);
    const { exec, calls } = recordingExec();
    await trackerCommand(['close', '42', '--reason', 'completed', '--execute'], io, helpers, {
      exec,
    });
    expect(calls[0]!.argv.slice(0, 2)).toEqual(['issue', 'close']);
    expect(calls[0]!.argv.at(-1)).toBe('42');
  });

  it('label <ref> --add builds gh issue edit --add-label=', async () => {
    const repo = repoWithTracker('enforce');
    const { io } = makeIo(repo);
    const { exec, calls } = recordingExec();
    await trackerCommand(['label', '7', '--add', 'security', '--execute'], io, helpers, { exec });
    expect(calls[0]!.argv.slice(0, 2)).toEqual(['issue', 'edit']);
    expect(calls[0]!.argv).toContain('--add-label=security');
  });

  it('create accepts MULTIPLE --label flags, planning every label (#76)', async () => {
    const repo = repoWithTracker('enforce');
    const bodyFile = path.join(repo, 'b.md');
    writeFileSync(bodyFile, 'body');
    const { io } = makeIo(repo);
    const { exec, calls } = recordingExec();
    await trackerCommand(
      ['create', '--title', 'T', '--body-file', bodyFile, '--label', 'a', '--label=b', '--execute'],
      io,
      helpers,
      { exec },
    );
    expect(calls[0]!.argv).toContain('--label=a');
    expect(calls[0]!.argv).toContain('--label=b');
  });

  it('label <ref> accepts MULTIPLE --add flags (#76)', async () => {
    const repo = repoWithTracker('enforce');
    const { io } = makeIo(repo);
    const { exec, calls } = recordingExec();
    await trackerCommand(
      ['label', '7', '--add', 'security', '--add', 'review-finding', '--execute'],
      io,
      helpers,
      {
        exec,
      },
    );
    expect(calls[0]!.argv).toContain('--add-label=security');
    expect(calls[0]!.argv).toContain('--add-label=review-finding');
  });

  it('audits the REAL created issue ref on a successful execute (not a placeholder)', async () => {
    const repo = repoWithTracker('enforce');
    const bodyFile = path.join(repo, 'b.md');
    writeFileSync(bodyFile, 'body');
    const { io } = makeIo(repo);
    const { exec } = recordingExec(); // stdout resolves to .../issues/1
    await trackerCommand(
      ['create', '--title', 'T', '--body-file', bodyFile, '--execute'],
      io,
      helpers,
      {
        exec,
      },
    );
    const audit = readFileSync(path.join(repo, '.kernloop', 'audit.jsonl'), 'utf8');
    const create = audit
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string; payload: { ref: string } })
      .find((e) => e.type === 'cli.tracker.create');
    expect(create?.payload.ref).toBe('https://github.com/kernloop/kernloop/issues/1');
  });

  it('errors when no tracker is configured', async () => {
    const repo = tmp();
    initOverlay(repo);
    const { io } = makeIo(repo);
    await expect(trackerCommand(['close', '1'], io, helpers)).rejects.toThrow(/no tracker/);
  });

  it('rejects an unknown verb', async () => {
    const repo = repoWithTracker('suggest');
    const { io } = makeIo(repo);
    await expect(trackerCommand(['frobnicate'], io, helpers)).rejects.toThrow(/usage/);
  });
});
