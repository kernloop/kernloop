# Review eval-set labeling rubric

Ported as documentation from nexus-agents v1 (quarry item 4, spec §10):
the v5 labeling lessons (`docs/research/pr-review-experiment-results-v5.md`,
2026-04-26) and the rubric requirements of Epic-E child #3846 ("labeling
rubric + v5 dataset corrections"). This is the rubric the ported n=10 eval
set (`eval-set.ts`) is labeled under, and the rubric any future case must
satisfy before entering the set.

## What counts as a bug (`should-flag`)

A **diff-readable correctness defect**: an honest reviewer reading only the
diff (plus general language/library knowledge) can verify it and name the
concrete failing assertion — what test would fail, and how. The v1 seed
dataset's first iteration failed precisely here: its "buggy" PRs were
CI-detectable failures (type errors, lint, prose drift) that a diff-only
reviewer cannot see; the v2/v3 hybrid replaced them with logic bugs visible
in the diff (null deref, off-by-one, missing await, listener leak, ReDoS).
A bug label requires a nameable defect, not a vibe.

## Severity floor

A `should-flag` expectation carries severity ≥ `error`: the defect, if
real, justifies blocking the merge (v1: only **verified** findings could
drive `request_changes`). Kernloop severity mapping from v1's
critical/high/medium/low: `blocker`/`error`/`warn`/`info`.

## Location tolerance

v1 matched findings to known bugs by file basename + line within ±5
(`scripts/pr-review-score.ts`). Kernloop Findings carry `path` but no line
number, so location tolerance becomes: the expected `pathPattern` (when
set) must be a substring of the finding's `path`, and `mustMatch` keywords
must name the defect in the message. When a defect has no stable path (the
#2228 exhaustiveness break manifests in a file the diff does not touch),
`pathPattern` is omitted and keywords carry the match alone.

## Clean criteria (`clean`)

A `clean` label asserts the diff contains **no defect meeting the severity
floor** — not that no reviewer will ever comment. Clean cases exist to
measure false positives; every `warn`+ finding on a clean case scores as a
false positive.

## The borderline class

The v5 run's headline 50% "false-positive rate" dissolved under triage
into (a) a dataset mislabel and (b) borderline judgment calls (an unused
helper YAGNI flag, locale-API pedantry on `toLocaleDateString('en-CA')`) —
"debatable but not hallucinated". Per Epic-E child #3846, the rubric must
make FP measurable, not arguable, so the borderline class is explicit:
**`info`-severity findings are commentary, excluded from precision scoring
entirely.** A reviewer who wants to raise a judgment call without staking
precision on it files it as `info`; anything `warn`+ is a defect claim and
is scored.

## Mislabel adjudication (the #2235 lesson)

When the panel flags something on a `clean` case, **adjudicate the dataset
before blaming the panel**. v1's #2235 was labeled clean; the v5 devex
voter found a real shipped bug in it (a 429 hint naming `GITHUB_API_KEY`
where GitHub uses `GITHUB_TOKEN`) that no human had caught. The case was
reclassified to buggy with rationale recorded — the finding was correct,
the dataset was wrong. Relabels must be logged in the case's `notes`.

## Matching rule (scored by `calibrate.ts`)

A finding matches an expected finding iff:

1. `severity(finding) ≥ severity(expected)` — the severity floor;
2. `expected.pathPattern`, when present, is a substring of `finding.path`
   (a finding with no path cannot match a path-bearing expectation);
3. `finding.message` contains ≥1 `mustMatch` keyword, case-insensitively.

Precision = matched scored findings / all scored findings (vacuously 1 on
zero scored findings — silence makes no false claims; recall catches it).
Recall = expected findings matched / expected findings total.
