/**
 * Subprocess engine for model-CLI adapters (spec §3.1 Adapters, §10 item 2).
 *
 * One function — {@link runSubprocess} — spawns a child process, captures
 * stdout/stderr/exit code, and enforces a wall-clock timeout by killing the
 * whole process tree (POSIX process group). It never interprets output and
 * never retries: classification, parsing, and policy belong to the caller
 * (constitutional rule 4 — the kernel contains no intelligence).
 *
 * Ported by evidence from nexus-agents v1 `cli-adapters/subprocess-adapter.ts`;
 * see PORT-NOTES.md in this directory for the deltas.
 *
 * @module kernel/adapters/subprocess
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/**
 * Default per-stream capture cap (10 MiB), matching v1's `MAX_BUFFER_BYTES`.
 * Beyond the cap the stream keeps draining (so the child never blocks on a
 * full pipe) but captured text stops growing and the truncated flag is set.
 */
export const DEFAULT_MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

/** What to run, what to feed it, and how long it may take. */
export interface SubprocessSpec {
  /** Executable to spawn — a resolved path or a name on the child's PATH. */
  readonly command: string;
  /** Arguments passed verbatim (no shell — nothing is interpolated). */
  readonly args: readonly string[];
  /** Content written to the child's stdin; stdin is closed either way. */
  readonly stdin?: string;
  /** Wall-clock budget in milliseconds; on breach the tree is SIGKILLed. */
  readonly timeoutMs: number;
  /** Child environment; defaults to the parent's `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Working directory for the child. When omitted the child inherits the
   * PARENT's cwd — which for a model-CLI adapter is wherever kernloop was
   * launched, NOT the task workspace. An agentic CLI (claude/codex/
   * opencode) reads + writes its cwd, so callers that drive one MUST set this
   * to the intended workspace (#146); leaving it unset exposes the launch dir.
   */
  readonly cwd?: string;
  /** Per-stream capture cap in bytes; default {@link DEFAULT_MAX_CAPTURE_BYTES}. */
  readonly maxCaptureBytes?: number;
}

/** Everything observed about one finished (or killed) subprocess. */
export interface SubprocessResult {
  /** Captured stdout (UTF-8, possibly truncated at the capture cap). */
  readonly stdout: string;
  /** Captured stderr (UTF-8, possibly truncated at the capture cap). */
  readonly stderr: string;
  /** Exit code, or null when the child was killed by a signal. */
  readonly exitCode: number | null;
  /** Terminating signal, or null on a normal exit. */
  readonly signal: string | null;
  /** Measured wall-clock duration in milliseconds (monotonic clock). */
  readonly durationMs: number;
  /** True when the wall-clock timeout fired and the tree was killed. */
  readonly timedOut: boolean;
  /** True when stdout exceeded the capture cap and was truncated. */
  readonly stdoutTruncated: boolean;
  /** True when stderr exceeded the capture cap and was truncated. */
  readonly stderrTruncated: boolean;
}

/** Mutable capture state for one stream. */
interface StreamCapture {
  text: string;
  bytes: number;
  truncated: boolean;
}

/**
 * Append a chunk to a capture, slicing at the byte cap. A capped stream
 * keeps draining (the child never blocks on a full pipe) but captured text
 * stops at the cap; a multi-byte character split at the cap may render as
 * a replacement character — truncated output is marked as such anyway.
 */
function appendCapture(capture: StreamCapture, chunk: Buffer, cap: number): void {
  if (capture.truncated) return;
  const remaining = cap - capture.bytes;
  if (chunk.length > remaining) {
    capture.text += chunk.subarray(0, remaining).toString('utf8');
    capture.bytes = cap;
    capture.truncated = true;
    return;
  }
  capture.text += chunk.toString('utf8');
  capture.bytes += chunk.length;
}

/**
 * SIGKILL the child's whole process tree. The child is spawned `detached`,
 * so it leads its own POSIX process group and `kill(-pid)` reaps every
 * descendant — v1 SIGTERMed only the direct child and needed a 5s SIGKILL
 * escalation; killing the group makes the timeout immediate and complete.
 */
function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Group already gone or not a group leader — fall back to the child.
    child.kill('SIGKILL');
  }
}

/**
 * Process-group leaders of every LIVE child spawned by {@link runSubprocess}
 * (#570, CLM-0195). A dying parent sweeps these groups with SIGTERM so a killed
 * `kernloop run` can never leave an agentic coder running — the #570 incident
 * was an orphaned coder that outlived its killed parent and kept writing into
 * the launching repo. A SIGKILLed parent is not interceptable (POSIX); the
 * sweep covers normal exit, `process.exit()`, SIGTERM, and SIGHUP.
 */
const liveChildGroups = new Set<number>();

/**
 * Fatal signals swept before the parent dies. SIGINT is deliberately ABSENT:
 * the first Ctrl-C is the CLI's cooperative-abort trigger (CLM-0144) — the run
 * stays alive and AWAITS its in-flight child, which a sweep would kill mid
 * flight; the force-quit second Ctrl-C calls `process.exit`, whose `exit`
 * event fires the sweep anyway.
 */
const SWEEP_SIGNALS = ['SIGTERM', 'SIGHUP'] as const;

/**
 * SIGTERM every live child process group (`kill(-pid)` reaps the whole group,
 * grandchildren included). Wired to the parent's `exit` event and the
 * {@link SWEEP_SIGNALS} handlers (#570); exported so a run's own teardown can
 * sweep explicitly. A group that is already gone is skipped silently.
 */
export function sweepChildGroups(): void {
  for (const pid of liveChildGroups) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      liveChildGroups.delete(pid); // group already gone — drop the stale entry
    }
  }
}

let sweepInstalled = false;

/**
 * Install the parent-death sweep ONCE, lazily on the first spawn (importing
 * this module never changes the process's signal disposition — only actually
 * spawning a child does). `exit` covers normal termination and `process.exit`;
 * each {@link SWEEP_SIGNALS} handler sweeps and then RE-RAISES the signal when
 * no other listener owns it, preserving the default fatal disposition and the
 * signal exit status. When another handler exists (an app owning its
 * lifecycle), the sweep still ran and the app keeps control.
 */
function installParentSweep(): void {
  if (sweepInstalled) return;
  sweepInstalled = true;
  process.once('exit', sweepChildGroups);
  for (const signal of SWEEP_SIGNALS) {
    process.once(signal, () => {
      sweepChildGroups();
      /* v8 ignore next -- the re-raise kills the process; exercised out-of-process by the real-SIGTERM driver test */
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    });
  }
}

/** Callbacks that settle the {@link runSubprocess} promise exactly once. */
interface Settle {
  readonly resolve: (result: SubprocessResult) => void;
  readonly reject: (error: Error) => void;
}

/**
 * Wire timeout, spawn-error, and close handling on a spawned child.
 * `close` (all stdio flushed) resolves with everything captured; a spawn
 * failure (ENOENT, EACCES, …) rejects — no process ever ran.
 */
function wireLifecycle(
  child: ChildProcess,
  spec: SubprocessSpec,
  captures: { stdout: StreamCapture; stderr: StreamCapture },
  startMs: number,
  settle: Settle,
): void {
  let timedOut = false;
  let settled = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, spec.timeoutMs);

  child.once('error', (error: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (child.pid !== undefined) liveChildGroups.delete(child.pid);
    settle.reject(error);
  });

  child.once('close', (exitCode, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (child.pid !== undefined) liveChildGroups.delete(child.pid);
    settle.resolve({
      stdout: captures.stdout.text,
      stderr: captures.stderr.text,
      exitCode,
      signal,
      durationMs: performance.now() - startMs,
      timedOut,
      stdoutTruncated: captures.stdout.truncated,
      stderrTruncated: captures.stderr.truncated,
    });
  });
}

/**
 * Run one subprocess to completion under a wall-clock timeout.
 *
 * Resolves on the child's `close` event (all stdio flushed) with everything
 * captured; on timeout the process group is SIGKILLed and the result carries
 * `timedOut: true` plus whatever output was produced before the kill.
 * Rejects only when the process cannot be spawned at all (e.g. ENOENT) —
 * a child that runs and fails is a *result*, not an exception.
 */
export function runSubprocess(spec: SubprocessSpec): Promise<SubprocessResult> {
  const cap = spec.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE_BYTES;
  const startMs = performance.now();
  return new Promise<SubprocessResult>((resolve, reject) => {
    const child = spawn(spec.command, [...spec.args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: spec.env ?? process.env,
      // The intended workspace, when set — else inherit the parent's cwd (#146).
      ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
      // Own process group so a timeout can kill the whole tree (POSIX).
      detached: true,
    });
    // Register the group + arm the parent-death sweep (#570): a dying parent
    // SIGTERMs every live child group, so a killed run cannot orphan its coder.
    if (child.pid !== undefined) {
      liveChildGroups.add(child.pid);
      installParentSweep();
    }
    const stdout: StreamCapture = { text: '', bytes: 0, truncated: false };
    const stderr: StreamCapture = { text: '', bytes: 0, truncated: false };
    child.stdout.on('data', (chunk: Buffer) => appendCapture(stdout, chunk, cap));
    child.stderr.on('data', (chunk: Buffer) => appendCapture(stderr, chunk, cap));

    wireLifecycle(child, spec, { stdout, stderr }, startMs, { resolve, reject });

    // A child may exit without reading stdin; ignore the resulting EPIPE.
    child.stdin.on('error', () => undefined);
    if (spec.stdin !== undefined) child.stdin.write(spec.stdin);
    child.stdin.end();
  });
}
