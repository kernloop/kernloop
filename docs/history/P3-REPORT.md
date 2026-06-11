> **Point-in-time snapshot.** This document recorded the state at its phase
> exit and is preserved for history; it is not maintained. For current
> capability see [README.md](../../README.md) — the live, claim-gated source
> of truth. Statements here (e.g. tool counts, "current phase") were true at
> the time and may since have been superseded.

# P3 Report — Born Through Gates

**Phase:** P3 (review gate + distill + forge/Toolsmith + Observer self-issue loop)
**Exit criterion (spec §11):** a distilled skill and a forged workshop tool both born through gates — **met, live.**
**Tag:** `v0.4.0-p3`. This PR to main is the ratification — and the campaign's final phase gate.

## Exit evidence (all committed in this diff)

1. **A distilled skill, born through the distill path.**
   `kernloop distill --trace task-c785a478…` ran live against kernloop's own
   P1 trace (the run where kernloop first quality-gated itself): the model
   produced `run-quality-gate-via-kernel` at `suggest` tier into
   `skills/proposed/` ($0.30 metered, audited as `cli.distill.proposed`).
   This PR moves it `proposed → live` — **your merge IS the skill's
   ratification** (the only path into the procedural library, CLM-0050).
   Provenance preserved in `skills/run-quality-gate-via-kernel/PROPOSAL.yaml`.
2. **A forged workshop tool, born through the forge gates.**
   `kernloop forge --spec-file loc-probe-spec.json` ran live: birth
   requirements validated (claim WS-0001 + acceptance test + manifest,
   CLM-0051), the model generated `tool.mjs`, its acceptance tests passed
   2/2 **inside the ratified Docker sandbox** (network none, scratch-only
   FS), and it installed at `.kernloop/workshop/loc-probe/` born at
   `suggest` (CLM-0054 lifecycle entry committed). The committed tool still
   passes its tests on the host (locked by `p3-exit-proof.test.mjs`).
3. **The sandbox profile itself was ratified by kernloop.** Per AGENTS.md,
   ratification panels moved from nexus-agents to kernloop's own vote gate
   at P2. A live 7-voter `PANEL_RATIFICATION` supermajority vote approved
   the profile **6–1** (the contrarian dissented — the panel works), $1.34,
   recorded as `governance.ratification.vote` in the committed exit audit
   chain (`evals/p3-exit/audit.jsonl`, verifies at length 117).
4. **Self-hosting (the spec §11 milestone).** The `## Ratification path
(P3)` section of `skills/README.md` in this diff was written by kernloop
   itself: a canonical-loop run on the kernloop repo (live PM plan, live
   3-voter vote, model-written edit, kernloop's full quality gate — its own
   typecheck/lint/test suite — passing), Outcome `success`, $1.77. **From
   this merge onward, kernloop work runs through kernloop.**

## Claims: 58 total, 58 verified, zero backlog — the registry is empty of promises

P3 added CLM-0047..0058. One revision: **CLM-0033** (nine tools → the kernel
eleven), marked in the YAML and ratified by this merge.

| Range          | Component   | Substance                                                                                                                                                                                                                                                  |
| -------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLM-0047..0048 | review gate | adversarial diff review at advisory; per-reviewer records; calibration against the ported n=10 eval set                                                                                                                                                    |
| CLM-0049..0050 | distill     | trace → skill proposal at suggest; ratification path is the ONLY way into the library (no runtime write API exists — export-surface tested)                                                                                                                |
| CLM-0051..0054 | toolsmith   | birth requirements; ratified sandbox (real-Docker proofs: network blocked, host FS invisible, kernel-import dies in-sandbox); workshop namespace + cap 12 + ratified retirement; ladder with auto-advisory at 5 clean runs, ratified enforce, 30-day decay |
| CLM-0055..0056 | observer    | fitness ledger + voter precision series; self-issues at suggest re-entering the ordinary loop (no privileged path, asserted)                                                                                                                               |
| CLM-0057..0058 | exit        | the born-through-gates artifacts; the kernel eleven complete                                                                                                                                                                                               |

## LOC vs budgets · tests

contracts 474/800 · kernel 2,150/5,000 · compiler 425 · memory 435 ·
gates 1,827 · workforce 456 · observer 811 · toolsmith 992 (all /4,000) ·
workflows 1,000/4,000. **912 tests**, coverage ≥80% all metrics per package.

## Porting deltas from v1 (this phase)

- **Review eval set (quarry item 4):** exactly n=10 ported
  (5 synthetic-buggy, 3 historical PRs with real hunks from quarry git
  history, 2 clean); the v5 labeling lessons became `RUBRIC.md`; v1's
  file+line±5 matching became pathPattern+keyword (kernloop Findings carry
  no line numbers); `info` findings excluded from precision (the borderline
  class, made measurable).
- **Epic-E promotion criterion:** v1 never ratified the numbers (ADR #3849
  open). Encoded precision ≥0.8 over window 50 from the closest sourced v1
  bounds, in the review manifest's `promotion` field, **explicitly awaiting
  kernloop ratification** — adopting the criterion shape is part of this
  merge; the advisory→enforce promotion itself still needs sustained
  evidence later.

## Ratification items in this merge (batched, protocol step 4)

1. The **skill going live** (`skills/proposed/ → skills/`) — item 1 above.
2. The **CLM-0033 revision** (nine → eleven).
3. **Review-gate promotion criterion** (precision ≥0.8, n=50) — criterion
   only, not a promotion.
4. **Sandbox profile + workshop defaults** — pre-ratified 6–1 by kernloop's
   own panel; your merge confirms (decay 30 days, cap 12).

## Spec ambiguities encountered → resolutions

1. **"Epic-E" had no ratified numbers in v1** — closest sourced values
   encoded, clearly marked pending (above).
2. **Skill ratification artifact** — strictest reading adopted: no runtime
   write API into `skills/` exists anywhere; the human-reviewed move is the
   only path (design-notes open question 3).
3. **Workshop tools can't import kernel/faculty internals** — enforced
   physically (sandbox has no node_modules and no network; a generated tool
   importing `@kernloop/kernel` provably dies in-sandbox) rather than by
   lint, since tools live under overlays, outside the repo's lint reach.
4. **Observer ground truth** — voter precision computed only over supplied
   labels; unlabeled voters report `undefined`, never a fabricated number.
5. **One subagent ownership stretch, disclosed:** the kernel-eleven subagent
   renamed two test titles and updated the dangling evidence refs in
   CLM-0032/0049 (protected path, outside its grant) to keep the gate green;
   statements untouched; reviewed at integration.

## Campaign close

P0 (2026-06-09) → P3 exit (2026-06-10): four phases, two days, well inside
the 4–6-week kill criterion. 58 claims, all verified; `claims:check` has
been green on every main commit and every phase tip. Total live-model spend
across all governance votes and exit runs: ≈ $11. The registry contains no
aspirations — every statement in the README resolves to a passing test or a
committed artifact, which was the entire thesis.
