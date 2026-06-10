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
import { DEFAULT_TIMEOUT_MS, defaultQualityChecks, type QualityCheck } from './checks.js';
import { outputTail } from './parsers.js';

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
  check: QualityCheck,
  cwd: string,
  timeoutMs: number,
): Promise<CheckExecution> {
  return new Promise((resolve) => {
    const child = spawn(check.command, [...check.args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
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
function findingsForCheck(check: QualityCheck, exec: CheckExecution, timeoutMs: number): Finding[] {
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
 * Run the quality gate over a workspace and emit one Verdict (CLM-0031).
 * Checks run sequentially; the verdict is `pass` iff no finding reaches
 * `error`/`blocker` severity. The Verdict is `VerdictSchema`-validated
 * before return — an invalid verdict throws rather than escaping.
 */
export async function runQualityGate(options: RunQualityGateOptions): Promise<Verdict> {
  const checks = options.checks ?? defaultQualityChecks();
  const timeoutMs = options.timeoutMsPerCheck ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const findings: Finding[] = [];
  for (const check of checks) {
    const exec = await executeCheck(check, options.workspaceDir, timeoutMs);
    findings.push(...findingsForCheck(check, exec, timeoutMs));
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
