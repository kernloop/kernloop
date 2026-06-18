# Review gate — v1 port notes (quarry item 4, spec §10)

Source quarried (read-only): `nexus-substrate/nexus-agents`
`testing/datasets/pr-review-sample.json` (the labeled eval set),
`docs/research/pr-review-experiment-results.md` + `-v5.md` (the labeling
lessons), `mcp/tools/pr-review-tool.ts` (roles, aggregation),
`mcp/tools/pr-review-findings.ts` (verification gate),
`cli/voter-prompts.ts` (PR-review-mode addendum, #2244),
`scripts/pr-review-score.ts` (matching rule, recovered from git history —
deleted at v1 HEAD), and Epic-E issues #3845/#3846/#3849 (promotion
criterion). Reimplemented against kernloop contracts; no v1 code imported.

## What the v1 quarry actually contained

- **Eval set: exactly n=10** (`pr-review-sample.json`, curated 2026-04-27,
  "hybrid v3"): 5 synthetic diff-readable bugs with embedded `customDiff`
  (ReDoS, off-by-one, missing-await, null-deref, listener-leak), 3
  historical PRs fetched live from GitHub (#2228 buggy/CI-only, #2235
  buggy after reclassification, #2238 clean), 2 synthetic clean
  counterparts. Net labels: 7 buggy, 3 clean.
- **Labeling lessons (v5)**: the 50% headline FP rate was mostly dataset
  error (#2235 mislabeled clean) + borderline judgment calls; rubric
  requirements were spelled out in Epic-E child #3846. Captured in
  RUBRIC.md.
- **Review roles**: 5 of the 7 voter roles — architect, security, devex,
  catfish, scope_steward (PM and AI/ML excluded as proposal-level). All 5
  always convened.
- **Adversarial machinery**: the 4-point verification gate (#2225:
  re-read cited line, trace call path, name a concrete failing assertion,
  rule out language non-issues; substantive-assertion length check) and
  the PR-review-mode prompt addendum (#2244), both born from a measured
  100% false-positive rate without them.
- **Epic-E promotion criterion (#3845/#3849)**: only the SHAPE was
  defined — "sustained precision ≥ X over a sliding window of N live
  advisory reviews + eval ≥ Y". The numbers were never ratified in v1
  (#3849, the criterion ADR, was still an open child). Sourced numbers
  nearby: #2233's operational bound FP < 20% (= precision ≥ 0.8) and
  Epic-E's n ≥ 50 eval-set floor.
- **v1 aggregation** (for the record, not ported): 4 tiers — verified
  blocker → request_changes; soft block on ≥3/5 dissent; unanimous
  approve; else abstain. v1 severities: critical/high/medium/low.

## Ported

- **Eval set as data (`eval-set.ts`)**: all 10 cases, ids and labels
  preserved (v1 numeric PR ids stringified). The 7 `customDiff` payloads
  verbatim. v1 `knownBugs` reshaped into `expectedFindings`
  ({severity, pathPattern?, mustMatch}) against the kernloop Finding
  contract; v1 `notes` condensed with provenance kept.
- **Rubric as documentation (`RUBRIC.md`)**: v5 lessons + #3846
  requirements — diff-readable-defect definition, severity floor,
  location tolerance, clean criteria, explicit borderline class, the
  #2235 mislabel-adjudication lesson.
- **Reviewer templates (`reviewers.ts`)**: the 5 v1 code-level roles with
  the verification-gate discipline folded into every prompt as the
  adversarial footer (v1 enforced it as a typed structure at the model
  boundary; kernloop's model boundary is the injected `invokeReviewer`).
  Renames, by lens: architect → `correctness`, devex → `maintainability`,
  catfish → `contrarian` (as in the vote gate), scope_steward →
  `scope-steward`.
- **Matching rule (`calibrate.ts`)**: from `pr-review-score.ts`, reshaped
  (see deltas).
- **Promotion criterion (`PROMOTION_CRITERION`)**: shape from Epic-E,
  encoded as the contract `EvidenceThreshold` and carried in the
  manifest's `promotion` field — {metric: precision, threshold: 0.8,
  windowN: 50}. The exact numbers await kernloop ratification (a named
  P3-exit ratification point: "adopt the criterion only"); 0.8 sources
  from #2233's FP < 20%, 50 from Epic-E's n ≥ 50.

## Deltas (kernloop ≠ v1)

- **Historical diffs embedded, not fetched.** v1 fetched #2228/#2235/#2238
  live from GitHub at run time. Kernloop embeds the defect-relevant hunks
  extracted from the real commits: #2235 from `8893ad8a3c` (the buggy
  hunk, verbatim); #2228 reconstructed to its first-push state from
  `35c2d213b7` — the merged PR squashed in the fixup that added the
  missing `ROLE_VOTE_DISTRIBUTIONS` entry, so the buggy state (union
  extended, Record maps not) is rebuilt from the squashed diff minus the
  fixup hunk, per the commit message's own record; #2238 is the
  defect-free core excerpt of the real new file from `a292ebaab1`
  (embedding its full 491-line diff would blow the file budget). Trimming
  is a fidelity loss on #2238 only (less surface for false positives).
- **Default panel 3, not 5.** v1 always convened all 5 roles; kernloop
  defaults to correctness + security + maintainability (the vote gate's
  default-3 pattern, spec §5.3) and exports `REVIEW_PANEL_FULL` (the five v1
  roles + the kernloop groundedness lens, #226 item 3 — six total).
- **Severity mapping**: v1 critical/high/medium/low → kernloop
  blocker/error/warn/info (the contract Finding enum).
- **Location tolerance**: v1 matched file basename + line ±5; kernloop
  Findings carry no line number, so matching = path-substring +
  defect-naming keywords (`mustMatch`). The keyword leg is new — it
  replaces the lost line precision.
- **Aggregation is two-tier, not four.** Spec §5.3's review gate emits an
  honest reject on any surviving error/blocker finding, else approve
  (abstain only when every reviewer failed). v1's soft-block (≥3/5
  dissent) and verified/unverified flag stay in the quarry — the
  verification discipline lives in the prompts, and the advisory TIER
  (not a softened verdict) is what makes the gate non-blocking.
- **Reviewer failure → recorded `abstain`** with `reviewer_error: …`
  reasoning (the vote gate's pattern; v1 had an error-vote path).
- **No fetch/truncation/format machinery.** v1's GitHub fetching,
  50k-char diff truncation, JSON findings format and YAML fallback parser
  belong to the composition root / injected `invokeReviewer`.

## Stayed in the quarry

The batch harness and scorer scripts; the GitHub Actions live-PR rollout
(Child 6, #2256); soft-block aggregation and the verified/unverified flag;
the YAML-findings fallback parser; v1's per-PR decision taxonomy
(approve/request_changes/abstain) — kernloop verdicts use the contract
result enum. Each returns only via a claim (spec §1).
