/**
 * Eval-set data-integrity tests (CLM-0048): the ported v1 cases are
 * present, schema-valid, and labeled per the rubric.
 */
import { describe, expect, it } from 'vitest';
import { REVIEW_EVAL_SET, ReviewEvalCaseSchema } from './eval-set.js';

describe('REVIEW_EVAL_SET — ported v1 data integrity', () => {
  it('ports exactly ten labeled cases from the v1 eval set', () => {
    expect(REVIEW_EVAL_SET).toHaveLength(10);
  });

  it('keeps the v1 label split: seven should-flag, three clean', () => {
    expect(REVIEW_EVAL_SET.filter((c) => c.label === 'should-flag')).toHaveLength(7);
    expect(REVIEW_EVAL_SET.filter((c) => c.label === 'clean')).toHaveLength(3);
  });

  it('keeps the v1 case ids, including the reclassified #2235', () => {
    expect(REVIEW_EVAL_SET.map((c) => c.id).sort()).toEqual(
      [
        '2228',
        '2235',
        '2238',
        'synthetic-clean-docs',
        'synthetic-clean-refactor',
        'synthetic-listener-leak',
        'synthetic-missing-await',
        'synthetic-null-deref',
        'synthetic-off-by-one',
        'synthetic-redos',
      ].sort(),
    );
    expect(new Set(REVIEW_EVAL_SET.map((c) => c.id)).size).toBe(10);
    expect(REVIEW_EVAL_SET.find((c) => c.id === '2235')?.label).toBe('should-flag');
  });

  it('validates every case against the case schema', () => {
    for (const evalCase of REVIEW_EVAL_SET) {
      expect(ReviewEvalCaseSchema.safeParse(evalCase).success).toBe(true);
    }
  });

  it('carries a unified diff in every case', () => {
    for (const evalCase of REVIEW_EVAL_SET) {
      expect(evalCase.diff.startsWith('diff --git ')).toBe(true);
      expect(evalCase.diff).toContain('+++ ');
    }
  });

  it('pairs labels and expectations: should-flag cases expect error+, clean expect none', () => {
    for (const evalCase of REVIEW_EVAL_SET) {
      if (evalCase.label === 'should-flag') {
        expect(evalCase.expectedFindings.length).toBeGreaterThanOrEqual(1);
        for (const expected of evalCase.expectedFindings) {
          // Rubric severity floor: a bug label justifies blocking.
          expect(['error', 'blocker']).toContain(expected.severity);
          expect(expected.mustMatch.length).toBeGreaterThanOrEqual(1);
        }
      } else {
        expect(evalCase.expectedFindings).toEqual([]);
      }
    }
  });

  it('keeps the #2235 labeling lesson in the case notes', () => {
    const lesson = REVIEW_EVAL_SET.find((c) => c.id === '2235');
    expect(lesson?.notes).toContain('originally labeled clean');
    expect(lesson?.notes).toContain('GITHUB_TOKEN');
  });
});
