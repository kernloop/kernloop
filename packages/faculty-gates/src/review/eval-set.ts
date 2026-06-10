/**
 * The labeled review eval set — DATA, not behavior. Ported from
 * nexus-agents v1 `testing/datasets/pr-review-sample.json` (curated
 * 2026-04-27, post-v5 hybrid v3; quarry item 4 of spec §10): exactly 10
 * cases — 5 synthetic diff-readable bugs, 3 historical PRs (#2228, #2235,
 * #2238), 2 synthetic clean counterparts; 7 should-flag, 3 clean (#2235
 * was reclassified clean→buggy after v5 caught a real shipped bug in it —
 * the central labeling lesson, RUBRIC.md). Synthetic diffs are the v1
 * `customDiff` payloads verbatim; historical entries embed hunks from the
 * real commits (deltas in PORT-NOTES.md). Labels reshape v1 `knownBugs`
 * into severity + path + keyword expectations on the Finding contract.
 */
import { z } from 'zod';

/**
 * One expected finding on a should-flag case (a v1 `knownBug`, reshaped);
 * the matching rule lives in `calibrate.ts`.
 */
export const ExpectedFindingSchema = z.strictObject({
  /** Minimum severity an honest reviewer should assign (rubric floor). */
  severity: z.enum(['info', 'warn', 'error', 'blocker']),
  /** Substring the finding's path must contain, when location is stable. */
  pathPattern: z.string().min(1).optional(),
  /** Keywords naming the defect — a matching message mentions ≥1 of them. */
  mustMatch: z.array(z.string().min(1)).min(1),
});
export type ExpectedFinding = z.infer<typeof ExpectedFindingSchema>;

/** One labeled eval case, ported from a v1 dataset entry. */
export const ReviewEvalCaseSchema = z.strictObject({
  /** Stable case id (v1 `number`, stringified). */
  id: z.string().min(1),
  /** v1 PR title. */
  title: z.string().min(1),
  /** The unified diff under review. */
  diff: z.string().min(1),
  /** `should-flag` = v1 `knownBugs` non-empty; `clean` = empty. */
  label: z.enum(['should-flag', 'clean']),
  /** Reshaped v1 knownBugs; empty exactly when `label` is `clean`. */
  expectedFindings: z.array(ExpectedFindingSchema),
  /** Provenance + adjudication notes condensed from the v1 entry. */
  notes: z.string().min(1),
});
export type ReviewEvalCase = z.infer<typeof ReviewEvalCaseSchema>;

const CASES: ReviewEvalCase[] = [
  {
    id: 'synthetic-redos',
    title: 'feat(security): add base64 detection for input sanitizer (synthetic test case)',
    diff: `diff --git a/packages/nexus-agents/src/security/input-sanitizer.ts b/packages/nexus-agents/src/security/input-sanitizer.ts
index 0000001..0000002 100644
--- a/packages/nexus-agents/src/security/input-sanitizer.ts
+++ b/packages/nexus-agents/src/security/input-sanitizer.ts
@@ -94,6 +94,11 @@ const INJECTION_PATTERNS: readonly PatternMatch[] = [
     flag: 'fake_conversation',
     pattern: /<(?:assistant|human|user|system)>/i,
   },
+  {
+    flag: 'base64_encoded',
+    // Lookahead requires at least one base64-discriminating char to skip pure-hex.
+    pattern: /(?=[A-Za-z0-9+/]*[g-zG-Z+/=])[A-Za-z0-9+/]{40,}={0,2}/,
+  },
 ];`,
    label: 'should-flag',
    expectedFindings: [
      {
        severity: 'error',
        pathPattern: 'input-sanitizer.ts',
        mustMatch: ['redos', 'backtracking'],
      },
    ],
    notes:
      'v1: ReDoS via catastrophic backtracking — overlapping character classes in lookahead + quantifier (CWE-1333); pattern lifted from the real #2191/#2216 history.',
  },
  {
    id: 'synthetic-off-by-one',
    title: 'feat(pagination): clamp page size to maxItems (synthetic test case)',
    diff: `diff --git a/packages/nexus-agents/src/api/pagination.ts b/packages/nexus-agents/src/api/pagination.ts
index 0000001..0000002 100644
--- a/packages/nexus-agents/src/api/pagination.ts
+++ b/packages/nexus-agents/src/api/pagination.ts
@@ -10,6 +10,12 @@ export interface PaginatedResult<T> {
   readonly items: readonly T[];
   readonly nextCursor: string | undefined;
 }
+
+/** Clamp requested page size to [1, maxItems]. */
+export function clampPageSize(requested: number, maxItems: number): number {
+  if (requested < 1) return 1;
+  if (requested > maxItems) return maxItems;
+  return requested - 1;
+}`,
    label: 'should-flag',
    expectedFindings: [
      {
        severity: 'error',
        pathPattern: 'pagination.ts',
        mustMatch: ['off-by-one', 'requested - 1', 'one less'],
      },
    ],
    notes:
      'v1: off-by-one in clampPageSize — returns requested-1 in the in-range path; clampPageSize(50, 100) should be 50, returns 49.',
  },
  {
    id: 'synthetic-missing-await',
    title: 'feat(session): refresh token on each request (synthetic test case)',
    diff: `diff --git a/packages/nexus-agents/src/auth/session.ts b/packages/nexus-agents/src/auth/session.ts
index 0000001..0000002 100644
--- a/packages/nexus-agents/src/auth/session.ts
+++ b/packages/nexus-agents/src/auth/session.ts
@@ -42,5 +42,11 @@ export class Session {
     this.token = token;
   }

+  async refreshAndCall<T>(call: () => Promise<T>): Promise<T> {
+    this.refreshToken();
+    return call();
+  }
+
+  private async refreshToken(): Promise<void> {
+    this.token = await fetchFreshToken(this.userId);
+  }
 }`,
    label: 'should-flag',
    expectedFindings: [
      {
        severity: 'error',
        pathPattern: 'session.ts',
        mustMatch: ['await', 'stale token'],
      },
    ],
    notes:
      'v1: missing await on refreshToken — async fire-and-forget; call() runs with the stale token.',
  },
  {
    id: 'synthetic-null-deref',
    title:
      'feat(metrics): track average latency from optional response field (synthetic test case)',
    diff: `diff --git a/packages/nexus-agents/src/metrics/latency.ts b/packages/nexus-agents/src/metrics/latency.ts
index 0000001..0000002 100644
--- a/packages/nexus-agents/src/metrics/latency.ts
+++ b/packages/nexus-agents/src/metrics/latency.ts
@@ -8,6 +8,11 @@ export interface ApiResponse {
   readonly status: number;
   readonly timing?: { readonly latencyMs: number };
 }
+
+export function recordLatency(rolling: number[], response: ApiResponse): void {
+  rolling.push(response.timing.latencyMs);
+  if (rolling.length > 100) rolling.shift();
+}`,
    label: 'should-flag',
    expectedFindings: [
      {
        severity: 'error',
        pathPattern: 'latency.ts',
        mustMatch: ['optional', 'undefined', 'null'],
      },
    ],
    notes:
      'v1: null deref on optional response.timing — schema marks timing optional but the code dereferences .latencyMs unconditionally.',
  },
  {
    id: 'synthetic-listener-leak',
    title: 'feat(workers): attach progress listener for streaming jobs (synthetic test case)',
    diff: `diff --git a/packages/nexus-agents/src/workers/progress.ts b/packages/nexus-agents/src/workers/progress.ts
index 0000001..0000002 100644
--- a/packages/nexus-agents/src/workers/progress.ts
+++ b/packages/nexus-agents/src/workers/progress.ts
@@ -3,6 +3,15 @@ import { EventEmitter } from 'node:events';
 export async function runWithProgress<T>(
   worker: EventEmitter,
   task: () => Promise<T>,
   onProgress: (pct: number) => void
 ): Promise<T> {
+  worker.on('progress', onProgress);
+  try {
+    return await task();
+  } catch (err) {
+    throw err;
+  }
+}`,
    label: 'should-flag',
    expectedFindings: [
      {
        severity: 'error',
        pathPattern: 'progress.ts',
        mustMatch: ['listener', 'leak'],
      },
    ],
    notes:
      "v1: listener leak — worker.on('progress', …) is never removed; long-lived workers accumulate listeners across calls.",
  },
  {
    id: '2228',
    title: 'feat(consensus): add scope_steward role for build-vs-buy gating (#2185)',
    diff: `diff --git a/packages/nexus-agents/src/cli/vote-types.ts b/packages/nexus-agents/src/cli/vote-types.ts
index cf63eac..b1e8e59 100644
--- a/packages/nexus-agents/src/cli/vote-types.ts
+++ b/packages/nexus-agents/src/cli/vote-types.ts
@@ -29,5 +29,13 @@ export interface VoteCommandOptions {
 /**
  * Voter agent role definitions.
  */
-export type VoterRole = 'architect' | 'security' | 'devex' | 'ai_ml' | 'pm' | 'catfish';
+export type VoterRole =
+  | 'architect'
+  | 'security'
+  | 'devex'
+  | 'ai_ml'
+  | 'pm'
+  | 'catfish'
+  | 'scope_steward';

 /**
  * Maps threshold names to consensus algorithms.
@@ -50,6 +58,8 @@ export const VOTER_ROLES: Record<VoterRole, string> = {
   pm: 'Product Manager - evaluates business value, user impact, and resource allocation',
   catfish:
     'Contrarian Analyst - deliberately challenges proposals to prevent agreement bias (arXiv:2505.21503)',
+  scope_steward:
+    'Scope Steward - asks whether to build at all; checks existing tools, biases toward kill-the-feature (#2185)',
 };`,
    label: 'should-flag',
    expectedFindings: [
      {
        severity: 'error',
        mustMatch: ['record', 'exhaustive'],
      },
    ],
    notes:
      'v1 historical (CI-only bug): the first push extended the VoterRole union without updating every Record<VoterRole, …> map — ROLE_VOTE_DISTRIBUTIONS in voter-execution.ts:134 — so type check failed. Diff reconstructed to the first-push state (the merged PR squashed in the fixup); the defect is the union/record exhaustiveness break, with no stable path for the missing entry.',
  },
  {
    id: '2235',
    title: 'fix(research): repair github + semantic_scholar discovery (#2234)',
    diff: `diff --git a/packages/nexus-agents/src/cli/research-helpers-sources.ts b/packages/nexus-agents/src/cli/research-helpers-sources.ts
index 814557e..eac81b1 100644
--- a/packages/nexus-agents/src/cli/research-helpers-sources.ts
+++ b/packages/nexus-agents/src/cli/research-helpers-sources.ts
@@ -99,9 +99,17 @@ export async function fetchSource(
     if (headers !== undefined) fetchInit.headers = headers;
     const response = await fetch(url, fetchInit);
     if (!response.ok) {
+      // Surface rate-limiting separately so callers can distinguish "your key
+      // is missing / quota exhausted" from "the API is broken" (#2234). The
+      // generic HTTP_ERROR message previously masked semantic_scholar's
+      // unauthenticated 429s as opaque failures.
+      const isRateLimit = response.status === 429;
+      const message = isRateLimit
+        ? \`\${source} rate-limited (HTTP 429) — set \${source.toUpperCase()}_API_KEY or retry later\`
+        : \`API returned \${String(response.status)}\`;
       return {
         ok: false,
-        error: createError('HTTP_ERROR', source, \`API returned \${String(response.status)}\`),
+        error: createError(isRateLimit ? 'RATE_LIMIT' : 'HTTP_ERROR', source, message),
       };
     }
     return { ok: true, value: response };`,
    label: 'should-flag',
    expectedFindings: [
      {
        severity: 'error',
        pathPattern: 'research-helpers-sources.ts',
        mustMatch: ['github_token', 'env var', 'api_key'],
      },
    ],
    notes:
      'v1 historical, the labeling lesson: originally labeled clean; the v5 run caught a real shipped bug — for source github the 429 hint names GITHUB_API_KEY, but GitHub uses GITHUB_TOKEN. Reclassified because the finding was correct and the dataset was wrong. Hunk extracted from the real commit (8893ad8a3c).',
  },
  {
    id: '2238',
    title: 'feat(2233 child 3): enforce verification gate in pr_review findings',
    diff: `diff --git a/packages/nexus-agents/src/mcp/tools/pr-review-findings.ts b/packages/nexus-agents/src/mcp/tools/pr-review-findings.ts
new file mode 100644
index 0000000..e5f7c7f
--- /dev/null
+++ b/packages/nexus-agents/src/mcp/tools/pr-review-findings.ts
@@ -0,0 +1,26 @@
+/** PR Review Findings — typed verification gate per #2225 + #2233 Child 3. */
+
+/** The 4-point verification gate (#2225). */
+export interface VerificationGate {
+  /** Re-read cited line + 5 lines before/after. */
+  readonly reread_cited_line: 'passed' | 'failed' | 'skipped';
+  /** Traced from a real entry point. */
+  readonly traced_call_path: 'passed' | 'failed' | 'skipped';
+  /** Concrete failing assertion named. String, not boolean —
+   * empty/short = failed. */
+  readonly named_assertion: string;
+  /** Ruled out language non-issues. */
+  readonly ruled_out_language_non_issue: 'passed' | 'failed' | 'skipped';
+}
+
+/** Returns true if all 4 checks passed AND the named assertion is
+ * substantive (length > 10 chars, not a rubber-stamp word). */
+export function isFindingVerified(gate: VerificationGate): boolean {
+  if (gate.reread_cited_line !== 'passed') return false;
+  if (gate.traced_call_path !== 'passed') return false;
+  if (gate.ruled_out_language_non_issue !== 'passed') return false;
+  // Substantive named assertion required — guards against rubber-stamping.
+  if (gate.named_assertion.trim().length < 10) return false;
+  if (/^(passed|ok|yes|done|verified)$/i.test(gate.named_assertion.trim())) return false;
+  return true;
+}`,
    label: 'clean',
    expectedFindings: [],
    notes:
      'v1 historical clean case: 49/49 tests passed on first push. Embedded diff is the defect-free core excerpt (VerificationGate + isFindingVerified) of the real new file from commit a292ebaab1; v1 fetched the full PR diff live.',
  },
  {
    id: 'synthetic-clean-refactor',
    title: 'refactor(util): extract date-formatter helper (synthetic clean case)',
    diff: `diff --git a/packages/nexus-agents/src/util/date-format.ts b/packages/nexus-agents/src/util/date-format.ts
index 0000001..0000002 100644
--- a/packages/nexus-agents/src/util/date-format.ts
+++ b/packages/nexus-agents/src/util/date-format.ts
@@ -0,0 +1,8 @@
+/** Formats a Date as ISO date (YYYY-MM-DD) in ET timezone. */
+export function formatIsoDate(d: Date): string {
+  return d.toLocaleDateString('en-CA', {
+    timeZone: 'America/New_York',
+    year: 'numeric',
+    month: '2-digit',
+    day: '2-digit',
+  });
+}`,
    label: 'clean',
    expectedFindings: [],
    notes:
      'v1 synthetic clean refactor — deliberately innocuous; tests false-positive risk. The v5 run surfaced borderline judgment calls here (unused-helper YAGNI, locale-API pedantry): real concerns, not defects — the rubric scores them as borderline (info), excluded from precision.',
  },
  {
    id: 'synthetic-clean-docs',
    title: 'docs(api): clarify error codes returned by retry helper (synthetic clean case)',
    diff: `diff --git a/packages/nexus-agents/src/adapters/retry.ts b/packages/nexus-agents/src/adapters/retry.ts
index 0000001..0000002 100644
--- a/packages/nexus-agents/src/adapters/retry.ts
+++ b/packages/nexus-agents/src/adapters/retry.ts
@@ -25,6 +25,11 @@ export interface RetryConfig {
   readonly maxDelayMs: number;
   readonly jitterFactor: number;
 }
+
+/**
+ * Error codes that withRetry may surface in the Result<T, E> error path:
+ * - RETRY_EXHAUSTED — all attempts failed; original error wrapped
+ * - INVALID_CONFIG — config validation failed before any attempt
+ */`,
    label: 'clean',
    expectedFindings: [],
    notes:
      'v1 synthetic clean docs-only change: JSDoc above an existing interface, no code change. Tests false-positive risk; the v5 run correctly approved with zero findings.',
  },
];

/** The ported eval set — exactly the 10 v1 cases (CLM-0048), zod-validated at load. */
export const REVIEW_EVAL_SET: readonly ReviewEvalCase[] = z
  .array(ReviewEvalCaseSchema)
  .length(10)
  .parse(CASES);
