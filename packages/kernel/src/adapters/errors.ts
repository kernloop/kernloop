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

/**
 * An AGENTIC adapter (one that executes generated code + reads/writes its cwd)
 * was pointed at a NON-throwaway git working tree (#280 part 2 / #138, CLM-0145).
 * Refused before launch: generated code in your real repo could poison
 * `.git/hooks`, rewrite `.git/config`, or read tracked secrets. The boundary is
 * GIT-TREE containment, not general secret protection.
 */
export class AgenticRepositoryWorkspaceError extends Error {
  override readonly name = 'AgenticRepositoryWorkspaceError';
  /** Agentic adapter that was refused (claude, codex, …). */
  readonly adapter: string;
  /** The realpath'd workspace that resolved inside a real git tree. */
  readonly workspace: string;

  constructor(adapter: string, workspace: string) {
    super(
      `refusing to run agentic adapter "${adapter}" in the git working tree at "${workspace}" — ` +
        `generated code there could corrupt .git/hooks or read tracked secrets. Run in a ` +
        `throwaway workspace (copy the repo under a temp dir) or wrap it in --sandbox docker (#236).`,
    );
    this.adapter = adapter;
    this.workspace = workspace;
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

/**
 * The env var an api adapter reads its key from is unset or empty (spec §3.1:
 * adapters are the model-invocation layer, the one place a key is held). The
 * error names the ENV VAR ONLY — never any value — so a missing-key failure
 * can never leak a partially-set or look-alike secret. Fail-closed: a missing
 * key is a typed refusal, never a stubbed "success".
 */
export class ApiKeyMissingError extends Error {
  override readonly name = 'ApiKeyMissingError';
  /** Endpoint id the call was addressed to. */
  readonly adapter: string;
  /** The NAME of the env var that was empty/unset (never the value). */
  readonly apiKeyEnv: string;

  constructor(adapter: string, apiKeyEnv: string) {
    super(
      `api adapter "${adapter}": environment variable ${apiKeyEnv} is unset or empty — ` +
        `set it to the endpoint's key (the key is never read from config)`,
    );
    this.adapter = adapter;
    this.apiKeyEnv = apiKeyEnv;
  }
}

/**
 * An api adapter's `baseUrl` is not a usable endpoint (SSRF guard, spec §3.1):
 * a non-http(s) scheme, or plain `http:` to a non-local host. The lexical
 * config is validated BEFORE any network call so a hostile baseUrl never
 * reaches `fetch`. Carries only the reason — no secret is involved.
 */
export class ApiEndpointError extends Error {
  override readonly name = 'ApiEndpointError';
  /** Endpoint id the bad config belongs to. */
  readonly adapter: string;
  /** Why the baseUrl/request was rejected. */
  readonly reason: string;

  constructor(adapter: string, reason: string) {
    super(`api adapter "${adapter}": ${reason}`);
    this.adapter = adapter;
    this.reason = reason;
  }
}
