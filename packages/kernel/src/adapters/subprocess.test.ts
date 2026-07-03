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
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSubprocess, sweepChildGroups } from './subprocess.js';

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
    // Linux-only: on hosts without /proc (macOS) an unconditional read would throw
    // and misreport a LIVE process as gone, passing the tree-kill test vacuously —
    // off-Linux the portable kill(0) poll above stays the sole liveness check.
    if (process.platform === 'linux') {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        const lastParen = stat.lastIndexOf(')');
        const state = lastParen >= 0 ? stat[lastParen + 2] : '';
        if (state === 'Z' || state === 'X' || state === 'x') return true;
      } catch {
        return true; // entry vanished between kill(0) and read — ESRCH-equivalent
      }
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

  /**
   * The child-tree fixture (#570): spawns a hanging grandchild, writes
   * "<ownPid> <grandchildPid>" to the pid file given as its one argument, then
   * hangs itself — so the test knows both pids while the tree is still LIVE.
   */
  const CHILD_TREE_SCRIPT =
    'const { spawn } = require("node:child_process");' +
    'const g = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"]);' +
    'require("node:fs").writeFileSync(process.argv[1], process.pid + " " + g.pid);' +
    'setTimeout(() => {}, 30_000);';

  /** Poll a child-tree pid file until it holds both pids (~3s), or fail. */
  async function readPids(file: string): Promise<{ child: number; grandchild: number }> {
    for (let i = 0; i < 300; i += 1) {
      try {
        const parts = readFileSync(file, 'utf8').trim().split(' ').map(Number);
        if (parts.length === 2 && parts.every(Number.isInteger)) {
          return { child: parts[0] as number, grandchild: parts[1] as number };
        }
      } catch {
        // Not written yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`pid file ${file} never appeared — the child tree did not start`);
  }

  it('sweepChildGroups SIGTERMs every live child process group — grandchild included (#570)', async () => {
    const pidFile = path.join(mkdtempSync(path.join(tmpdir(), 'sweep-')), 'pids');
    const pending = runSubprocess({
      command: process.execPath,
      args: ['-e', CHILD_TREE_SCRIPT, pidFile],
      timeoutMs: 30_000,
    });
    const pids = await readPids(pidFile);
    sweepChildGroups(); // the run's teardown path: kill(-pid) on every live group
    const result = await pending;
    expect(result.signal).toBe('SIGTERM');
    expect(await waitForProcessGone(pids.grandchild)).toBe(true);
    expect(await waitForProcessGone(pids.child)).toBe(true);
    // The settled child was unregistered on close: a second sweep is a no-op.
    expect(() => sweepChildGroups()).not.toThrow();
  });

  it('a fatal signal sweeps live child groups before the parent dies (#570)', async () => {
    // Own SIGHUP so the sweep handler's re-raise defers to us and the vitest
    // worker survives; `process.emit` drives the handler without a real signal.
    const keepAlive = (): void => undefined;
    process.on('SIGHUP', keepAlive);
    try {
      const pidFile = path.join(mkdtempSync(path.join(tmpdir(), 'sweep-sig-')), 'pids');
      const pending = runSubprocess({
        command: process.execPath,
        args: ['-e', CHILD_TREE_SCRIPT, pidFile],
        timeoutMs: 30_000,
      });
      const pids = await readPids(pidFile);
      process.emit('SIGHUP');
      const result = await pending;
      expect(result.signal).toBe('SIGTERM');
      expect(await waitForProcessGone(pids.grandchild)).toBe(true);
    } finally {
      process.removeListener('SIGHUP', keepAlive);
    }
  });

  it('a SIGTERMed parent takes the whole coder process tree with it (#570)', async () => {
    // The ACCEPTANCE for #570 defect 2, with a REAL OS signal: a driver process
    // (standing in for `kernloop run`) spawns a child tree through the BUILT
    // runSubprocess; SIGTERMing the driver must SIGTERM the child's process
    // group — no orphaned agentic writer survives its run.
    const dist = fileURLToPath(new URL('../../dist/adapters/subprocess.js', import.meta.url));
    // `turbo run test` builds first (turbo.json: test dependsOn build) — fail
    // with the remedy rather than a cryptic import error in the driver.
    expect(existsSync(dist), `built kernel missing at ${dist} — run pnpm build first`).toBe(true);
    const dir = mkdtempSync(path.join(tmpdir(), 'sweep-driver-'));
    const childFile = path.join(dir, 'child.cjs');
    writeFileSync(
      childFile,
      'const { spawn } = require("node:child_process");\n' +
        'const g = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"]);\n' +
        'require("node:fs").writeFileSync(process.argv[2], process.pid + " " + g.pid);\n' +
        'setTimeout(() => {}, 30_000);\n',
    );
    const driverFile = path.join(dir, 'driver.mjs');
    writeFileSync(
      driverFile,
      `import { runSubprocess } from ${JSON.stringify(String(new URL('../../dist/adapters/subprocess.js', import.meta.url)))};\n` +
        'void runSubprocess({ command: process.execPath, args: [process.argv[2], process.argv[3]], timeoutMs: 60_000 }).catch(() => {});\n',
    );
    const pidFile = path.join(dir, 'pids');
    const driver = spawn(process.execPath, [driverFile, childFile, pidFile], { stdio: 'ignore' });
    const pids = await readPids(pidFile);
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
      driver.once('exit', (code, signal) => resolve({ code, signal })),
    );
    driver.kill('SIGTERM');
    // The sweep handler re-raises after sweeping, so the driver itself dies of
    // SIGTERM (default disposition preserved) — and the tree dies with it.
    expect((await exited).signal).toBe('SIGTERM');
    expect(await waitForProcessGone(pids.grandchild)).toBe(true);
    expect(await waitForProcessGone(pids.child)).toBe(true);
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
