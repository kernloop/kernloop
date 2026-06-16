/**
 * The post-run issue close `kernloop run --closes-issue N` (#211, CLM-0118).
 * Proves the EARNED-success rule: the issue is closed only when the run
 * succeeded AND the tracker tier is enforce; a non-success run skips the close
 * entirely (touches GitHub not at all), a suggest tier refuses (would-close),
 * an already-closed issue is a no-op, and every path audits once.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExecResult, TrackerExec } from '@kernloop/tracker';
import { initOverlay } from './overlay.js';
import { createKernloop, type Kernloop } from './kernel.js';
import { closeIssueAfterRun } from './run-close.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function kernWithTracker(tier: 'suggest' | 'enforce' | 'none'): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-run-close-'));
  dirs.push(repo);
  initOverlay(repo);
  if (tier !== 'none') {
    writeFileSync(
      path.join(repo, '.kernloop', 'overlay.yaml'),
      `id: t\ntracker:\n  provider: github\n  repo: kernloop/kernloop\n  tier: ${tier}\n`,
    );
  }
  return createKernloop({ overlayDir: path.join(repo, '.kernloop') });
}

/** A mock gh exec dispatching `issue view` (read) and `issue close` (mutation). */
function closeExec(state: 'OPEN' | 'CLOSED' = 'OPEN') {
  const closes: Array<readonly string[]> = [];
  const exec: TrackerExec = (_command, argv) => {
    const num = argv.at(-1) as string;
    if (argv[1] === 'view') {
      return Promise.resolve<ExecResult>({
        exitCode: 0,
        stdout: JSON.stringify({ number: Number(num), state }),
        stderr: '',
      });
    }
    closes.push(argv);
    return Promise.resolve<ExecResult>({ exitCode: 0, stdout: '', stderr: '' });
  };
  return { exec, closes };
}

function auditTypes(kern: Kernloop): string[] {
  return readFileSync(path.join(kern.paths.dir, 'audit.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { type: string }).type);
}

describe('closeIssueAfterRun — earned-success issue closure (#211)', () => {
  it('closes the open issue when the run SUCCEEDED at enforce tier', async () => {
    const kern = kernWithTracker('enforce');
    const { exec, closes } = closeExec('OPEN');
    const report = await closeIssueAfterRun(kern, '42', true, exec);
    expect(report.mode).toBe('execute');
    expect(report.action).toBe('closed');
    expect(closes).toHaveLength(1);
    expect(closes[0]!.at(-1)).toBe('42');
    expect(auditTypes(kern)).toContain('cli.run.close');
    kern.close();
  });

  it('SKIPS the close when the run did not succeed — touches GitHub not at all', async () => {
    const kern = kernWithTracker('enforce');
    const { exec, closes } = closeExec('OPEN');
    const report = await closeIssueAfterRun(kern, '42', false, exec);
    expect(report.action).toBe('skipped-run-not-success');
    expect(closes).toHaveLength(0); // no close, and getIssue never ran either
    expect(auditTypes(kern)).toContain('cli.run.close');
    kern.close();
  });

  it('REFUSES at suggest tier even on success (would-close, refusedExecute)', async () => {
    const kern = kernWithTracker('suggest');
    const { exec, closes } = closeExec('OPEN');
    const report = await closeIssueAfterRun(kern, '42', true, exec);
    expect(report.mode).toBe('dry-run');
    expect(report.refusedExecute).toBe(true);
    expect(report.action).toBe('would-close');
    expect(closes).toHaveLength(0);
    kern.close();
  });

  it('an already-CLOSED issue is a no-op on success', async () => {
    const kern = kernWithTracker('enforce');
    const { exec, closes } = closeExec('CLOSED');
    const report = await closeIssueAfterRun(kern, '42', true, exec);
    expect(report.action).toBe('already-closed');
    expect(closes).toHaveLength(0);
    kern.close();
  });

  it('a --closes-issue with no tracker configured is a clean error', async () => {
    const kern = kernWithTracker('none');
    await expect(closeIssueAfterRun(kern, '42', true)).rejects.toThrow('no tracker configured');
    kern.close();
  });
});
