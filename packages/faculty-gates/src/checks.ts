/**
 * Check definitions for the quality gate (spec §5.3) — data, not behavior.
 * A {@link QualityCheck} names a local command and the parser that turns its
 * output into Findings; the runner in `run.ts` supplies the mechanics.
 *
 * P1 default set: typecheck, lint, test. Coverage has no separate check —
 * per-package vitest coverage thresholds fail the test runner's exit code,
 * so a coverage breach surfaces through the `test` check (CLM-0031).
 * Security: no default security check ships in P1 — there is no real,
 * local, model-free security tool wired in this repo yet, and a stub is
 * constitutionally forbidden (spec §1 rule 1); one returns via a claim when
 * a real tool exists.
 */
import type { Finding } from '@kernloop/contracts';
import { parseEslintOutput, parseTscOutput, parseVitestOutput } from './parsers.js';

/**
 * One quality check: a command to run inside the workspace and a parser for
 * its output. Exit code 0 means the check passed (the exit code is the
 * mechanical authority); nonzero output is parsed into severity-tagged
 * findings (CLM-0031).
 */
export interface QualityCheck {
  /** Short identifier, e.g. `typecheck`. */
  readonly name: string;
  /** Executable to spawn (no shell interpretation). */
  readonly command: string;
  /** Arguments passed to the executable. */
  readonly args: readonly string[];
  /** Turn captured output into findings. */
  readonly parse: (stdout: string, stderr: string, exitCode: number | null) => Finding[];
}

/** Per-check execution timeout (ms) when the caller does not override it. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The default P1 check set, run via the workspace's own pnpm scripts:
 * `pnpm typecheck` (tsc diagnostics), `pnpm lint` (ESLint stylish), and
 * `pnpm test` (vitest; coverage thresholds ride the same exit code).
 */
export function defaultQualityChecks(): QualityCheck[] {
  return [
    { name: 'typecheck', command: 'pnpm', args: ['typecheck'], parse: parseTscOutput },
    { name: 'lint', command: 'pnpm', args: ['lint'], parse: parseEslintOutput },
    { name: 'test', command: 'pnpm', args: ['test'], parse: parseVitestOutput },
  ];
}
