/**
 * Calibration tests (CLM-0048): per-reviewer precision/recall measured
 * against the ported labeled eval set with scripted reviewer doubles.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateReviewer,
  findingMatches,
  PROMOTION_CRITERION,
  type ReviewerCalibration,
} from './calibrate.js';
import { REVIEW_EVAL_SET, type ReviewEvalCase } from './eval-set.js';
import { REVIEWER_CORRECTNESS } from './reviewers.js';
import { type InvokeReviewer, type ReviewFinding } from './run.js';

const ZERO = { tokens: 0, usd: 0 };

/** Find the eval case a diff belongs to (the scripted double's lookup). */
function caseForDiff(diff: string): ReviewEvalCase {
  const evalCase = REVIEW_EVAL_SET.find((c) => c.diff === diff);
  if (evalCase === undefined) throw new Error('diff not in eval set');
  return evalCase;
}

/** A perfect reviewer: emits exactly each case's expected findings. */
const perfectReviewer: InvokeReviewer = (_reviewer, diff) => {
  const findings: ReviewFinding[] = caseForDiff(diff).expectedFindings.map((expected) => ({
    severity: expected.severity,
    message: `verified defect: ${expected.mustMatch[0] ?? ''}`,
    ...(expected.pathPattern === undefined
      ? {}
      : { path: `packages/x/src/${expected.pathPattern}` }),
  }));
  return Promise.resolve({ findings, summary: 'reviewed', cost: ZERO });
};

/** A noisy reviewer: perfect findings plus one bogus error per case. */
const noisyReviewer: InvokeReviewer = async (reviewer, diff) => {
  const report = await perfectReviewer(reviewer, diff);
  return {
    ...report,
    findings: [
      ...report.findings,
      { severity: 'error', message: 'spurious objection nothing matches', path: 'bogus.ts' },
    ],
  };
};

/** A silent reviewer: never files anything. */
const emptyReviewer: InvokeReviewer = () =>
  Promise.resolve({ findings: [], summary: 'looks fine', cost: ZERO });

function calibrate(invokeReviewer: InvokeReviewer): Promise<ReviewerCalibration> {
  return evaluateReviewer({
    reviewer: REVIEWER_CORRECTNESS,
    cases: REVIEW_EVAL_SET,
    invokeReviewer,
  });
}

describe('evaluateReviewer — over the ported eval set (CLM-0048)', () => {
  it('a perfect reviewer scores precision 1 and recall 1 over the eval set', async () => {
    const result = await calibrate(perfectReviewer);
    expect(result.reviewer).toBe('correctness');
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
    expect(result.perCase).toHaveLength(10);
    for (const score of result.perCase) {
      expect(score.falsePositives).toBe(0);
      expect(score.expectedMatched).toBe(score.expectedTotal);
    }
  });

  it('a noisy reviewer scores lower precision than a perfect one', async () => {
    const result = await calibrate(noisyReviewer);
    // 7 true positives + 10 bogus errors (one per case) → 7/17.
    expect(result.precision).toBeCloseTo(7 / 17);
    expect(result.recall).toBe(1);
    const clean = result.perCase.find((c) => c.caseId === 'synthetic-clean-docs');
    expect(clean?.falsePositives).toBe(1);
  });

  it('an empty-finding reviewer scores recall 0 on should-flag cases', async () => {
    const result = await calibrate(emptyReviewer);
    expect(result.recall).toBe(0);
    // Documented vacuous precision: silence makes no false claims.
    expect(result.precision).toBe(1);
    for (const score of result.perCase) {
      expect(score.emitted).toBe(0);
      expect(score.expectedMatched).toBe(0);
    }
  });

  it('scores a throwing invocation as zero findings with the error recorded', async () => {
    const result = await evaluateReviewer({
      reviewer: REVIEWER_CORRECTNESS,
      cases: REVIEW_EVAL_SET,
      invokeReviewer: (_reviewer, diff) => {
        if (caseForDiff(diff).id === 'synthetic-redos') {
          return Promise.reject(new Error('adapter timeout'));
        }
        return perfectReviewer(_reviewer, diff);
      },
    });
    const failed = result.perCase.find((c) => c.caseId === 'synthetic-redos');
    expect(failed?.invocationError).toBe('adapter timeout');
    expect(failed?.emitted).toBe(0);
    expect(result.recall).toBeCloseTo(6 / 7); // the missed case hurts recall…
    expect(result.precision).toBe(1); // …but never inflates precision
  });

  it('excludes info-severity findings from precision scoring (borderline rule)', async () => {
    const result = await evaluateReviewer({
      reviewer: REVIEWER_CORRECTNESS,
      cases: REVIEW_EVAL_SET.filter((c) => c.label === 'clean'),
      invokeReviewer: () =>
        Promise.resolve({
          findings: [{ severity: 'info', message: 'borderline judgment call' }],
          summary: 'commentary only',
          cost: ZERO,
        }),
    });
    expect(result.perCase.every((c) => c.emitted === 1 && c.scored === 0)).toBe(true);
    expect(result.precision).toBe(1); // commentary never counts as a false positive
    expect(result.recall).toBe(1); // vacuous: clean cases expect nothing
  });
});

describe('findingMatches — the ported matching rule', () => {
  const expected = {
    severity: 'error' as const,
    pathPattern: 'session.ts',
    mustMatch: ['await', 'stale token'],
  };

  it('matches on severity floor + path substring + any keyword', () => {
    expect(
      findingMatches(
        { severity: 'error', message: 'missing AWAIT on refresh', path: 'src/auth/session.ts' },
        expected,
      ),
    ).toBe(true);
    expect(
      findingMatches(
        { severity: 'blocker', message: 'runs with a stale token', path: 'session.ts' },
        expected,
      ),
    ).toBe(true);
  });

  it('rejects findings below the expected severity', () => {
    expect(
      findingMatches({ severity: 'warn', message: 'missing await', path: 'session.ts' }, expected),
    ).toBe(false);
  });

  it('rejects findings on the wrong path or with no path when one is expected', () => {
    expect(
      findingMatches({ severity: 'error', message: 'missing await', path: 'other.ts' }, expected),
    ).toBe(false);
    expect(findingMatches({ severity: 'error', message: 'missing await' }, expected)).toBe(false);
  });

  it('rejects findings whose message names no expected keyword', () => {
    expect(
      findingMatches(
        { severity: 'error', message: 'something else entirely', path: 'session.ts' },
        expected,
      ),
    ).toBe(false);
  });

  it('matches pathless expectations on keywords alone (the #2228 case)', () => {
    expect(
      findingMatches(
        { severity: 'error', message: 'Record<VoterRole, …> maps are no longer exhaustive' },
        { severity: 'error', mustMatch: ['record', 'exhaustive'] },
      ),
    ).toBe(true);
  });
});

describe('PROMOTION_CRITERION — the ported Epic-E threshold', () => {
  it('encodes precision ≥ 0.8 over a window of ≥50, pending ratification', () => {
    expect(PROMOTION_CRITERION).toEqual({ metric: 'precision', threshold: 0.8, windowN: 50 });
  });
});
