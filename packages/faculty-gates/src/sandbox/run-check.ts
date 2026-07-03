/**
 * Run one gate SUBPROCESS check in the kernel Docker sandbox (#236): the
 * workspace (minus VCS/secrets) is copied into an ephemeral scratch, the check
 * runs there under RATIFIED_GATE_PROFILE via `runInSandbox`, only the structured
 * exit/output returns, and the scratch is destroyed.
 */
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInSandbox, SandboxUnavailableError } from '@kernloop/kernel';
import type { SubprocessCheck } from '../checks.js';
import { RATIFIED_GATE_PROFILE } from './profile.js';
import { populateScratch } from './copy.js';
import { provisionPackageManager } from './provision-pm.js';

/**
 * Make the ephemeral scratch accessible to the container's non-root user. The
 * container runs as `RATIFIED_GATE_PROFILE.user` (uid 1000), but the host
 * creating the scratch often has a DIFFERENT uid (CI runners especially), and
 * `mkdtempSync` is mode 0700 (owner-only) — so the container user would get
 * EACCES traversing/reading/writing the bind-mounted tree. `a+rwX` opens the
 * throwaway scratch to all (read/write files, traverse dirs); it is short-lived,
 * isolated (`--network none`), and destroyed after the run. A full recursive
 * `chmod` (a check writes coverage/caches under the tree, not just the root) via
 * the system `chmod` falls back to a top-dir `chmodSync` if the binary is absent.
 */
function openScratchPerms(scratchDir: string): void {
  try {
    execFileSync('chmod', ['-R', 'a+rwX', scratchDir], { stdio: 'ignore' });
  } catch {
    chmodSync(scratchDir, 0o777);
  }
}

/** The execution shape the gate runner consumes (mirrors run.ts CheckExecution). */
export interface SandboxExecution {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError: string | undefined;
}

/** A no-run SandboxExecution carrying a spawnError so the caller fails closed. */
function spawnErrorExecution(spawnError: string): SandboxExecution {
  return { exitCode: null, stdout: '', stderr: '', timedOut: false, spawnError };
}

/**
 * Translate a check command for the offline image: `pnpm`/`yarn <script>` →
 * `npm run <script>` (npm ships with node, runs scripts offline via the local
 * .bin); others pass through. Wrapped so the provisioned PM shim
 * (`/work/.kernloop-pm/bin`, #548) then node_modules/.bin are on PATH — so a
 * script that shells out to the DECLARED pnpm/yarn (turbo re-invoking per-package
 * scripts) resolves the offline-provisioned binary; injection-safe — command/args
 * ride as separate argv (`"$0" "$@"`).
 */
export function containerArgv(check: SubprocessCheck): string[] {
  let command = check.command;
  let args = [...check.args];
  if (command === 'pnpm' || command === 'yarn') {
    command = 'npm';
    args = ['run', ...args];
  }
  const setPath = 'PATH="/work/.kernloop-pm/bin:/work/node_modules/.bin:$PATH" exec "$0" "$@"';
  return ['sh', '-c', setPath, command, ...args];
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
    // Provision the DECLARED PM offline (#548) BEFORE opening perms, so the
    // copied dist is chmod'd for the container user too. Fail CLOSED (as a
    // spawnError) when the host cache lacks the declared version — never run
    // half-provisioned (turbo would fail environmentally) or silently green.
    const provisioned = provisionPackageManager(workspaceDir, scratch);
    if (!provisioned.ok) return spawnErrorExecution(provisioned.error ?? 'PM provisioning failed');
    openScratchPerms(scratch); // container user (uid 1000) != host uid → grant access
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
      return spawnErrorExecution(`sandbox unavailable mid-run: ${error.message}`);
    }
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
}
