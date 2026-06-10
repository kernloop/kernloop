/**
 * The review gate runner (spec §5.3): convenes a panel of adversarial
 * reviewers concurrently over one diff, merges and deduplicates their
 * findings with per-reviewer attribution, and emits one zod-validated
 * Verdict whose `voters` array carries the per-reviewer records the
 * Observer ingests into the fitness ledger's precision series (CLM-0047).
 *
 * The faculty stays model-free: model invocation arrives as the injected
 * `invokeReviewer` dependency bound by the composition root (the vote
 * gate's pattern). The verdict is honest, not soft: an `error`/`blocker`
 * finding yields `reject` even at `advisory` tier — the manifest tier is
 * what makes the verdict non-blocking (spec §3.2), never the verdict.
 */
import { z } from 'zod';
import {
  CostSchema,
  VerdictSchema,
  type Cost,
  type Finding,
  type Verdict,
  type VoterRecord,
} from '@kernloop/contracts';
import { REVIEW_PANEL_DEFAULT, type ReviewerTemplate } from './reviewers.js';

/** One finding inside a reviewer's report — the contract Finding shape. */
export const ReviewFindingSchema = z.strictObject({
  severity: z.enum(['info', 'warn', 'error', 'blocker']),
  message: z.string().min(1),
  path: z.string().min(1).optional(),
});
/** A reviewer-filed finding — see {@link ReviewFindingSchema}. */
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

/**
 * What the injected `invokeReviewer` must return — zod-validated on
 * receipt; an invalid report is a reviewer error, never coerced findings.
 */
export const ReviewerReportSchema = z.strictObject({
  findings: z.array(ReviewFindingSchema),
  summary: z.string(),
  cost: CostSchema,
});
/** One reviewer's returned report — see {@link ReviewerReportSchema}. */
export type ReviewerReport = z.infer<typeof ReviewerReportSchema>;

/**
 * Injected reviewer invocation (the model call, owned by the composition
 * root): reviewer template, the diff under review, optional context.
 */
export type InvokeReviewer = (
  reviewer: ReviewerTemplate,
  diff: string,
  context?: string,
) => Promise<ReviewerReport>;

/** Options for {@link runReviewGate}. */
export interface RunReviewGateOptions {
  /** Task the verdict judges (Verdict.taskId). */
  readonly taskId: string;
  /** The unified diff the panel reviews. */
  readonly diff: string;
  /** Optional repo/task context shared by every reviewer. */
  readonly context?: string;
  /** Panel to convene; defaults to {@link REVIEW_PANEL_DEFAULT} (3 lenses). */
  readonly panel?: readonly ReviewerTemplate[];
  /** The injected model call — see {@link InvokeReviewer}. */
  readonly invokeReviewer: InvokeReviewer;
}

/** Duplicate findings = same path (or none) + this normalized prefix. */
export const DEDUP_PREFIX_LENGTH = 60;

/** Severity order, ascending — also the max-severity pick for merges. */
const SEVERITY_ORDER = ['info', 'warn', 'error', 'blocker'] as const;
const ZERO_COST: Cost = { tokens: 0, usd: 0 };

interface ReviewerResult {
  readonly reviewer: ReviewerTemplate;
  readonly report?: ReviewerReport;
  readonly error?: string;
}

/**
 * Invoke one reviewer, never letting a failure escape: a thrown call or a
 * schema-invalid report becomes an error result recorded as an `abstain`
 * VoterRecord — the gate never fabricates findings or a vote (the vote
 * gate's pattern).
 */
async function collectReport(
  invokeReviewer: InvokeReviewer,
  reviewer: ReviewerTemplate,
  diff: string,
  context?: string,
): Promise<ReviewerResult> {
  let raw: unknown;
  try {
    raw = await invokeReviewer(reviewer, diff, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reviewer, error: message };
  }
  const parsed = ReviewerReportSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join('; ');
    return { reviewer, error: `invalid report: ${message}` };
  }
  return { reviewer, report: parsed.data };
}

/** Does this reviewer's own report justify blocking from their lens? */
function reviewerVote(report: ReviewerReport): 'approve' | 'reject' {
  return report.findings.some((f) => f.severity === 'error' || f.severity === 'blocker')
    ? 'reject'
    : 'approve';
}

/** One VoterRecord per reviewer: their summary is their reasoning. */
function toVoterRecords(results: readonly ReviewerResult[]): VoterRecord[] {
  return results.map((r) =>
    r.report === undefined
      ? { voter: r.reviewer.name, vote: 'abstain', reasoning: `reviewer_error: ${r.error ?? ''}` }
      : { voter: r.reviewer.name, vote: reviewerVote(r.report), reasoning: r.report.summary },
  );
}

function dedupKey(finding: ReviewFinding): string {
  const prefix = finding.message
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DEDUP_PREFIX_LENGTH);
  return `${finding.path ?? ''}|${prefix}`;
}

/**
 * Merge every reviewer's findings, deduplicating (same path + message
 * prefix) and attributing each surviving finding to its reviewer(s). A
 * merged finding keeps the first-filed message/path and the max severity.
 */
export function mergeFindings(
  reports: ReadonlyArray<{ reviewer: string; findings: readonly ReviewFinding[] }>,
): Finding[] {
  const merged = new Map<string, { finding: ReviewFinding; reviewers: string[] }>();
  for (const { reviewer, findings } of reports) {
    for (const finding of findings) {
      const key = dedupKey(finding);
      const existing = merged.get(key);
      if (existing === undefined) {
        merged.set(key, { finding, reviewers: [reviewer] });
      } else {
        if (!existing.reviewers.includes(reviewer)) existing.reviewers.push(reviewer);
        if (
          SEVERITY_ORDER.indexOf(finding.severity) >
          SEVERITY_ORDER.indexOf(existing.finding.severity)
        ) {
          existing.finding = { ...existing.finding, severity: finding.severity };
        }
      }
    }
  }
  return [...merged.values()].map(({ finding, reviewers }) => ({
    severity: finding.severity,
    message: `${finding.message} [reviewers: ${reviewers.join(', ')}]`,
    ...(finding.path === undefined ? {} : { path: finding.path }),
  }));
}

/** Sum reviewer costs; wall clock is the panel's measured time, not a sum. */
function sumCosts(results: readonly ReviewerResult[], wallClockMs: number): Cost {
  let tokens = 0;
  let usd = 0;
  const byAdapter: Record<string, { tokens: number; usd: number }> = {};
  let hasAdapterBreakdown = false;
  for (const result of results) {
    const cost = result.report?.cost ?? ZERO_COST;
    tokens += cost.tokens;
    usd += cost.usd;
    for (const [adapter, slice] of Object.entries(cost.byAdapter ?? {})) {
      hasAdapterBreakdown = true;
      const prior = byAdapter[adapter] ?? { tokens: 0, usd: 0 };
      byAdapter[adapter] = { tokens: prior.tokens + slice.tokens, usd: prior.usd + slice.usd };
    }
  }
  return hasAdapterBreakdown
    ? { tokens, usd, wallClockMs, byAdapter }
    : { tokens, usd, wallClockMs };
}

/**
 * Convene the panel and emit one Verdict (CLM-0047). Reviewers run
 * concurrently via `Promise.all`; VoterRecords preserve panel order.
 * Aggregation: `reject` if any `error`/`blocker` finding survives the
 * merge (honest even at advisory tier — the manifest tier is what makes
 * it non-blocking); `abstain` when every reviewer failed (no judgment,
 * confidence 0); `approve` otherwise. Confidence is the agreement share:
 * the fraction of the panel whose own vote equals the aggregate result.
 */
export async function runReviewGate(options: RunReviewGateOptions): Promise<Verdict> {
  const panel = options.panel ?? REVIEW_PANEL_DEFAULT;
  if (panel.length === 0) {
    throw new Error('review gate: panel must contain at least one reviewer');
  }
  const started = Date.now();
  const results = await Promise.all(
    panel.map((reviewer) =>
      collectReport(options.invokeReviewer, reviewer, options.diff, options.context),
    ),
  );
  const voters = toVoterRecords(results);
  const findings = mergeFindings(
    results
      .filter((r) => r.report !== undefined)
      .map((r) => ({ reviewer: r.reviewer.name, findings: r.report?.findings ?? [] })),
  );
  const anyReport = results.some((r) => r.report !== undefined);
  const blocking = findings.some((f) => f.severity === 'error' || f.severity === 'blocker');
  const result = !anyReport ? 'abstain' : blocking ? 'reject' : 'approve';
  const agreement = voters.filter((v) => v.vote === result && result !== 'abstain').length;
  return VerdictSchema.parse({
    taskId: options.taskId,
    gate: 'review',
    result,
    confidence: agreement / panel.length,
    findings,
    voters,
    cost: sumCosts(results, Date.now() - started),
  });
}
