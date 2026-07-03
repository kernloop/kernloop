/**
 * Subprocess engine acceptance tests (CLM-0019): capture of stdout, stderr,
 * and exit code, plus wall-clock timeout enforcement with process-tree kill.
 *
 * All tests run REAL child processes via `process.execPath` (the running
 * Node binary) — never a real model CLI. Timing assertions are monotonic
 * bounds only (a killed call settles well before its child's natural
 * lifetime), never exact wall-clock values.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSubprocess } from './subprocess.js';

/** Run an inline Node script as a real subprocess. */
function runNode(
  script: string,
  overrides: Partial<{ stdin: string; timeoutMs: number; maxCaptureBytes: number }> = {},
): ReturnType<typeof runSubprocess> {
  return runSubprocess({
    command: process.execPath,
    args: ['-e', script],
    timeoutMs: overrides.timeoutMs ?? 10_000,
    ...(overrides.stdin === undefined ? {} : { stdin: overrides.stdin }),
    ...(overrides.maxCaptureBytes === undefined
      ? {}
      : { maxCaptureBytes: overrides.maxCaptureBytes }),
  });
}

/**
 * Poll until `pid` no longer exists (ESRCH) or is a zombie, or fail after ~2s.
 *
 * #551: the ratified gate sandbox has no init reaper (PID 1 = npm), so a
 * group-killed grandchild stays in state Z forever.  process.kill(pid,0)
 * succeeds on a zombie (the entry lingers in the process table), so we also
 * read /proc/<pid>/stat — the state character sits immediately after the LAST
 * ')' in the line (comm may contain spaces/parens, so we scan from the end).
 * States Z/X/x mean the process is dead for kill-tree semantics.  If the read
 * throws, treat it as ESRCH-equivalent (the entry just vanished — gone).
 */
async function waitForProcessGone(pid: number): Promise<boolean> {
  for (let i = 0; i < 200; i += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true; // ESRCH — process is gone
    }
    // Zombie check: /proc/<pid>/stat state field (#551 — no init reaper in sandbox).
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const lastParen = stat.lastIndexOf(')');
      const state = lastParen >= 0 ? stat[lastParen + 2] : '';
      if (state === 'Z' || state === 'X' || state === 'x') return true;
    } catch {
      return true; // entry vanished between kill(0) and read — ESRCH-equivalent
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

describe('runSubprocess', () => {
  it('captures stdout, stderr, and exit code from a real child', async () => {
    const result = await runNode(
      'console.log("to stdout"); console.error("to stderr"); process.exit(3);',
    );
    expect(result.stdout).toBe('to stdout\n');
    expect(result.stderr).toBe('to stderr\n');
    expect(result.exitCode).toBe(3);
    expect(result.signal).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it('reports exit code 0 for a clean exit', async () => {
    const result = await runNode('process.stdout.write("ok");');
    expect(result).toMatchObject({ stdout: 'ok', exitCode: 0, timedOut: false });
  });

  it('pipes stdin content to the child and closes stdin', async () => {
    const result = await runNode(
      'let d = ""; process.stdin.on("data", (c) => (d += c)); ' +
        'process.stdin.on("end", () => process.stdout.write("got:" + d));',
      { stdin: 'prompt payload' },
    );
    expect(result.stdout).toBe('got:prompt payload');
    expect(result.exitCode).toBe(0);
  });

  it('closes stdin even when no stdin content is provided', async () => {
    // A child that waits for stdin EOF must still terminate.
    const result = await runNode(
      'process.stdin.on("data", () => {}); process.stdin.on("end", () => process.exit(0));',
    );
    expect(result.exitCode).toBe(0);
  });

  it('survives a child that never reads its stdin (EPIPE swallowed)', async () => {
    const result = await runNode('process.stdout.write("ignored stdin");', {
      stdin: 'x'.repeat(1024),
    });
    expect(result.stdout).toBe('ignored stdin');
    expect(result.exitCode).toBe(0);
  });

  it('runs the child in the given cwd, not the parent cwd (#146)', async () => {
    const ws = realpathSync(mkdtempSync(path.join(tmpdir(), 'subproc-cwd-')));
    const result = await runSubprocess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.cwd());'],
      timeoutMs: 10_000,
      cwd: ws,
    });
    expect(result.stdout).toBe(ws);
    expect(result.stdout).not.toBe(realpathSync(process.cwd()));
  });

  it('inherits the parent cwd when none is given', async () => {
    const result = await runNode('process.stdout.write(process.cwd());');
    expect(realpathSync(result.stdout)).toBe(realpathSync(process.cwd()));
  });

  it('always measures a finite non-negative durationMs', async () => {
    const result = await runNode('process.exit(0);');
    expect(Number.isFinite(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('kills a hung child on wall-clock timeout and flags timedOut', async () => {
    // Child would live 30s; the 100ms budget must cut it down. Monotonic
    // bound: the call settles in far less than the child's natural lifetime.
    const result = await runNode('setTimeout(() => {}, 30_000);', { timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe('SIGKILL');
    expect(result.durationMs).toBeLessThan(30_000);
  });

  it('keeps output produced before the timeout kill', async () => {
    // Write SYNCHRONOUSLY to the stdout fd so the bytes are in the pipe before
    // the kill can race the flush. The budget is 2s (not 300ms) because under
    // CI load Node's STARTUP alone can exceed 300ms — the kill would then race
    // the child's boot, before the writeSync runs, leaving stdout empty (#112).
    // The child hangs 30s, so the timeout still fires and the output-retained-
    // across-kill behavior is what's under test. Mirrors the tree-kill test.
    const result = await runNode(
      'require("node:fs").writeSync(1, "partial"); setTimeout(() => {}, 30_000);',
      { timeoutMs: 2_000 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.stdout).toBe('partial');
  });

  it('kills the whole process tree on timeout (CLM-0019)', async () => {
    // The child spawns a grandchild that would live 30s, prints its pid,
    // then hangs. After the timeout kill of the process GROUP, the
    // grandchild must be gone too — v1 killed only the direct child.
    const script =
      'const { spawn } = require("node:child_process");' +
      'const g = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"]);' +
      'process.stdout.write(String(g.pid));' +
      'setTimeout(() => {}, 30_000);';
    // 2s (not 300ms) so the child reliably spawns the grandchild and FLUSHES its
    // pid to stdout before the timeout kill — under CI load 300ms could kill the
    // child mid-write, leaving stdout empty and flaking this on the pid parse.
    // The grandchild lives 30s, so the timeout still fires and the tree-kill is
    // what's actually under test.
    const result = await runNode(script, { timeoutMs: 2_000 });
    expect(result.timedOut).toBe(true);
    const grandchildPid = Number.parseInt(result.stdout, 10);
    expect(Number.isInteger(grandchildPid)).toBe(true);
    expect(await waitForProcessGone(grandchildPid)).toBe(true);
  });

  it('does not flag timedOut when the child finishes inside the budget', async () => {
    const result = await runNode('process.stdout.write("fast");', { timeoutMs: 10_000 });
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toBe('fast');
  });

  it('rejects when the command cannot be spawned at all', async () => {
    await expect(
      runSubprocess({
        command: '/nonexistent/kernloop-no-such-binary',
        args: [],
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/ENOENT/);
  });

  it('truncates stdout at the capture cap and flags it', async () => {
    const result = await runNode('process.stdout.write("a".repeat(1000));', {
      maxCaptureBytes: 64,
    });
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(64);
    expect(result.stderrTruncated).toBe(false);
  });

  it('truncates stderr at the capture cap independently of stdout', async () => {
    const result = await runNode(
      'process.stderr.write("e".repeat(1000)); process.stdout.write("ok");',
      { maxCaptureBytes: 64 },
    );
    expect(result.stderrTruncated).toBe(true);
    expect(result.stdout).toBe('ok');
    expect(result.stdoutTruncated).toBe(false);
  });

  it('passes a custom environment through to the child', async () => {
    const result = await runSubprocess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.env.KERNLOOP_TEST_VAR ?? "missing");'],
      timeoutMs: 10_000,
      env: { ...process.env, KERNLOOP_TEST_VAR: 'injected' },
    });
    expect(result.stdout).toBe('injected');
  });
});
