/**
 * Typed failures of the adapter layer (spec §3.1 Adapters).
 *
 * Every way an adapter call can fail is a distinct, inspectable error —
 * never a stubbed result, never a fabricated Cost (constitutional rule 1:
 * wiring-complete or absent). An unavailable CLI in particular surfaces as
 * {@link AdapterUnavailableError} listing exactly which paths were probed.
 *
 * @module kernel/adapters/errors
 */

/** The CLI named by `name` was not found on PATH; lists every probed path. */
export class AdapterUnavailableError extends Error {
  override readonly name = 'AdapterUnavailableError';
  /** Adapter whose CLI is missing (claude, codex, …). */
  readonly adapter: string;
  /** Executable name that was looked up. */
  readonly command: string;
  /** Every candidate path that was probed, in PATH order. */
  readonly probedPaths: readonly string[];

  constructor(adapter: string, command: string, probedPaths: readonly string[]) {
    super(
      `adapter "${adapter}" is unavailable: "${command}" not found on PATH ` +
        `(probed ${String(probedPaths.length)} path(s): ${probedPaths.join(', ')})`,
    );
    this.adapter = adapter;
    this.command = command;
    this.probedPaths = probedPaths;
  }
}

/** The invocation itself was malformed (e.g. ollama without a model). */
export class AdapterRequestError extends Error {
  override readonly name = 'AdapterRequestError';
  /** Adapter the bad request was addressed to. */
  readonly adapter: string;

  constructor(adapter: string, message: string) {
    super(`adapter "${adapter}": ${message}`);
    this.adapter = adapter;
  }
}

/** The wall-clock timeout fired and the CLI's process tree was killed. */
export class AdapterTimeoutError extends Error {
  override readonly name = 'AdapterTimeoutError';
  /** Adapter that timed out. */
  readonly adapter: string;
  /** The budget that was breached, in milliseconds. */
  readonly timeoutMs: number;
  /** Measured wall-clock duration until the call settled, in milliseconds. */
  readonly durationMs: number;

  constructor(adapter: string, timeoutMs: number, durationMs: number) {
    super(`adapter "${adapter}" timed out after ${String(timeoutMs)}ms (process tree killed)`);
    this.adapter = adapter;
    this.timeoutMs = timeoutMs;
    this.durationMs = durationMs;
  }
}

/** The CLI ran but exited non-zero (or was signal-killed outside a timeout). */
export class AdapterExecutionError extends Error {
  override readonly name = 'AdapterExecutionError';
  /** Adapter whose CLI failed. */
  readonly adapter: string;
  /** Exit code, or null when killed by a signal. */
  readonly exitCode: number | null;
  /** Terminating signal, or null on a normal (non-zero) exit. */
  readonly signal: string | null;
  /** Captured stderr — the CLI's own account of the failure. */
  readonly stderr: string;

  constructor(adapter: string, exitCode: number | null, signal: string | null, stderr: string) {
    const how = exitCode !== null ? `exit code ${String(exitCode)}` : `signal ${String(signal)}`;
    super(`adapter "${adapter}" failed with ${how}: ${stderr.slice(0, 500).trim()}`);
    this.adapter = adapter;
    this.exitCode = exitCode;
    this.signal = signal;
    this.stderr = stderr;
  }
}

/** The CLI exited 0 but its output yielded no usable response text. */
export class AdapterOutputError extends Error {
  override readonly name = 'AdapterOutputError';
  /** Adapter whose output could not be interpreted. */
  readonly adapter: string;
  /** Raw stdout, kept whole so the caller can inspect or audit it. */
  readonly stdout: string;
  /** Raw stderr captured alongside. */
  readonly stderr: string;

  constructor(adapter: string, stdout: string, stderr: string) {
    super(
      `adapter "${adapter}" produced no usable output ` +
        `(stdout snippet: ${stdout.slice(0, 200).trim()})`,
    );
    this.adapter = adapter;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}
