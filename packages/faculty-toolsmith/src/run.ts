/**
 * The RUN path for born workshop tools (spec §5.6 runtime; CLM-0071).
 * Forge BIRTHS a tool (validate → generate → sandbox-test → install); this is
 * how a born tool is INVOKED against an input.
 *
 * Runtime contract (human-ratified): a workshop tool receives a contract JSON
 * on **stdin** and emits a contract JSON on **stdout**, executed inside the
 * ratified Docker sandbox (no network, scratch FS, caps, timeout). `node
 * tool.mjs` runs with the installed `tool.mjs` copied into a fresh scratch
 * dir; the serialized input is streamed to the container's stdin.
 *
 * A tool that fails (non-zero exit, or stdout that is not JSON) is an *unclean
 * run*, not an error: it is recorded honestly (forge-style) and surfaced to
 * the caller, never thrown. recordRun() advances the ladder, so clean runs
 * climb suggest → advisory and every run refreshes the decay clock.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UnknownToolError } from './errors.js';
import { recordRun, type ToolLifecycle } from './lifecycle.js';
import { RATIFIED_SANDBOX_PROFILE, type SandboxProfile } from './profile.js';
import { runInSandbox } from './sandbox.js';
import { toolDir } from './workshop.js';

/** Options for {@link runWorkshopTool}. */
export interface RunWorkshopToolOptions {
  /** Overlay root (the directory holding `workshop/`). */
  readonly overlayDir: string;
  /** Short tool name (the segment under `workshop/`; SAFE_TOOL_NAME guarded). */
  readonly name: string;
  /** The input contract — serialized as JSON and streamed to the tool's stdin. */
  readonly input: unknown;
  /** Active sandbox profile; defaults to the ratified one. */
  readonly profile?: SandboxProfile;
  /** Docker binary; injectable so success/refusal paths are testable. */
  readonly dockerBin?: string;
  /** Epoch ms this invocation happened at — recorded against the ladder. */
  readonly now: number;
}

/** Outcome of one workshop-tool invocation. */
export interface RunWorkshopToolResult {
  /** Short tool name (provenance for the audit leg). */
  readonly name: string;
  /** The parsed stdout contract JSON — undefined when the run was unclean. */
  readonly output: unknown;
  /** True iff exit code 0 AND stdout parsed as JSON (the contract was honored). */
  readonly clean: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the sandbox killed the tool at profile.timeoutMs. */
  readonly timedOut: boolean;
  /** The tool's ladder state after recordRun (promotion already applied). */
  readonly lifecycle: ToolLifecycle;
}

/** Parse stdout as JSON; undefined when it is not a single JSON value. */
function parseOutput(stdout: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(stdout) as unknown };
  } catch {
    return { ok: false, value: undefined };
  }
}

/**
 * Invoke a born workshop tool against an input contract (spec §5.6 runtime).
 * Resolves `<overlayDir>/workshop/<name>/tool.mjs` (unknown tool → typed
 * UnknownToolError), copies it into a fresh scratch dir, runs `node tool.mjs`
 * in the ratified sandbox with `JSON.stringify(input)` on stdin, captures
 * stdout/stderr, and records the run on the ladder. An unclean run is a
 * recorded result, not a thrown error.
 */
export async function runWorkshopTool(
  options: RunWorkshopToolOptions,
): Promise<RunWorkshopToolResult> {
  const dir = toolDir(options.overlayDir, options.name);
  const toolFile = path.join(dir, 'tool.mjs');
  if (!fs.existsSync(toolFile)) {
    throw new UnknownToolError(options.name);
  }
  const profile = options.profile ?? RATIFIED_SANDBOX_PROFILE;
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-run-'));
  // mkdtemp is 0700; the in-container `node` user's uid need not match the
  // host (CI runners) — the scratch dir is private temp, so opening it to the
  // container user is sandbox-true, mirroring forge's install path.
  fs.chmodSync(scratchDir, 0o777);
  fs.copyFileSync(toolFile, path.join(scratchDir, 'tool.mjs'));
  try {
    const sandbox = await runInSandbox({
      scratchDir,
      command: ['node', 'tool.mjs'],
      profile,
      stdin: JSON.stringify(options.input),
      ...(options.dockerBin !== undefined ? { dockerBin: options.dockerBin } : {}),
    });
    const parsed = parseOutput(sandbox.stdout);
    const clean = sandbox.exitCode === 0 && !sandbox.timedOut && parsed.ok;
    const lifecycle = recordRun({
      overlayDir: options.overlayDir,
      name: options.name,
      clean,
      at: options.now,
    });
    return {
      name: options.name,
      output: clean ? parsed.value : undefined,
      clean,
      exitCode: sandbox.exitCode,
      stdout: sandbox.stdout,
      stderr: sandbox.stderr,
      timedOut: sandbox.timedOut,
      lifecycle,
    };
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}
