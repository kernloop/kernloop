/**
 * Reviewer calibration against the labeled eval set (CLM-0048) — the seed
 * for the Epic-E advisory→enforce promotion path. Runs one reviewer over
 * labeled cases and scores its findings against the expectations, yielding
 * the per-voter precision/recall the Observer's fitness ledger tracks.
 *
 * Matching rule (ported from the v1 scorer `scripts/pr-review-score.ts` +
 * the v5 labeling lessons; full rationale in RUBRIC.md): a finding matches
 * an expected finding when its severity is ≥ the expected severity (the
 * severity floor), the expected `pathPattern` — when set — is a substring
 * of the finding's path (v1's "file + line ±5" tolerance, minus the line
 * kernloop Findings don't carry), and the message names ≥1 `mustMatch`
 * keyword, case-insensitively. Borderline rule (v5 lesson): `info`
 * findings are commentary, excluded from precision scoring entirely.
 */
import { EvidenceThresholdSchema, type EvidenceThreshold, type Finding } from '@kernloop/contracts';
import { type ExpectedFinding, type ReviewEvalCase } from './eval-set.js';
import { type InvokeReviewer } from './run.js';
import { type ReviewerTemplate } from './reviewers.js';

/** Severity rank used by the severity-floor comparison. */
const SEVERITY_RANK: Record<Finding['severity'], number> = {
  info: 0,
  warn: 1,
  error: 2,
  blocker: 3,
};

/** Does one reviewer finding satisfy one expected finding? */
export function findingMatches(finding: Finding, expected: ExpectedFinding): boolean {
  if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[expected.severity]) return false;
  if (expected.pathPattern !== undefined) {
    if (finding.path === undefined) return false;
    if (!finding.path.includes(expected.pathPattern)) return false;
  }
  const message = finding.message.toLowerCase();
  return expected.mustMatch.some((keyword) => message.includes(keyword.toLowerCase()));
}

/** Per-case calibration score. */
export interface ReviewCaseScore {
  readonly caseId: string;
  readonly label: ReviewEvalCase['label'];
  /** Findings the reviewer emitted (all severities). */
  readonly emitted: number;
  /** Findings entering precision scoring (severity ≥ warn). */
  readonly scored: number;
  /** Scored findings matching some expected finding (true positives). */
  readonly matched: number;
  /** Scored findings matching no expected finding (false positives). */
  readonly falsePositives: number;
  /** Expected findings on this case. */
  readonly expectedTotal: number;
  /** Expected findings matched by ≥1 finding (recall numerator). */
  readonly expectedMatched: number;
  /** Set when the reviewer invocation threw — scored as zero findings. */
  readonly invocationError?: string;
}

/** Calibration result for one reviewer over a case set. */
export interface ReviewerCalibration {
  readonly reviewer: string;
  /**
   * True positives / scored findings. Vacuously 1 on zero scored findings
   * — silence makes no false claims; recall is what silence fails.
   */
  readonly precision: number;
  /** Matched / total expected findings. Vacuously 1 on all-clean sets. */
  readonly recall: number;
  readonly perCase: readonly ReviewCaseScore[];
}

/** Options for {@link evaluateReviewer}. */
export interface EvaluateReviewerOptions {
  /** The reviewer under calibration. */
  readonly reviewer: ReviewerTemplate;
  /** Labeled cases to run — typically `REVIEW_EVAL_SET`. */
  readonly cases: readonly ReviewEvalCase[];
  /** The injected model call, as in {@link InvokeReviewer}. */
  readonly invokeReviewer: InvokeReviewer;
}

/** Score one case's findings against its expectations. */
function scoreCase(
  evalCase: ReviewEvalCase,
  findings: readonly Finding[],
  invocationError?: string,
): ReviewCaseScore {
  const scoredFindings = findings.filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK.warn);
  const matched = scoredFindings.filter((f) =>
    evalCase.expectedFindings.some((expected) => findingMatches(f, expected)),
  ).length;
  const expectedMatched = evalCase.expectedFindings.filter((expected) =>
    scoredFindings.some((f) => findingMatches(f, expected)),
  ).length;
  return {
    caseId: evalCase.id,
    label: evalCase.label,
    emitted: findings.length,
    scored: scoredFindings.length,
    matched,
    falsePositives: scoredFindings.length - matched,
    expectedTotal: evalCase.expectedFindings.length,
    expectedMatched,
    ...(invocationError === undefined ? {} : { invocationError }),
  };
}

/**
 * Run one reviewer over the labeled cases and compute its precision and
 * recall (CLM-0048) — the fitness-ledger seed the Epic-E promotion
 * criterion is measured against. Cases run concurrently; a throwing
 * invocation scores as zero findings (hurts recall, never inflates
 * precision).
 */
export async function evaluateReviewer(
  options: EvaluateReviewerOptions,
): Promise<ReviewerCalibration> {
  const perCase = await Promise.all(
    options.cases.map(async (evalCase) => {
      try {
        const report = await options.invokeReviewer(options.reviewer, evalCase.diff);
        return scoreCase(evalCase, report.findings);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return scoreCase(evalCase, [], message);
      }
    }),
  );
  const scored = perCase.reduce((sum, c) => sum + c.scored, 0);
  const matched = perCase.reduce((sum, c) => sum + c.matched, 0);
  const expectedTotal = perCase.reduce((sum, c) => sum + c.expectedTotal, 0);
  const expectedMatched = perCase.reduce((sum, c) => sum + c.expectedMatched, 0);
  return {
    reviewer: options.reviewer.name,
    precision: scored === 0 ? 1 : matched / scored,
    recall: expectedTotal === 0 ? 1 : expectedMatched / expectedTotal,
    perCase,
  };
}

/**
 * The Epic-E advisory→enforce promotion criterion, ported as documented
 * data. v1 defined its SHAPE — "sustained precision ≥ X over a sliding
 * window of N live advisory reviews" (Epic-E, nexus-agents #3845/#3849) —
 * but never ratified the numbers (#3849, the criterion ADR, stayed open).
 * These are the closest sourced values, pending kernloop ratification (a
 * named P3-exit point — "adopt the criterion only"): threshold 0.8 from
 * #2233's operational bound "effective false-positive rate < 20%";
 * windowN 50 from Epic-E's "grow the eval set from n=10 to n ≥ 50".
 */
export const PROMOTION_CRITERION: EvidenceThreshold = EvidenceThresholdSchema.parse({
  metric: 'precision',
  threshold: 0.8,
  windowN: 50,
});
