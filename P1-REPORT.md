# P1 Report — Kernel, Faculties, and the First Governed Task

**Phase:** P1 (kernel registry/router/ladder/bus + adapters + compiler + memory + quality gate + nine kernel tools)
**Exit criterion (spec §11):** one repo, one real task end-to-end through the quality gate — **met**.
**Tag:** `v0.2.0-p1`. Built on `phase/p1`; this PR to main is the ratification (the human merge, per the phase protocol).

## Exit evidence

Live run against the kernloop repository itself (the "one repo"):

```
kernloop init   → .kernloop/{overlay.yaml,.gitignore} created; doctor: 4/4 checks ok
kernloop run --goal "kernloop passes its own quality gate" \
             --capability gate.quality --workspace <repo>
  → Verdict pass (confidence 1, 0 findings, wallClockMs 7404)
  → Outcome success, traceRef into the audit chain
kernloop audit --op verify        → { ok: true, length: 17 }
kernloop status --task-id <id>    → trace summary from SQLite (separate process
                                    invocation — cross-session persistence)
kernloop observe                  → event counts, routing/verdict/outcome
                                    tallies, adapter availability — all derived
                                    from the real chain and memory
```

The same path is locked in CI by the E2E test (CLM-0036): real routing → real
gate subprocess (actual `tsc` on a fixture workspace) → pass and fail cases →
audited, verified chain. Note: the live run's three gate checks completed in
7.4s because turbo's cache was warm; the E2E test runs an uncached compiler.

## Ratification items in this PR (per protocol step 4, batched)

1. **`planned` claim status** — claims-semantics change, pre-ratified 7-0 by
   the nexus-agents consensus panel (supermajority strategy) before
   implementation; this merge confirms it. Panel conditions honored: existing
   citations audited (all were `verified`); the catfish's stronger condition —
   that planned claims should be required to cite their acceptance test as
   present-but-not-passing evidence — was NOT adopted because a
   present-and-failing test would turn the `test` CI job red, violating
   "every commit leaves CI green"; recorded here for reconsideration.
2. **Initial tier assignments** (not promotions): compiler `observe` (pure
   assembly), memory `suggest` (entry default), quality gate `advisory`
   (mechanical verdicts, non-blocking until an enforcing path exists). No
   component holds `enforce`. Seeding used ordinary `setTier` transitions
   below the enforce threshold; nothing was fabricated as human-ratified.

## Claims (36 total, all verified, zero backlog)

P0 claims CLM-0001..0013 unchanged. P1 claims, populated as `planned` backlog
first and promoted with evidence in the same diffs as their implementations:

| Range          | Component                          | Claims                                                                                                                                                         |
| -------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLM-0014..0018 | EventBus, ManifestRegistry, Ladder | contract-only bus w/ boundary validation; backpressure not silent drop; registry as capability truth; tier blocking; audited transitions w/ automatic demotion |
| CLM-0019..0021 | Adapters                           | subprocess capture + timeout kill; honest per-call metering; unavailable ≠ stubbed                                                                             |
| CLM-0022..0025 | faculty-memory                     | provenance-mandatory writes; decay-clock ranking; Outcome summaries by task id; repo-local SQLite, functional when deleted                                     |
| CLM-0026..0028 | Router                             | capability+budget matching w/ plan-only mode; ceiling never exceeded (100-seed sweep); exploration floor for demoted manifests                                 |
| CLM-0029..0030 | faculty-compiler                   | byte-identical deterministic Briefs; hard budgets, priority drop, full provenance                                                                              |
| CLM-0031..0032 | faculty-gates + wiring             | structured severity-tagged Verdicts; every verdict audited                                                                                                     |
| CLM-0033..0036 | cli                                | exactly nine MCP tools; run routes + audits + returns Outcome; audit query/verify; E2E through the quality gate                                                |

## LOC vs budgets · coverage · tests

| Package               | LOC   | Budget         | Coverage (lines/branches) | Tests |
| --------------------- | ----- | -------------- | ------------------------- | ----- |
| contracts             | 474   | 800            | 100 / 100                 | 69    |
| kernel                | 2,150 | 5,000          | ~98 / ~91                 | 185   |
| faculty-compiler      | 425   | 4,000          | 100 / 100                 | 22    |
| faculty-memory        | 435   | 4,000          | 100 / 87.9                | 27    |
| faculty-gates         | 368   | 4,000          | 100 / 88.9                | 32    |
| cli                   | 1,695 | (none in spec) | 97.4 / 80.3               | 69    |
| claims + gate scripts | —     | —              | ≥98 / ≥87                 | 82    |

**486 tests total.** All thresholds ≥80% enforced per-package. Note: cli
branch coverage sits at 80.26% — tight against the gate; flagged for P2 work
touching that package.

## Porting deltas from v1 (this phase)

- **Adapters (quarry item 2):** kept v1's recorded per-CLI output formats and
  defensive parsing; replaced SIGTERM+5s escalation with immediate
  process-group SIGKILL (fixes v1 grandchild leak); fixed a v1 latent bug
  where one oversized chunk escaped the capture cap; ollama redefined from
  HTTP SDK to `ollama run` subprocess, experimental, requires explicit model.
  Dropped as policy/intelligence: retries, error-classification heuristics,
  fallbacks, model-alias maps, prompt assembly. (PORT-NOTES.md in module.)
- **Quality gate (quarry item 5):** v1's bespoke result shape became a
  contracts Verdict with per-diagnostic findings (tsc/eslint/vitest parsers
  with path extraction — v1 had a 500-char unparsed cap); v1's pipeline
  iteration loop not ported (P2 workflow scope); model-calling QA gates not
  ported (forbidden in mechanical gates).

## Spec ambiguities encountered → resolutions

1. **How a task names its capability** — TaskContract has no capability field
   and deriving it from goal text would put intelligence in the kernel
   (rule 4). `run` takes an explicit `--capability`; revisit when the PM
   decomposes plans in P2.
2. **Memory-write capabilities under `run`** — a TaskContract carries no fact
   payload, so `memory.semantic.write` has no run-executor; `run` reports it
   as typed `unwired` naming the real entry point (`remember`). Narrowest
   honest reading of wiring-complete-or-absent.
3. **Two ceiling readings** — the ladder checks requiredTier ≤ ceiling; the
   router additionally enforces manifest.tier ≤ ceiling (what CLM-0027
   states). Both checked, reported separately.
4. **Exploration vs safety** — the exploration floor samples among
   capability-matching, ceiling-allowed candidates only; it may pick
   over-budget or actor-tier-failing ones (recorded honestly in the
   decision), never one above the ceiling.
5. **Bus audit payloads** — chain carries identity fields only (ids, names),
   never message bodies: the chain is governance, memory owns state. Tested
   (goal text provably never reaches the chain).
6. **Ladder demotion floor** — breach at `observe` is audited but cannot
   demote further; the starvation guard is the router's exploration floor.
7. **Ladder reports only the first denial reason** (short-circuit) —
   discovered by the router subagent, recorded, deliberately unchanged.

## Process notes

- Fan-out: 7 subagents this phase (planned-status, D bus/registry/ladder,
  E adapters, F memory, G router, H compiler, I quality gate, J cli) in
  isolated worktrees with disjoint file ownership; serial integration with the
  full gate suite after each; zero ownership collisions.
- The `planned`-status backlog flow worked as designed: 23 claims entered as
  backlog, every one left it in the same diff as its implementation.

## P2 starting line

- **Vote gate:** faculty-gates has the Verdict plumbing and manifest pattern;
  voter templates + strategies port from v1 (quarry item 3). Voters need
  adapters — `invokeAdapter` is ready and metered.
- **Workforce:** templates-as-manifests slot into the existing registry;
  PM decomposition needs child-budget slicing — TaskContract.parent exists.
- **Canonical loop:** packages/workflows (graph as data) + checkpoint/resume
  (quarry item 6); per-node checkpoints can reuse the episodic store.
- **Overlay:** .kernloop/ scaffold + doctor exist; overlay.yaml needs gate
  thresholds, K, and node overrides (spec §7), currently budgets only.
- **Known debts:** cli branch coverage near threshold; capability naming
  convention (ambiguity 1); `observe` fitness ledger is event tallies, not
  yet per-voter precision series (P2 vote gate prerequisite).
