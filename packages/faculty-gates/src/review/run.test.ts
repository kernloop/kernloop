/**
 * Review gate runner tests (CLM-0047). The injected `invokeReviewer` is
 * scripted per test — an honest test double for the external model CLI;
 * what is claimed (and therefore tested) is the panel, merge/dedup,
 * attribution, and per-voter recording machinery around it.
 */
import { describe, expect, it } from 'vitest';
import { VerdictSchema } from '@kernloop/contracts';
import {
  DEDUP_PREFIX_LENGTH,
  mergeFindings,
  runReviewGate,
  type InvokeReviewer,
  type ReviewerReport,
  type ReviewFinding,
} from './run.js';
import { REVIEW_PANEL_DEFAULT, REVIEW_PANEL_FULL } from './reviewers.js';

const ZERO = { tokens: 0, usd: 0 };

/** Scripted reviewer: findings looked up by reviewer name; clean default. */
function scriptedReviewer(script: Record<string, ReviewFinding[]>): InvokeReviewer {
  return (reviewer) =>
    Promise.resolve({
      findings: script[reviewer.name] ?? [],
      summary: `${reviewer.name} summary`,
      cost: { tokens: 10, usd: 0.01 },
    });
}

function baseOptions(invokeReviewer: InvokeReviewer) {
  return { taskId: 'task-1', diff: 'diff --git a/x b/x', invokeReviewer };
}

describe('runReviewGate — panel', () => {
  it('convenes the default 3-lens panel when no panel is given', async () => {
    const invoked: string[] = [];
    const verdict = await runReviewGate({
      ...baseOptions((reviewer) => {
        invoked.push(reviewer.name);
        return Promise.resolve({ findings: [], summary: 'clean', cost: ZERO });
      }),
    });
    expect(invoked).toEqual(['correctness', 'security', 'maintainability']);
    expect(verdict.voters).toHaveLength(3);
  });

  it('convenes the full 5-reviewer v1 panel when given', async () => {
    const verdict = await runReviewGate({
      ...baseOptions(scriptedReviewer({})),
      panel: REVIEW_PANEL_FULL,
    });
    expect(verdict.voters?.map((v) => v.voter)).toEqual(REVIEW_PANEL_FULL.map((r) => r.name));
  });

  it('rejects an empty panel rather than abstaining silently', async () => {
    await expect(
      runReviewGate({ ...baseOptions(scriptedReviewer({})), panel: [] }),
    ).rejects.toThrow('panel must contain at least one reviewer');
  });

  it('passes the same diff and context to every reviewer', async () => {
    const seen: Array<{ diff: string; context?: string }> = [];
    await runReviewGate({
      taskId: 'task-1',
      diff: 'the-diff',
      context: 'the-context',
      invokeReviewer: (_reviewer, diff, context) => {
        seen.push({ diff, ...(context === undefined ? {} : { context }) });
        return Promise.resolve({ findings: [], summary: 'ok', cost: ZERO });
      },
    });
    expect(seen).toEqual([
      { diff: 'the-diff', context: 'the-context' },
      { diff: 'the-diff', context: 'the-context' },
      { diff: 'the-diff', context: 'the-context' },
    ]);
  });
});

describe('runReviewGate — advisory verdict honesty (CLM-0047)', () => {
  it('rejects when any reviewer files an error finding (advisory verdict stays honest)', async () => {
    const verdict = await runReviewGate({
      ...baseOptions(
        scriptedReviewer({
          correctness: [{ severity: 'error', message: 'off-by-one in clamp', path: 'a.ts' }],
        }),
      ),
    });
    expect(verdict.result).toBe('reject');
    expect(verdict.confidence).toBeCloseTo(1 / 3); // one of three voted reject
  });

  it('rejects on a blocker finding', async () => {
    const verdict = await runReviewGate({
      ...baseOptions(
        scriptedReviewer({ security: [{ severity: 'blocker', message: 'secret committed' }] }),
      ),
    });
    expect(verdict.result).toBe('reject');
  });

  it('approves when findings stay at warn/info — they surface but do not block', async () => {
    const verdict = await runReviewGate({
      ...baseOptions(
        scriptedReviewer({
          correctness: [{ severity: 'warn', message: 'tight coupling', path: 'a.ts' }],
          maintainability: [{ severity: 'info', message: 'consider a rename' }],
        }),
      ),
    });
    expect(verdict.result).toBe('approve');
    expect(verdict.confidence).toBe(1); // all three reviewers individually approve
    expect(verdict.findings).toHaveLength(2);
  });

  it('approves a clean panel with full agreement and no findings', async () => {
    const verdict = await runReviewGate({ ...baseOptions(scriptedReviewer({})) });
    expect(verdict.result).toBe('approve');
    expect(verdict.confidence).toBe(1);
    expect(verdict.findings).toEqual([]);
  });
});

describe('runReviewGate — merge, dedup, attribution', () => {
  it('deduplicates same-path same-prefix findings and attributes both reviewers', async () => {
    const finding: ReviewFinding = {
      severity: 'error',
      message: 'missing await on refreshToken',
      path: 'session.ts',
    };
    const verdict = await runReviewGate({
      ...baseOptions(scriptedReviewer({ correctness: [finding], security: [finding] })),
    });
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.message).toBe(
      'missing await on refreshToken [reviewers: correctness, security]',
    );
    expect(verdict.findings[0]?.path).toBe('session.ts');
  });

  it('keeps findings with the same message but different paths separate', () => {
    const merged = mergeFindings([
      { reviewer: 'a', findings: [{ severity: 'warn', message: 'leaky listener', path: 'x.ts' }] },
      { reviewer: 'b', findings: [{ severity: 'warn', message: 'leaky listener', path: 'y.ts' }] },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('dedups on the normalized message prefix, keeping the max severity', () => {
    const long = 'x'.repeat(DEDUP_PREFIX_LENGTH);
    const merged = mergeFindings([
      { reviewer: 'a', findings: [{ severity: 'warn', message: `${long} tail-one` }] },
      { reviewer: 'b', findings: [{ severity: 'error', message: `${long} tail-two` }] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.severity).toBe('error');
    expect(merged[0]?.message).toContain('[reviewers: a, b]');
  });

  it('treats case and whitespace as insignificant in the dedup key', () => {
    const merged = mergeFindings([
      { reviewer: 'a', findings: [{ severity: 'warn', message: 'Unused   Helper here' }] },
      { reviewer: 'b', findings: [{ severity: 'warn', message: 'unused helper here' }] },
    ]);
    expect(merged).toHaveLength(1);
  });

  it('attributes a reviewer only once even with duplicate findings in one report', () => {
    const merged = mergeFindings([
      {
        reviewer: 'a',
        findings: [
          { severity: 'warn', message: 'dup finding' },
          { severity: 'warn', message: 'dup finding' },
        ],
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.message).toBe('dup finding [reviewers: a]');
  });
});

describe('runReviewGate — reviewer records and failure (CLM-0047)', () => {
  it('records one VoterRecord per reviewer with their summary as reasoning', async () => {
    const verdict = await runReviewGate({
      ...baseOptions(
        scriptedReviewer({
          security: [{ severity: 'error', message: 'injection risk', path: 'b.ts' }],
        }),
      ),
    });
    expect(verdict.voters).toEqual([
      { voter: 'correctness', vote: 'approve', reasoning: 'correctness summary' },
      { voter: 'security', vote: 'reject', reasoning: 'security summary' },
      { voter: 'maintainability', vote: 'approve', reasoning: 'maintainability summary' },
    ]);
  });

  it('records a throwing reviewer as abstain with reviewer_error reasoning', async () => {
    const verdict = await runReviewGate({
      ...baseOptions((reviewer) => {
        if (reviewer.name === 'security') return Promise.reject(new Error('model CLI exploded'));
        return Promise.resolve({ findings: [], summary: 'ok', cost: ZERO });
      }),
    });
    const security = verdict.voters?.find((v) => v.voter === 'security');
    expect(security?.vote).toBe('abstain');
    expect(security?.reasoning).toBe('reviewer_error: model CLI exploded');
    expect(verdict.result).toBe('approve'); // remaining reviewers were clean
    expect(verdict.confidence).toBeCloseTo(2 / 3);
  });

  it('records a schema-invalid report as abstain, never coercing findings', async () => {
    const verdict = await runReviewGate({
      ...baseOptions((reviewer) => {
        if (reviewer.name === 'correctness') {
          return Promise.resolve({ findings: 'not-an-array' } as unknown as ReviewerReport);
        }
        return Promise.resolve({ findings: [], summary: 'ok', cost: ZERO });
      }),
    });
    const correctness = verdict.voters?.find((v) => v.voter === 'correctness');
    expect(correctness?.vote).toBe('abstain');
    expect(correctness?.reasoning).toContain('reviewer_error: invalid report:');
  });

  it('abstains with confidence 0 when every reviewer fails', async () => {
    const verdict = await runReviewGate({
      ...baseOptions(() => Promise.reject(new Error('all adapters down'))),
    });
    expect(verdict.result).toBe('abstain');
    expect(verdict.confidence).toBe(0);
    expect(verdict.findings).toEqual([]);
    expect(verdict.voters?.every((v) => v.vote === 'abstain')).toBe(true);
  });
});

describe('runReviewGate — cost and schema', () => {
  it('sums reviewer costs, including per-adapter breakdowns', async () => {
    const costs: Record<string, ReviewerReport['cost']> = {
      correctness: { tokens: 100, usd: 0.1, byAdapter: { claude: { tokens: 100, usd: 0.1 } } },
      security: { tokens: 50, usd: 0.05, byAdapter: { codex: { tokens: 50, usd: 0.05 } } },
      maintainability: {
        tokens: 25,
        usd: 0.025,
        byAdapter: { claude: { tokens: 25, usd: 0.025 } },
      },
    };
    const verdict = await runReviewGate({
      ...baseOptions((reviewer) =>
        Promise.resolve({ findings: [], summary: 'ok', cost: costs[reviewer.name] ?? ZERO }),
      ),
    });
    expect(verdict.cost.tokens).toBe(175);
    expect(verdict.cost.usd).toBeCloseTo(0.175);
    expect(verdict.cost.wallClockMs).toBeGreaterThanOrEqual(0);
    expect(verdict.cost.byAdapter).toEqual({
      claude: { tokens: 125, usd: 0.125 },
      codex: { tokens: 50, usd: 0.05 },
    });
  });

  it('charges zero cost for an errored reviewer', async () => {
    const verdict = await runReviewGate({
      ...baseOptions((reviewer) => {
        if (reviewer.name === 'correctness') return Promise.reject(new Error('down'));
        return Promise.resolve({ findings: [], summary: 'ok', cost: { tokens: 7, usd: 0.2 } });
      }),
    });
    expect(verdict.cost.tokens).toBe(14);
    expect(verdict.cost.usd).toBeCloseTo(0.4);
  });

  it('emits a schema-valid Verdict for the review gate', async () => {
    const verdict = await runReviewGate({
      ...baseOptions(
        scriptedReviewer({ correctness: [{ severity: 'error', message: 'real bug' }] }),
      ),
    });
    expect(VerdictSchema.safeParse(verdict).success).toBe(true);
    expect(verdict.gate).toBe('review');
    expect(verdict.taskId).toBe('task-1');
  });
});

describe('runReviewGate — concurrency', () => {
  it('invokes every reviewer before any report resolves (concurrent panel)', async () => {
    const invoked: string[] = [];
    const resolvers: Array<(r: ReviewerReport) => void> = [];
    const promise = runReviewGate({
      ...baseOptions((reviewer) => {
        invoked.push(reviewer.name);
        return new Promise<ReviewerReport>((resolve) => resolvers.push(resolve));
      }),
    });
    await Promise.resolve();
    expect(invoked).toEqual(REVIEW_PANEL_DEFAULT.map((r) => r.name));
    expect(resolvers).toHaveLength(3);
    for (const resolve of resolvers) {
      resolve({ findings: [], summary: 'ok', cost: ZERO });
    }
    const verdict = await promise;
    expect(verdict.result).toBe('approve');
  });
});
