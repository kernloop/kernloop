/**
 * The quality gate runner (spec §5.3): executes each check's local command
 * sequentially via child_process, parses output into severity-tagged
 * Findings, and emits one zod-validated Verdict (CLM-0031).
 *
 * The gate is mechanical — it spawns local tooling and reads exit codes; no
 * model is ever called. That is why `confidence` is 1 (a deterministic
 * tool run is not a judgment call) and why `cost` is honestly
 * `{ tokens: 0, usd: 0 }` with only wall-clock time measured. Audit of the
 * emitted Verdict happens kernel-side at the bus boundary, not here.
 */
import { spawn } from 'node:child_process';
import { VerdictSchema, type Finding, type Verdict } from '@kernloop/contracts';
import { scopedChildEnv } from '@kernloop/kernel';
import {
  DEFAULT_TIMEOUT_MS,
  defaultQualityChecks,
  isInProcessCheck,
  type InProcessCheck,
  type QualityCheck,
  type SubprocessCheck,
} from './checks.js';
import { outputTail } from './parsers.js';
import { dockerUsable, runCheckInSandbox, type SandboxExecution } from './sandbox/run-check.js';

/**
 * Docker isolation policy for the gate (#236). `enabled` opts the gate into
 * running each subprocess check inside the kernel `--network none` sandbox over
 * a workspace COPY. `enforce` (default true once enabled) makes the autonomous
 * path FAIL CLOSED when Docker is unavailable — degrading to the env-scoped host
 * spawn is then an explicit operator opt-out (`enforce: false`). `dockerBin` is
 * injectable so the absent/refusal path is hermetically testable.
 */
export interface GateSandboxOptions {
  readonly enabled: boolean;
  readonly enforce: boolean;
  readonly dockerBin?: string;
}

/** The isolation tier a gate run ACHIEVED — surfaced in the Verdict (tier-reported == tier-applied). */
export type SandboxTier = 'docker-network-none' | 'env-scoped' | 'refused';

/** Options for {@link runQualityGate}. */
export interface RunQualityGateOptions {
  /** Task the verdict judges (Verdict.taskId). */
  readonly taskId: string;
  /** Directory the check commands run in. */
  readonly workspaceDir: string;
  /** Checks to run; defaults to {@link defaultQualityChecks}. */
  readonly checks?: readonly QualityCheck[];
  /** Per-check timeout in ms; defaults to {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMsPerCheck?: number;
  /**
   * Extra env-var NAMES a spawned check may receive beyond the kernel's benign
   * base allowlist (#227/#235, CLM-0124). A check command runs model-supplied or
   * model-GENERATED code (`pnpm test` executes model-written test files), so it
   * is spawned with a LEAST-PRIVILEGE env — `SAFE_ENV_KEYS` ∪ these names, NOT
   * the host env — so host secrets (provider keys, GH_TOKEN, cloud creds) are not
   * exposed to it. The composition root threads the overlay's
   * `gates.quality.envAllow`. Default `[]`.
   */
  readonly envAllow?: readonly string[];
  /** Docker sandbox policy (#236); absent ⇒ the legacy env-scoped host spawn. */
  readonly sandbox?: GateSandboxOptions;
}

/** Captured result of one spawned check command. */
interface CheckExecution {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError: string | undefined;
}

/** Spawn one check in `cwd`, capture output, kill on timeout expiry. */
function executeCheck(
  check: SubprocessCheck,
  cwd: string,
  timeoutMs: number,
  envAllow: readonly string[],
): Promise<CheckExecution> {
  return new Promise((resolve) => {
    const child = spawn(check.command, [...check.args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Least-privilege env (#235): a check runs model-generated code, so it
      // gets the benign allowlist ∪ envAllow, NOT the host env — host secrets
      // are withheld. The kernel owns the allowlist policy (CLM-0122).
      env: scopedChildEnv(process.env, envAllow),
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null, spawnError: string | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut, spawnError });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error) => finish(null, error.message));
    child.on('close', (code) => finish(code, undefined));
  });
}

/**
 * Findings for one executed check. Exit 0 is the mechanical pass authority:
 * only sub-`error` findings (lint warnings etc.) survive it. Nonzero exit
 * parses output into findings and guarantees at least one `error` via the
 * output-tail fallback (CLM-0031). Timeouts and spawn failures are errors.
 */
function findingsForCheck(
  check: SubprocessCheck,
  exec: CheckExecution,
  timeoutMs: number,
): Finding[] {
  if (exec.timedOut) {
    return [
      {
        severity: 'error',
        message: `check "${check.name}" timed out after ${String(timeoutMs)}ms and was killed`,
      },
    ];
  }
  if (exec.spawnError !== undefined) {
    return [
      {
        severity: 'error',
        message: `check "${check.name}" failed to start: ${exec.spawnError}`,
      },
    ];
  }
  const parsed = check.parse(exec.stdout, exec.stderr, exec.exitCode);
  if (exec.exitCode === 0) {
    return parsed.filter((f) => f.severity === 'info' || f.severity === 'warn');
  }
  if (parsed.some((f) => f.severity === 'error' || f.severity === 'blocker')) {
    return parsed;
  }
  return [
    ...parsed,
    {
      severity: 'error',
      message: `check "${check.name}" exited ${String(exec.exitCode)}: ${outputTail(exec.stdout, exec.stderr)}`,
    },
  ];
}

/**
 * Run one in-process check, racing it against the per-check timeout. The
 * check owns its severities, so its findings pass through unfiltered; a throw
 * becomes an `error` finding, and an ASYNC run that overruns becomes a timeout
 * `error` finding — so an in-process check can never silently pass by failing.
 * NOTE: the timer cannot interrupt SYNCHRONOUS work (it blocks the event loop
 * before the timer can fire); a synchronous check must bound its own work
 * (the doc scanner enforces byte budgets) (CLM-0104).
 */
async function runInProcessCheck(
  check: InProcessCheck,
  cwd: string,
  timeoutMs: number,
): Promise<Finding[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Finding[]>((resolve) => {
    timer = setTimeout(
      () =>
        resolve([
          {
            severity: 'error',
            message: `check "${check.name}" timed out after ${String(timeoutMs)}ms`,
          },
        ]),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([Promise.resolve(check.run(cwd)), timeout]);
  } catch (error) {
    return [
      {
        severity: 'error',
        message: `check "${check.name}" threw: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Findings for one check, dispatching on subprocess vs in-process. In-process
 * checks (our own scanners, not generated code) always run in-process. A
 * subprocess check runs in the Docker sandbox when `sandboxRun` is provided
 * (docker tier), else via the env-scoped host spawn.
 */
async function findingsFor(
  check: QualityCheck,
  cwd: string,
  timeoutMs: number,
  envAllow: readonly string[],
  sandboxRun: ((check: SubprocessCheck) => Promise<SandboxExecution>) | undefined,
): Promise<Finding[]> {
  if (isInProcessCheck(check)) {
    return runInProcessCheck(check, cwd, timeoutMs);
  }
  const exec =
    sandboxRun !== undefined
      ? await sandboxRun(check)
      : await executeCheck(check, cwd, timeoutMs, envAllow);
  return findingsForCheck(check, exec, timeoutMs);
}

/** Resolve the isolation tier once per gate run via a functional Docker probe (#236). */
async function resolveSandboxTier(sandbox: GateSandboxOptions | undefined): Promise<SandboxTier> {
  if (sandbox === undefined || !sandbox.enabled) return 'env-scoped';
  if (await dockerUsable(sandbox.dockerBin)) return 'docker-network-none';
  return sandbox.enforce ? 'refused' : 'env-scoped';
}

/** The Verdict Finding that surfaces the achieved isolation tier (rule 7 + condition 3). */
function sandboxTierFinding(
  sandbox: GateSandboxOptions | undefined,
  tier: SandboxTier,
): Finding | undefined {
  if (sandbox === undefined || !sandbox.enabled) return undefined;
  if (tier === 'docker-network-none') {
    return {
      severity: 'info',
      message: 'sandbox: docker --network none over a workspace copy, caps applied (#236)',
    };
  }
  return {
    severity: 'warn',
    message:
      'sandbox: REDUCED — Docker unavailable, ran env-scoped only; network egress NOT isolated (#236)',
  };
}

/**
 * Run the quality gate over a workspace and emit one Verdict (CLM-0031).
 * Checks run sequentially; the verdict is `pass` iff no finding reaches
 * `error`/`blocker` severity. The Verdict is `VerdictSchema`-validated
 * before return — an invalid verdict throws rather than escaping. With
 * `options.sandbox.enabled` each subprocess check runs Docker-isolated over a
 * workspace copy, fail-closed on the enforce path (#236, CLM-0129).
 */
export async function runQualityGate(options: RunQualityGateOptions): Promise<Verdict> {
  const checks = options.checks ?? defaultQualityChecks();
  const timeoutMs = options.timeoutMsPerCheck ?? DEFAULT_TIMEOUT_MS;
  const envAllow = options.envAllow ?? [];
  const started = Date.now();
  const findings: Finding[] = [];
  const sandbox = options.sandbox;
  const tier = await resolveSandboxTier(sandbox);
  if (tier === 'refused') {
    // Fail closed (#236): the enforce path will not run generated checks
    // unsandboxed. No check executes; this blocking finding fails the gate.
    findings.push({
      severity: 'error',
      message:
        'sandbox(enforce): Docker unavailable — refused to run generated checks unsandboxed (#236)',
    });
  } else {
    const sandboxRun =
      tier === 'docker-network-none'
        ? (check: SubprocessCheck): Promise<SandboxExecution> =>
            runCheckInSandbox(check, options.workspaceDir, sandbox?.dockerBin)
        : undefined;
    for (const check of checks) {
      findings.push(
        ...(await findingsFor(check, options.workspaceDir, timeoutMs, envAllow, sandboxRun)),
      );
    }
    const tierFinding = sandboxTierFinding(sandbox, tier);
    if (tierFinding !== undefined) findings.push(tierFinding);
  }
  const blocking = findings.some((f) => f.severity === 'error' || f.severity === 'blocker');
  return VerdictSchema.parse({
    taskId: options.taskId,
    gate: 'quality',
    result: blocking ? 'fail' : 'pass',
    confidence: 1,
    findings,
    cost: { tokens: 0, usd: 0, wallClockMs: Date.now() - started },
  });
}
