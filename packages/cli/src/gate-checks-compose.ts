/**
 * Compose one quality-gate run's full check list — split out of `executors.ts`
 * (#564) to keep that file under its 400-line budget.
 */
import {
  checksFromDefinitionOfDone,
  defaultQualityChecks,
  diffCoverageCheck,
  driftChecksFor,
  type QualityCheck,
} from '@kernloop/faculty-gates';
import type { QualityGateRequest } from './executors.js';

/**
 * The base checks (or the caller's override) PLUS the task's own acceptance
 * criteria (#226) — a child passes only when its OWN definition-of-done
 * passes, not just `pnpm test`. A PRESENT `writtenFiles` (even empty: a
 * child that wrote nothing owns nothing) scopes the default in-process
 * doc-comment + security checks to the child's own writes (#534/#541,
 * CLM-0189); an explicit `checks` override is the caller's to scope.
 * Diff-coverage runs AFTER the base set so the `test` check has emitted the
 * coverage report (#226 item 2), only under the explicit opt-in flag AND
 * when the child's written files are known. The repo's own derived-artifact
 * drift checks (#564: `render-claims`/`docs:render`/`stats:check`) are added
 * ONLY for the CHILD gate (`writtenFiles` present) and only the ones whose
 * render inputs the child actually wrote ({@link driftChecksFor} returns
 * `[]` otherwise, so an unrelated child pays zero added cost) — the
 * standalone `gate quality` path never sets `writtenFiles`, so it stays
 * byte-identical to before.
 */
export function composeGateChecks(request: QualityGateRequest): QualityCheck[] {
  const writtenPaths = request.writtenFiles?.map((f) => f.path);
  return [
    ...(request.checks ?? defaultQualityChecks(writtenPaths)),
    ...(request.diffCoverage === true &&
    request.writtenFiles !== undefined &&
    request.writtenFiles.length > 0
      ? [diffCoverageCheck(request.writtenFiles)]
      : []),
    ...(writtenPaths === undefined ? [] : driftChecksFor(writtenPaths)),
    ...checksFromDefinitionOfDone(request.definitionOfDone ?? []),
  ];
}
