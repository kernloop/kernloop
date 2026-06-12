/**
 * The default subprocess executor (spec §5.5 security posture). `spawnCapture`
 * runs `command` with its ARGS-ARRAY via `node:child_process.spawn` — NEVER a
 * shell (`shell: false` is spawn's default and is asserted by passing no
 * `shell` option), so no title/body/label is ever interpolated into a command
 * line a shell could re-parse. It captures stdout/stderr and never throws: a
 * spawn failure (CLI absent) resolves as `spawnError` data, mirroring the
 * Observer's exec seam this generalizes.
 */
import { spawn } from 'node:child_process';
import type { ExecResult, TrackerExec } from './types.js';

/**
 * Spawn `command args` with NO shell, capture output; never throws — errors
 * are data. The args-array is passed verbatim to the OS exec, so a value that
 * begins with `-` is an argument, not a shell token (shell metacharacters in
 * a value have no meaning here either — there is no shell).
 */
export function spawnCapture(command: string, args: readonly string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    // SAFE: args-array form, shell:false (spawn's default, set explicitly) —
    // no shell, no string interpolation. `command` is a hard-coded CLI name
    // from the provider, never derived from issue content; the subcommand is
    // allowlisted upstream. (No semgrep suppression needed: the repo's
    // p/typescript+p/javascript rulesets do not flag args-array spawn.)
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) =>
      resolve({ exitCode: null, stdout, stderr, spawnError: error.message }),
    );
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

/** The default tracker executor: spawns the named CLI on PATH with no shell. */
export const defaultExec: TrackerExec = (command, args) => spawnCapture(command, args);
