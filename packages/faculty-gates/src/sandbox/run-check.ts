/**
 * Run one gate SUBPROCESS check in the kernel Docker sandbox (#236): the
 * workspace (minus VCS/secrets) is copied into an ephemeral scratch, the check
 * runs there under RATIFIED_GATE_PROFILE via `runInSandbox`, only the structured
 * exit/output returns, and the scratch is destroyed.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInSandbox, SandboxUnavailableError } from '@kernloop/kernel';
import type { SubprocessCheck } from '../checks.js';
import { RATIFIED_GATE_PROFILE } from './profile.js';
import { populateScratch } from './copy.js';

/** The execution shape the gate runner consumes (mirrors run.ts CheckExecution). */
export interface SandboxExecution {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError: string | undefined;
}

/**
 * Translate a check command for the offline image: `pnpm`/`yarn <script>` →
 * `npm run <script>` (npm ships with node, runs scripts offline via the local
 * .bin); others pass through. Wrapped so node_modules/.bin is on PATH;
 * injection-safe — command/args ride as separate argv (`"$0" "$@"`).
 */
export function containerArgv(check: SubprocessCheck): string[] {
  let command = check.command;
  let args = [...check.args];
  if (command === 'pnpm' || command === 'yarn') {
    command = 'npm';
    args = ['run', ...args];
  }
  return ['sh', '-c', 'PATH="/work/node_modules/.bin:$PATH" exec "$0" "$@"', command, ...args];
}

/**
 * FUNCTIONAL docker probe (not `command -v`): run a trivial container under the
 * gate profile; false on missing binary / unreachable daemon / any failure
 * (fail-closed) so "docker exists but can't run" reads as unavailable.
 */
export async function dockerUsable(dockerBin?: string): Promise<boolean> {
  const scratch = mkdtempSync(join(tmpdir(), 'kernloop-gate-probe-'));
  try {
    await runInSandbox({
      scratchDir: scratch,
      command: ['true'],
      profile: RATIFIED_GATE_PROFILE,
      ...(dockerBin === undefined ? {} : { dockerBin }),
    });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
}

/**
 * Run `check` in the sandbox over a fresh copy of `workspaceDir`. A
 * {@link SandboxUnavailableError} (docker vanished post-probe — TOCTOU) surfaces
 * as a `spawnError` so the caller fails closed, never silently unsandboxed.
 */
export async function runCheckInSandbox(
  check: SubprocessCheck,
  workspaceDir: string,
  dockerBin?: string,
): Promise<SandboxExecution> {
  const scratch = mkdtempSync(join(tmpdir(), 'kernloop-gate-sbx-'));
  try {
    populateScratch(workspaceDir, scratch);
    const result = await runInSandbox({
      scratchDir: scratch,
      command: containerArgv(check),
      profile: RATIFIED_GATE_PROFILE,
      ...(dockerBin === undefined ? {} : { dockerBin }),
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      spawnError: undefined,
    };
  } catch (error) {
    if (error instanceof SandboxUnavailableError) {
      return {
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        spawnError: `sandbox unavailable mid-run: ${error.message}`,
      };
    }
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
}
