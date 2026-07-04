/**
 * Check definitions for the quality gate (spec §5.3) — data, not behavior.
 * A {@link QualityCheck} names a local command and the parser that turns its
 * output into Findings; the runner in `run.ts` supplies the mechanics.
 *
 * Default set: typecheck, lint, test (subprocess), plus the in-process
 * doc-comment check (#65, CLM-0104) and the in-process SECURITY smell check
 * (#277). Coverage has no separate check — per-package vitest coverage
 * thresholds fail the test runner's exit code, so a coverage breach surfaces
 * through the `test` check (CLM-0031). The security check is the model-free,
 * always-on output-AppSec signal (#227 item 3): a curated high-confidence
 * ruleset (dynamic code exec, shell injection, known-format secrets) at
 * advisory tier — no external binary, so it never degrades to no-signal.
 */
import type { Check, Finding } from '@kernloop/contracts';
import {
  scanDocComments,
  scanSecuritySmells,
  scanWrittenCoverage,
  type WrittenFile,
} from '@kernloop/docscan';
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
 *
 * `writtenFiles` (#534, CLM-0189) scopes the scan to those workspace-relative
 * paths — the canonical loop passes the CHILD's written files so a child is
 * judged only on what IT wrote, mirroring {@link diffCoverageCheck}; a
 * pre-existing repo-wide doc gap can no longer fail every child. Omitted →
 * the whole-workspace scan (the standalone `gate quality` semantics) is
 * unchanged.
 */
export function docCommentCheck(writtenFiles?: readonly string[]): InProcessCheck {
  return {
    name: 'doc-comments',
    run: (workspaceDir) => scanDocComments(workspaceDir, writtenFiles),
  };
}

/**
 * The in-process SECURITY smell check (#277, #227 item 3): a model-free,
 * always-on, curated high-confidence scan of generated source for dynamic code
 * execution (`eval`/`new Function` with a non-literal arg), shell-command
 * injection (`exec`/`execSync` with a non-literal command), and known-format
 * hardcoded secrets — emitting advisory `error` Findings. It is a smell detector,
 * NOT exhaustive SAST; the broader external-tool tier is deferred (#276).
 *
 * `writtenFiles` (#541, CLM-0189) scopes the scan to those workspace-relative
 * paths — the child quality gate passes the CHILD's written files, exactly as
 * {@link docCommentCheck}, so a child is judged on the smells of what IT wrote
 * and never failed on pre-existing repo content (e.g. detector fixtures).
 * Omitted → the whole-workspace scan (the standalone `gate quality` semantics)
 * is unchanged.
 */
export function securityCheck(writtenFiles?: readonly string[]): InProcessCheck {
  return {
    name: 'security',
    run: (workspaceDir) => scanSecuritySmells(workspaceDir, writtenFiles),
  };
}

/**
 * The in-process DIFF-COVERAGE check (#226 item 2, EPIC #47 P1): flags executable
 * source files THIS child wrote that the test suite never exercises — an untested
 * written module (absent from `coverage/coverage-final.json`) is an `error` (the
 * rubber-stamp aggregate thresholds miss), uncovered statements in a covered file
 * are a `warn`, and a missing report FAILS CLOSED with one `error` (the check runs
 * only under the explicit opt-in, so a graceful pass would let an agent disable the
 * reporter to bypass the gate). Model-free; closes over the child's written files.
 * Must run AFTER the `test` check that emits the report — the runner's array order.
 */
export function diffCoverageCheck(writtenFiles: readonly WrittenFile[]): InProcessCheck {
  return {
    name: 'diff-coverage',
    run: (workspaceDir) => scanWrittenCoverage(writtenFiles, workspaceDir),
  };
}

/** Per-check execution timeout (ms) when the caller does not override it. */
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The default check set: the workspace's own pnpm scripts — `pnpm typecheck`
 * (tsc diagnostics), `pnpm lint` (ESLint stylish), `pnpm test` (vitest;
 * coverage thresholds ride the same exit code) — plus the in-process
 * doc-comment scan (#65). The doc check runs last so a missing-docs `error`
 * sits alongside the tool findings in the same Verdict. `childScope` (#534,
 * #541; CLM-0189) narrows BOTH in-process whole-workspace scans — doc-comments
 * AND the security smell check — to those workspace-relative files (a child
 * gate scoped to the child's writes; the subprocess tool checks judge the
 * whole workspace regardless, as they must); omitted, every check keeps its
 * whole-workspace semantics.
 */
export function defaultQualityChecks(childScope?: readonly string[]): QualityCheck[] {
  return [
    { name: 'typecheck', command: 'pnpm', args: ['typecheck'], parse: parseTscOutput },
    { name: 'lint', command: 'pnpm', args: ['lint'], parse: parseEslintOutput },
    { name: 'test', command: 'pnpm', args: ['test'], parse: parseVitestOutput },
    docCommentCheck(childScope),
    securityCheck(childScope),
  ];
}

/**
 * Gated packages whose public value-export SOURCE files feed `docs:render`
 * (docs/API.md, #64/#72) — mirrors `scripts/docs-coverage.mjs`'s
 * `GATED_PACKAGES`. Duplicated here rather than imported: a faculty package
 * cannot reach across the package boundary into a repo-root script (there is
 * no build/publish relationship between them); `checks.test.ts` reads the
 * script's own list and asserts the two stay identical, so drift between them
 * fails a test rather than silently under/over-triggering (#564).
 */
const DOCS_RENDER_GATED_PACKAGES: readonly string[] = [
  'contracts',
  'kernel',
  'cli',
  'docscan',
  'parsimony',
  'workflows',
  'faculty-compiler',
  'faculty-gates',
  'faculty-memory',
  'faculty-observer',
  'faculty-scrum',
  'faculty-toolsmith',
  'faculty-workforce',
  'tracker',
];

/**
 * README-stats INPUTS (`stats:check`, #189/CLM-0113) — the exact files
 * `scripts/stats.mjs` reads: the const files it derives counts from, the
 * `WATCHED` prose files it cross-checks, plus the two directories whose file
 * COUNT is itself a derived stat (`docscan/grammars/*.wasm`,
 * `claims/registry/*.yaml` — adding or removing a file there moves a count
 * without touching any const).
 */
const STATS_INPUT_FILES: readonly string[] = [
  'packages/contracts/src/common.ts',
  'packages/cli/src/tools/index.ts',
  'packages/faculty-workforce/src/templates.ts',
  'scripts/docs-coverage.mjs',
  'README.md',
  'AGENTS.md',
  'claims/registry/CLM-0091.yaml',
  'claims/registry/CLM-0104.yaml',
];

/** Directory prefixes whose file COUNT (not content) is a derived stats input. */
const STATS_INPUT_DIR_PREFIXES: readonly string[] = [
  'packages/docscan/grammars/',
  'claims/registry/',
];

/** True when `writtenPath` is a claims-registry file — `render-claims --check`'s input. */
function isClaimsRenderInput(writtenPath: string): boolean {
  return writtenPath === 'claims' || writtenPath.startsWith('claims/');
}

/** True when `writtenPath` is a gated package's source — `docs:render --check`'s input. */
function isDocsRenderInput(writtenPath: string): boolean {
  return DOCS_RENDER_GATED_PACKAGES.some((pkg) => writtenPath.startsWith(`packages/${pkg}/src/`));
}

/** True when `writtenPath` is one of `stats:check`'s derived-count or watched-prose inputs. */
function isStatsInput(writtenPath: string): boolean {
  return (
    STATS_INPUT_FILES.includes(writtenPath) ||
    STATS_INPUT_DIR_PREFIXES.some((prefix) => writtenPath.startsWith(prefix))
  );
}

/**
 * The repo's own derived-artifact drift checks (`render-claims`/`docs:render`/
 * `stats:check`, all run `--check`-only in `preflight`/CI today), CONDITIONED
 * on the child having actually written one of that render's inputs (#564,
 * closing the #562/DF1 rescue gap: a child edited a claim YAML, passed its
 * quality gate, and left `docs/CLAIMS.md` stale for CI to catch after merge).
 *
 * Each `--check` run below is a WHOLE-REPO scan, but the child quality gate
 * runs it over a FRESHLY-CLONED, green throwaway workspace (#236's sandbox
 * copy) — the repo carries no pre-existing drift there, so any failure here is
 * provably the CHILD's own un-regenerated render, never inherited debt. A
 * child that wrote none of these inputs gets none of these checks: zero added
 * cost. `parse` returns no findings on its own — a nonzero exit already
 * becomes an `error` via the runner's generic output-tail fallback
 * (`findingsForCheck`, CLM-0031), exactly like {@link checksFromDefinitionOfDone}.
 *
 * Only wired into the CHILD gate (`writtenFiles` present) by
 * {@link executeQualityGate} in `packages/cli/src/executors.ts` — the
 * standalone `gate quality` path never calls this, so its semantics are
 * unchanged.
 */
export function driftChecksFor(writtenFiles: readonly string[]): SubprocessCheck[] {
  const checks: SubprocessCheck[] = [];
  const noFindings = (): Finding[] => [];
  if (writtenFiles.some(isClaimsRenderInput)) {
    checks.push({
      name: 'claims-render-drift',
      command: 'node',
      args: ['scripts/render-claims.mjs', '--check'],
      parse: noFindings,
    });
  }
  if (writtenFiles.some(isDocsRenderInput)) {
    checks.push({
      name: 'docs-render-drift',
      command: 'pnpm',
      args: ['docs:render', '--', '--check'],
      parse: noFindings,
    });
  }
  if (writtenFiles.some(isStatsInput)) {
    checks.push({
      name: 'stats-drift',
      command: 'pnpm',
      args: ['stats:check'],
      parse: noFindings,
    });
  }
  return checks;
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
