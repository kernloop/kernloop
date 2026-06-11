/**
 * The Docker sandbox (spec §5.6; CLM-0052). Workshop tools are generated and
 * tested ONLY inside this profile: no network, filesystem scoped to one
 * fresh scratch directory (mounted at the profile workdir), declared input
 * mounts read-only, memory/cpu/pids capped, time-boxed kill.
 *
 * Isolation from kernel/faculty internals is enforced PHYSICALLY here: the
 * container has no node_modules and no network, so a tool whose source tries
 * `import('@kernloop/kernel')` (or any dependency at all) fails its sandbox
 * test — workshop tools are dependency-free single-file node scripts by
 * construction (CLM-0053).
 *
 * Docker absent or daemon down → typed SandboxUnavailableError. The
 * toolsmith never runs generated code unsandboxed.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { SandboxMountError, SandboxUnavailableError } from './errors.js';
import { SandboxProfileSchema, type SandboxProfile } from './profile.js';

/** A declared input mount — always attached read-only. */
export interface SandboxMount {
  /** Absolute host path to expose. */
  readonly source: string;
  /** Absolute container path it appears at. */
  readonly target: string;
}

/** Options for {@link runInSandbox}. */
export interface SandboxRunOptions {
  /** Fresh host scratch directory, mounted read-write at profile.workdir. */
  readonly scratchDir: string;
  /** argv to execute inside the container, e.g. `['node', '--test', 'test.mjs']`. */
  readonly command: readonly string[];
  /** Declared input mounts (read-only). Nothing else is visible. */
  readonly mounts?: readonly SandboxMount[];
  /** The sandbox profile to run under. */
  readonly profile: SandboxProfile;
  /** Docker binary; injectable so the refusal path is testable. */
  readonly dockerBin?: string;
  /**
   * Optional bytes to write to the container process's stdin, then close it.
   * Present → `docker run -i` so the container reads an interactive stdin
   * (the workshop RUN contract: a tool reads its input JSON from stdin).
   */
  readonly stdin?: string;
}

/** Outcome of one sandboxed run. */
export interface SandboxResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** True when the run was killed at profile.timeoutMs. */
  readonly timedOut: boolean;
}

/** stderr shapes that mean "daemon unreachable", not "command failed". */
const DAEMON_DOWN_PATTERNS = [
  /cannot connect to the docker daemon/i,
  /error during connect/i,
  /docker daemon is not running/i,
  /is the docker daemon running/i,
];

/**
 * Build the full `docker` argv for one sandboxed run — pure, so the argv
 * contract is unit-testable without docker. Every restriction comes from the
 * profile; nothing is hardcoded outside it.
 */
export function buildDockerArgs(
  options: Omit<SandboxRunOptions, 'dockerBin'>,
  containerName: string,
): string[] {
  const profile = SandboxProfileSchema.parse(options.profile);
  const args = [
    'run',
    '--rm',
    // `-i` keeps the container's stdin open so we can stream the input
    // contract JSON to the tool process; harmless when no stdin is provided.
    ...(options.stdin !== undefined ? ['-i'] : []),
    '--name',
    containerName,
    '--network',
    profile.network,
    '--user',
    profile.user,
    '--memory',
    profile.memory,
    '--cpus',
    String(profile.cpus),
    '--pids-limit',
    String(profile.pidsLimit),
    '-v',
    `${path.resolve(options.scratchDir)}:${profile.workdir}`,
    '-w',
    profile.workdir,
  ];
  for (const mount of options.mounts ?? []) {
    // The target is concatenated into the `-v src:target:ro` spec, so a `:`
    // (or a relative path) would inject extra colon-delimited fields and the
    // appended `:ro` would no longer land in the options slot. Require an
    // absolute, colon-free container path; same for the resolved source.
    const source = path.resolve(mount.source);
    if (!mount.target.startsWith('/') || mount.target.includes(':')) {
      throw new SandboxMountError(
        `mount target must be an absolute, colon-free path: ${mount.target}`,
      );
    }
    if (source.includes(':')) {
      throw new SandboxMountError(`mount source path must not contain a colon: ${source}`);
    }
    args.push('-v', `${source}:${mount.target}:ro`);
  }
  args.push(profile.image, ...options.command);
  return args;
}

interface RawRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError: NodeJS.ErrnoException | undefined;
}

/** Spawn the docker client, collect output, kill at timeoutMs. */
function spawnDocker(
  dockerBin: string,
  args: string[],
  containerName: string,
  timeoutMs: number,
  stdin: string | undefined,
): Promise<RawRun> {
  return new Promise((resolve) => {
    // Pipe stdin only when there is input to write; otherwise leave it
    // ignored so a tool that reads stdin sees an immediate EOF, not a hang.
    const child =
      stdin === undefined
        ? spawn(dockerBin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn(dockerBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    if (stdin !== undefined && child.stdin !== null) {
      child.stdin.on('error', () => {}); // a tool that never reads stdin: ignore EPIPE
      child.stdin.end(stdin);
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError: NodeJS.ErrnoException | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the container by name (the client's death alone can leak it),
      // then the client. Fire-and-forget; --rm reaps the container.
      spawn(dockerBin, ['kill', containerName], { stdio: 'ignore' }).on('error', () => {});
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (err: NodeJS.ErrnoException) => {
      spawnError = err;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr, timedOut, spawnError });
    });
  });
}

/**
 * Run one command inside the ratified sandbox shape. Throws
 * SandboxUnavailableError when the docker binary is missing or the daemon is
 * unreachable — never falls back to unsandboxed execution (CLM-0052).
 */
export async function runInSandbox(options: SandboxRunOptions): Promise<SandboxResult> {
  const dockerBin = options.dockerBin ?? 'docker';
  const containerName = `kernloop-forge-${randomUUID()}`;
  const args = buildDockerArgs(options, containerName);
  const raw = await spawnDocker(
    dockerBin,
    args,
    containerName,
    options.profile.timeoutMs,
    options.stdin,
  );
  if (raw.spawnError !== undefined) {
    throw new SandboxUnavailableError(
      `docker binary not runnable at ${JSON.stringify(dockerBin)} (${raw.spawnError.code ?? raw.spawnError.message})`,
    );
  }
  if (raw.exitCode !== 0 && DAEMON_DOWN_PATTERNS.some((p) => p.test(raw.stderr))) {
    throw new SandboxUnavailableError('docker daemon unreachable');
  }
  return { exitCode: raw.exitCode, stdout: raw.stdout, stderr: raw.stderr, timedOut: raw.timedOut };
}
