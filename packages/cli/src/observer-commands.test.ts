/**
 * The `kernloop observer` CLI consumer suite (CLM-0094). Proves the gated,
 * dry-run-first closure path: `file` is dry-run by default (and spawns
 * nothing), an `--execute` is honored ONLY at the enforce tier (where it files
 * via the tracker AND marks the row filed with the returned url), `propose <n>`
 * snapshots a live lifecycle proposal into `observer_issues` and de-dupes by
 * title, and every acting op is audited as `cli.observer.<op>` without the body
 * verbatim. The HARD INVARIANT: no auto-action — suggest stays dry-run.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecResult, TrackerExec } from '@kernloop/tracker';
import { createObserver, type Observer } from '@kernloop/faculty-observer';
import type { Outcome, OutcomeStatus } from '@kernloop/contracts';
import { initOverlay } from './overlay.js';
import { observerCommand } from './observer-commands.js';
import type { CliIo } from './cli.js';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-observer-cli-'));
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
} as unknown as Parameters<typeof observerCommand>[2];

/** A recording exec for the execute-mode tests (resolves to issues/7). */
function recordingExec(): {
  exec: TrackerExec;
  calls: Array<{ command: string; argv: readonly string[] }>;
} {
  const calls: Array<{ command: string; argv: readonly string[] }> = [];
  const exec: TrackerExec = (command, argv) => {
    calls.push({ command, argv });
    return Promise.resolve<ExecResult>({
      exitCode: 0,
      stdout: 'https://github.com/kernloop/kernloop/issues/7',
      stderr: '',
    });
  };
  return { exec, calls };
}

function auditEvents(repo: string): Array<{ type: string; payload: Record<string, unknown> }> {
  const file = path.join(repo, '.kernloop', 'audit.jsonl');
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> });
}

function makeOutcome(taskId: string, status: OutcomeStatus): Outcome {
  return {
    taskId,
    status,
    signals: [],
    cost: { tokens: 100, usd: 0.5, wallClockMs: 1000 },
    traceRef: `trace://${taskId}`,
    distillCandidates: [],
  };
}

/** Seed the overlay's observer DB with a below-floor subject → a deprecation
 * lifecycle proposal becomes live. Opens the SAME memory.sqlite the CLI reads. */
function seedDeprecation(repo: string, subject: string): void {
  let now = 1000;
  const observer: Observer = createObserver(path.join(repo, '.kernloop', 'memory.sqlite'), {
    clock: () => ++now,
  });
  const statuses: OutcomeStatus[] = [
    ...Array<OutcomeStatus>(3).fill('success'),
    ...Array<OutcomeStatus>(9).fill('failure'),
  ];
  for (const [i, status] of statuses.entries()) {
    observer.ingestOutcome(makeOutcome(`${subject}-${String(i)}`, status), { subject });
  }
  observer.close();
}

describe('kernloop observer — proposals + propose (the suggest-tier seam)', () => {
  it('proposals lists the live lifecycle proposals and spawns nothing', async () => {
    const repo = repoWithTracker('suggest');
    seedDeprecation(repo, 'flaky-tool');
    const { io, out } = makeIo(repo);
    const code = await observerCommand(['proposals'], io, helpers);
    expect(code).toBe(0);
    const rows = JSON.parse(out[0]!) as Array<{ kind: string; subject: string }>;
    expect(rows.some((r) => r.subject === 'flaky-tool' && r.kind === 'deprecation')).toBe(true);
  });

  it('propose <n> persists the n-th proposal and audits cli.observer.propose', async () => {
    const repo = repoWithTracker('suggest');
    seedDeprecation(repo, 'flaky-tool');
    const { io, out } = makeIo(repo);
    const code = await observerCommand(['propose', '0'], io, helpers);
    expect(code).toBe(0);
    const persisted = JSON.parse(out[0]!) as { id: number; status: string };
    expect(persisted.status).toBe('proposed');
    expect(auditEvents(repo).some((e) => e.type === 'cli.observer.propose')).toBe(true);
  });

  it('propose <n> de-dupes by title — a re-run skips, persisting nothing new', async () => {
    const repo = repoWithTracker('suggest');
    seedDeprecation(repo, 'flaky-tool');
    const { io, out } = makeIo(repo);
    await observerCommand(['propose', '0'], io, helpers);
    expect((JSON.parse(out[0]!) as { id: number }).id).toBeDefined();
    const { io: io2, out: out2 } = makeIo(repo);
    await observerCommand(['propose', '0'], io2, helpers);
    const second = JSON.parse(out2[0]!) as { skipped?: boolean };
    expect(second.skipped).toBe(true);
    const { io: io3, out: out3 } = makeIo(repo);
    await observerCommand(['list'], io3, helpers);
    const listed = JSON.parse(out3[0]!) as unknown[];
    expect(listed).toHaveLength(1);
  });
});

describe('kernloop observer file — the enforce-tier gate (no auto-action)', () => {
  /** Persist one proposal directly so `file` has a row to act on. */
  function seedOneProposal(repo: string): number {
    let now = 1000;
    const observer = createObserver(path.join(repo, '.kernloop', 'memory.sqlite'), {
      clock: () => ++now,
    });
    const p = observer.proposeIssue({
      title: 'observer: deprecate flaky-tool',
      body: 'SECRET-BODY-TEXT lifetime success below the floor',
      taskShaped: { goal: 'review flaky-tool for deprecation' },
    });
    observer.close();
    return p.id;
  }

  it('file with no --execute prints a DRY RUN proposal, spawns nothing, marks nothing', async () => {
    const repo = repoWithTracker('suggest');
    const id = seedOneProposal(repo);
    const { io, out } = makeIo(repo);
    const never: TrackerExec = () => {
      throw new Error('a dry-run must not spawn');
    };
    const code = await observerCommand([`file`, String(id)], io, helpers, { exec: never });
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as { mode: string; notice: string; proposal: unknown };
    expect(report.mode).toBe('dry-run');
    expect(report.notice).toContain('DRY RUN');
    expect(report.proposal).toBeDefined();
    // Row stays proposed — nothing filed.
    const { io: io2, out: out2 } = makeIo(repo);
    await observerCommand(['list'], io2, helpers);
    const listed = JSON.parse(out2[0]!) as Array<{ status: string; url: string | undefined }>;
    expect(listed[0]!.status).toBe('proposed');
    expect(listed[0]!.url).toBeUndefined();
  });

  it('refuses --execute at the suggest tier (stays dry-run, marks nothing)', async () => {
    const repo = repoWithTracker('suggest');
    const id = seedOneProposal(repo);
    const { io, out } = makeIo(repo);
    const { exec, calls } = recordingExec();
    const code = await observerCommand([`file`, String(id), '--execute'], io, helpers, { exec });
    expect(code).toBe(0);
    expect(calls).toHaveLength(0); // never spawned
    const report = JSON.parse(out[0]!) as { mode: string; refusedExecute: boolean; notice: string };
    expect(report.mode).toBe('dry-run');
    expect(report.refusedExecute).toBe(true);
    expect(report.notice).toContain('refused');
    const { io: io2, out: out2 } = makeIo(repo);
    await observerCommand(['list'], io2, helpers);
    const listed = JSON.parse(out2[0]!) as Array<{ status: string }>;
    expect(listed[0]!.status).toBe('proposed');
  });

  it('honors --execute at enforce: files via the tracker AND marks the row filed', async () => {
    const repo = repoWithTracker('enforce');
    const id = seedOneProposal(repo);
    const { io, out } = makeIo(repo);
    const { exec, calls } = recordingExec();
    const code = await observerCommand([`file`, String(id), '--execute'], io, helpers, { exec });
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('gh');
    expect(calls[0]!.argv.slice(0, 2)).toEqual(['issue', 'create']);
    const report = JSON.parse(out[0]!) as {
      mode: string;
      result: { ok: boolean; ref: string };
      filed: { status: string; url: string };
    };
    expect(report.mode).toBe('execute');
    expect(report.result.ok).toBe(true);
    expect(report.filed.status).toBe('filed');
    expect(report.filed.url).toBe('https://github.com/kernloop/kernloop/issues/7');
  });

  it('audits cli.observer.file without the body verbatim (only bodyChars)', async () => {
    const repo = repoWithTracker('enforce');
    const id = seedOneProposal(repo);
    const { io } = makeIo(repo);
    const { exec } = recordingExec();
    await observerCommand([`file`, String(id), '--execute'], io, helpers, { exec });
    const file = readFileSync(path.join(repo, '.kernloop', 'audit.jsonl'), 'utf8');
    expect(file).toContain('cli.observer.file');
    expect(file).not.toContain('SECRET-BODY-TEXT');
    const fileEvent = auditEvents(repo).find((e) => e.type === 'cli.observer.file');
    expect(typeof fileEvent?.payload.bodyChars).toBe('number');
    expect(fileEvent?.payload.ok).toBe(true);
  });

  it('errors on an unknown id and on an already-filed row', async () => {
    const repo = repoWithTracker('enforce');
    const id = seedOneProposal(repo);
    const { io } = makeIo(repo);
    await expect(observerCommand(['file', '999'], io, helpers)).rejects.toThrow(
      /no proposed issue/,
    );
    const { exec } = recordingExec();
    await observerCommand([`file`, String(id), '--execute'], io, helpers, { exec });
    const { io: io2 } = makeIo(repo);
    await expect(
      observerCommand([`file`, String(id), '--execute'], io2, helpers, { exec }),
    ).rejects.toThrow(/already filed/);
  });

  it('surfaces a boundary rejection in DRY RUN too (oversize title → exit 1, not a green preview)', async () => {
    const repo = repoWithTracker('suggest');
    let now = 1000;
    const observer = createObserver(path.join(repo, '.kernloop', 'memory.sqlite'), {
      clock: () => ++now,
    });
    // A title over the tracker's 256-char cap: proposeIssue accepts it, but the
    // tracker boundary rejects it — the dry-run must report that, not exit 0.
    const id = observer.proposeIssue({
      title: 'x'.repeat(300),
      body: 'b',
      taskShaped: { goal: 'g' },
    }).id;
    observer.close();
    const { io, out } = makeIo(repo);
    const never: TrackerExec = () => {
      throw new Error('a dry-run must not spawn');
    };
    const code = await observerCommand([`file`, String(id)], io, helpers, { exec: never });
    expect(code).toBe(1);
    const report = JSON.parse(out[0]!) as { result?: { ok: boolean; reason: string } };
    expect(report.result?.ok).toBe(false);
    expect(report.result?.reason).toBe('invalid-input');
  });

  it('an execute-mode tracker failure exits 1 and leaves the row proposed (not filed)', async () => {
    const repo = repoWithTracker('enforce');
    const id = seedOneProposal(repo);
    const { io, out } = makeIo(repo);
    const failingExec: TrackerExec = () =>
      Promise.resolve<ExecResult>({ exitCode: 1, stdout: '', stderr: 'gh: not authenticated' });
    const code = await observerCommand([`file`, String(id), '--execute'], io, helpers, {
      exec: failingExec,
    });
    expect(code).toBe(1);
    const report = JSON.parse(out[0]!) as { mode: string; result: { ok: boolean; reason: string } };
    expect(report.mode).toBe('execute');
    expect(report.result.ok).toBe(false);
    expect(report.result.reason).toBe('exit-nonzero');
    // The row must NOT be marked filed on a failed execute.
    const { io: io2, out: out2 } = makeIo(repo);
    await observerCommand(['list'], io2, helpers);
    expect((JSON.parse(out2[0]!) as Array<{ status: string }>)[0]!.status).toBe('proposed');
  });

  it('errors clearly when no tracker is configured', async () => {
    const repo = tmp();
    initOverlay(repo);
    const id = seedOneProposal(repo);
    const { io } = makeIo(repo);
    await expect(observerCommand(['file', String(id)], io, helpers)).rejects.toThrow(/no tracker/);
  });

  it('rejects a non-integer id with a usage error (no NaN leaking to the DB)', async () => {
    const repo = repoWithTracker('suggest');
    const { io } = makeIo(repo);
    await expect(observerCommand(['file', 'abc'], io, helpers)).rejects.toThrow(/usage/);
  });

  it('rejects an unknown verb', async () => {
    const repo = repoWithTracker('suggest');
    const { io } = makeIo(repo);
    await expect(observerCommand(['frobnicate'], io, helpers)).rejects.toThrow(/usage/);
  });
});
