/**
 * Check definitions for the quality gate (spec §5.3) — data, not behavior.
 * A {@link QualityCheck} names a local command and the parser that turns its
 * output into Findings; the runner in `run.ts` supplies the mechanics.
 *
 * Default set: typecheck, lint, test (subprocess), plus the in-process
 * doc-comment check (#65, CLM-0104). Coverage has no separate check —
 * per-package vitest coverage thresholds fail the test runner's exit code,
 * so a coverage breach surfaces through the `test` check (CLM-0031).
 * Security: no default security check ships in P1 — there is no real,
 * local, model-free security tool wired in this repo yet, and a stub is
 * constitutionally forbidden (spec §1 rule 1); one returns via a claim when
 * a real tool exists.
 */
import type { Check, Finding } from '@kernloop/contracts';
import { scanDocComments } from './doc-scan.js';
import { parseEslintOutput, parseTscOutput, parseVitestOutput } from './parsers.js';

/**
 * A SUBPROCESS check: a command to run inside the workspace and a parser for
 * its output. Exit code 0 means the check passed (the exit code is the
 * mechanical authority); nonzero output is parsed into severity-tagged
 * findings (CLM-0031).
 */
export interface SubprocessCheck {
  /** Short identifier, e.g. `typecheck`. */
  readonly name: string;
  /** Executable to spawn (no shell interpretation). */
  readonly command: string;
  /** Arguments passed to the executable. */
  readonly args: readonly string[];
  /** Turn captured output into findings. */
  readonly parse: (stdout: string, stderr: string, exitCode: number | null) => Finding[];
}

/**
 * An IN-PROCESS check: a pure function over the workspace directory that
 * returns findings directly, for checks with no local CLI to spawn (e.g. the
 * doc-comment scanner parses source via the TS compiler API). Like the
 * subprocess checks it calls no model; it owns its own severities (there is no
 * exit code to gate on). The runner turns a throw into an `error` finding and
 * times out an ASYNC run; a SYNCHRONOUS check blocks the event loop, so it
 * must bound its own work (the doc scanner enforces byte budgets) — the timer
 * cannot interrupt synchronous CPU (CLM-0104).
 */
export interface InProcessCheck {
  /** Short identifier, e.g. `doc-comments`. */
  readonly name: string;
  /** Produce findings for the workspace; may be async. */
  readonly run: (workspaceDir: string) => Finding[] | Promise<Finding[]>;
}

/** One quality check: either a spawned command or an in-process scan. */
export type QualityCheck = SubprocessCheck | InProcessCheck;

/** Discriminate the union: true for an {@link InProcessCheck}. */
export function isInProcessCheck(check: QualityCheck): check is InProcessCheck {
  return 'run' in check;
}

/**
 * The in-process doc-comment check (#65, #108/#122/#120, CLM-0104): flags every
 * exported TS/JS top-level declaration (TS compiler API) and every public
 * declaration in twelve tree-sitter languages (Python/Go/Rust/Java/C/PHP/Ruby,
 * C++/C#/Kotlin/Swift/Scala — in-process WASM grammars) in the workspace that
 * lacks a non-empty doc-comment as an `error` (driving per-child re-iteration),
 * and records one `info` finding per REMAINING source language it cannot yet
 * cover. Presence only, never accuracy. Async (the WASM grammars load asynchronously).
 */
export function docCommentCheck(): InProcessCheck {
  return { name: 'doc-comments', run: scanDocComments };
}

/** Per-check execution timeout (ms) when the caller does not override it. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The default check set: the workspace's own pnpm scripts — `pnpm typecheck`
 * (tsc diagnostics), `pnpm lint` (ESLint stylish), `pnpm test` (vitest;
 * coverage thresholds ride the same exit code) — plus the in-process
 * doc-comment scan (#65). The doc check runs last so a missing-docs `error`
 * sits alongside the tool findings in the same Verdict.
 */
export function defaultQualityChecks(): QualityCheck[] {
  return [
    { name: 'typecheck', command: 'pnpm', args: ['typecheck'], parse: parseTscOutput },
    { name: 'lint', command: 'pnpm', args: ['lint'], parse: parseEslintOutput },
    { name: 'test', command: 'pnpm', args: ['test'], parse: parseVitestOutput },
    docCommentCheck(),
  ];
}

/**
 * Map a task's `definitionOfDone` into runnable quality checks (#226): each
 * Check's `command` STRING is tokenized on whitespace into an executable + args
 * and spawned WITH NO SHELL — so a model-supplied command cannot inject shell
 * metacharacters (`;`/`&&`/`$()` become literal argv, harmless). Exit 0 is the
 * pass authority (parse returns nothing); the runner turns a nonzero exit into
 * an `error` finding naming the check, so an acceptance criterion that fails
 * fails the gate. A blank command tokenizes to an empty executable and fails to
 * start — fail CLOSED, a check that cannot run never silently passes. Names are
 * `dod:<name>` so acceptance findings are distinct from the default tool checks.
 *
 * SECURITY: this runs spec/model-supplied content as a subprocess in the
 * workspace; no-shell argv is the injection defense here. Scoping the child ENV
 * (so a task command cannot read host secrets) hardens this path AND the default
 * `pnpm test` path alike and is tracked as pipeline-hardening in #227.
 */
export function checksFromDefinitionOfDone(dod: readonly Check[]): SubprocessCheck[] {
  return dod.map((check) => {
    const [command = '', ...args] = check.command.trim().split(/\s+/);
    return { name: `dod:${check.name}`, command, args, parse: (): Finding[] => [] };
  });
}
