/**
 * Output parsers for the quality gate's default checks (spec §5.3). Each
 * parser turns the raw stdout/stderr of one local tool run into structured,
 * severity-tagged Findings (CLM-0031). Parsing is best-effort pattern
 * matching over well-known tool output shapes; when nothing matches, the
 * runner falls back to {@link outputTail} so a failing check always yields
 * at least one finding.
 */
import type { Finding } from '@kernloop/contracts';

/** `tsc` diagnostic with a location: `src/a.ts(3,7): error TS2322: …`. */
const TSC_LOCATED = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+: .+)$/;

/** `tsc` diagnostic without a location: `error TS18003: …`. */
const TSC_GLOBAL = /^(error|warning) (TS\d+: .+)$/;

/**
 * Parse `tsc --noEmit` output (non-pretty diagnostic format). One finding
 * per diagnostic line; `error` → `error`, `warning` → `warn`; the file path
 * lands on `path` when present.
 */
export function parseTscOutput(stdout: string, stderr: string): Finding[] {
  const findings: Finding[] = [];
  for (const line of splitLines(stdout, stderr)) {
    const located = TSC_LOCATED.exec(line);
    if (located !== null) {
      const [, file = '', row = '', col = '', level = '', detail = ''] = located;
      findings.push({
        severity: level === 'error' ? 'error' : 'warn',
        message: `${level} ${detail} (${file}:${row}:${col})`,
        path: file,
      });
      continue;
    }
    const global = TSC_GLOBAL.exec(line);
    if (global !== null) {
      const [, level = '', detail = ''] = global;
      findings.push({
        severity: level === 'error' ? 'error' : 'warn',
        message: `${level} ${detail}`,
      });
    }
  }
  return findings;
}

/** ESLint stylish file header: an unindented path ending in a source extension. */
const ESLINT_FILE = /^[^\s].*\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** ESLint stylish problem line: `  3:7  error  message  rule-id`. */
const ESLINT_PROBLEM = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+)$/;

/**
 * Parse ESLint stylish output. Problem lines under a file header become
 * findings carrying that file as `path`; `error` → `error`,
 * `warning` → `warn`.
 */
export function parseEslintOutput(stdout: string, stderr: string): Finding[] {
  const findings: Finding[] = [];
  let currentFile: string | undefined;
  for (const line of splitLines(stdout, stderr)) {
    if (ESLINT_FILE.test(line)) {
      currentFile = line.trim();
      continue;
    }
    const problem = ESLINT_PROBLEM.exec(line);
    if (problem !== null) {
      const [, row = '', col = '', level = '', detail = ''] = problem;
      findings.push({
        severity: level === 'error' ? 'error' : 'warn',
        message: `${level} ${detail.trim()} (${currentFile ?? 'unknown'}:${row}:${col})`,
        ...(currentFile === undefined ? {} : { path: currentFile }),
      });
    }
  }
  return findings;
}

/** Vitest failure line: ` FAIL  src/a.test.ts > suite > name` or `× name`. */
const VITEST_FAIL = /^\s*(?:FAIL|×|✕)\s+(.+)$/;

/** Vitest coverage-threshold breach printed on failure. */
const VITEST_COVERAGE = /coverage for .+ does not meet/i;

/**
 * Parse Vitest run output. Each `FAIL`/`×` line becomes an error finding
 * (deduplicated); the leading `file > test` segment supplies `path` when it
 * looks like a file. Coverage-threshold breaches (which Vitest surfaces
 * through the same nonzero exit, CLM-0031) become their own error findings.
 */
export function parseVitestOutput(stdout: string, stderr: string): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const line of splitLines(stdout, stderr)) {
    if (VITEST_COVERAGE.test(line)) {
      pushUnique(findings, seen, { severity: 'error', message: line.trim() });
      continue;
    }
    const fail = VITEST_FAIL.exec(line);
    if (fail === null) continue;
    const rest = (fail[1] ?? '').trim();
    if (rest.length === 0) continue;
    const head = rest.split(' > ')[0] ?? '';
    const isFile = head.includes('.') && !head.includes(' ');
    pushUnique(findings, seen, {
      severity: 'error',
      message: `failed: ${rest}`,
      ...(isFile ? { path: head } : {}),
    });
  }
  return findings;
}

/**
 * The salient TAIL of a check's combined output, used as the fallback finding
 * message when a check fails but nothing structured parses (CLM-0031). Kept as
 * the LAST portion by BOTH lines and chars (#549): every mainstream tool prints
 * its real error LAST (tsc/vitest diagnostics, turbo's `x Unable to find
 * package manager binary`, npm's epilogue), while the HEAD is boilerplate (the
 * `> pkg@ver script` banner, "Packages in scope", telemetry notices). Keeping
 * the whole small output buried the one error line under that banner head — so
 * a coder (and any downstream head-truncating display) saw only boilerplate.
 * We drop the leading banner: keep the last `maxLines` lines, then cap to the
 * last `maxChars`. A leading `…` marks that earlier output was dropped. Never
 * empty. [CLM-0193]
 */
export function outputTail(stdout: string, stderr: string, maxChars = 2000, maxLines = 12): string {
  const combined = `${stdout}\n${stderr}`.trim();
  if (combined.length === 0) return 'no output';
  const lines = combined.split(/\r?\n/);
  const dropped = lines.length > maxLines;
  const tailLines = dropped ? lines.slice(-maxLines).join('\n') : combined;
  const capped = tailLines.length <= maxChars ? tailLines : `${tailLines.slice(-maxChars)}`;
  const truncated = dropped || capped.length < tailLines.length;
  return truncated ? `…${capped}` : capped;
}

/** Split combined stdout/stderr into trimmed-right lines. */
function splitLines(stdout: string, stderr: string): string[] {
  return `${stdout}\n${stderr}`.split(/\r?\n/).map((line) => line.trimEnd());
}

/** Push a finding unless an identical message was already recorded. */
function pushUnique(findings: Finding[], seen: Set<string>, finding: Finding): void {
  if (seen.has(finding.message)) return;
  seen.add(finding.message);
  findings.push(finding);
}
