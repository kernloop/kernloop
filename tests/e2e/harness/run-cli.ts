/**
 * The e2e CLI driver: spawns the REAL built `kernloop` binary
 * (`packages/cli/dist/cli.js`) as a Node subprocess and returns its observable
 * result — exit code, captured stdout/stderr, and a `json()` helper that parses
 * the JSON the CLI writes on stdout. No mocks: this is the same entry point a
 * user runs (`bin.kernloop` → `dist/cli.js`). The CLI must be built first
 * (`pnpm build`); a missing binary surfaces as a loud error here, not a silent
 * skip.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, resolved up from this file (tests/e2e/harness → repo root). */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The built CLI entry the `kernloop` bin points at (packages/cli/package.json). */
const CLI_ENTRY = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'cli.js');

/** Options for one {@link runCli} invocation. */
export interface RunCliOptions {
  /** Working directory the CLI resolves its overlay (`.kernloop/`) against. */
  readonly cwd: string;
  /** Extra environment overlaid on `process.env` (e.g. a `PATH` with the gh stub first). */
  readonly env?: Record<string, string>;
}

/** The observable result of one CLI invocation. */
export interface RunCliResult {
  /** Process exit code (`spawnSync.status`; 0 on clean exit). */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Parse the CLI's stdout as JSON (the CLI writes JSON on stdout). */
  json(): unknown;
}

/**
 * Run `kernloop <args>` as a real subprocess against `opts.cwd`. Spawns
 * `process.execPath` (the same Node) with `[CLI_ENTRY, ...args]` synchronously,
 * captures stdout/stderr, and returns the exit code plus a lazy `json()` parser.
 * The child env is `{ ...process.env, ...opts.env }`, so a test can prepend a
 * stub `gh` to `PATH` to intercept the one external boundary.
 */
export function runCli(args: readonly string[], opts: RunCliOptions): RunCliResult {
  if (!existsSync(CLI_ENTRY)) {
    throw new Error(
      `CLI not built: ${CLI_ENTRY} is missing — run \`pnpm build\` before \`pnpm e2e\``,
    );
  }
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: 'utf8',
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    code: result.status ?? 1,
    stdout,
    stderr,
    json: () => JSON.parse(stdout) as unknown,
  };
}
