> **Point-in-time snapshot.** This document recorded the state at its phase
> exit and is preserved for history; it is not maintained. For current
> capability see [README.md](../../README.md) — the live, claim-gated source
> of truth. Statements here (e.g. tool counts, "current phase") were true at
> the time and may since have been superseded.

# P2 Report — The Canonical Loop, Live

**Phase:** P2 (vote gate + workforce + canonical loop + overlay)
**Exit criterion (spec §11):** full loop on a real feature in a real repo, checkpoint/resume proven — **met, with a live model-driven run.**
**Tag:** `v0.3.0-p2`. Built on `phase/p2`; this PR to main is the ratification.

## Exit evidence

**Live run** (committed as `evals/p2-live-run/`, referenced as evidence on
CLM-0046): a real git repository (small TypeScript package), the `claude` CLI
as adapter, goal "add a subtract(a, b) function with a test":

- frame → research → plan (PM template, live model) → **vote: live 3-voter
  panel, approved** → decompose (PM, 2 children, budget-sum enforced) →
  2 × (implement: model-written code → quality: real tsc + real tests, both
  pass) → integrate → retrospect (Outcome to memory, trace flagged as a
  distill candidate)
- Outcome `success`; cost metered 36,875 tokens / **$1.76**; audit chain
  verifies (`{ok: true, length: 66}` over the committed log); per-node
  checkpoint stream committed alongside.

**Checkpoint/resume** is proven twice: engine-level kill-mid-run/resume tests
with zero re-execution (CLM-0044, executor call-count assertions), and a
composition-root E2E where K-exhausted escalation halts the run and
`kernloop run --resume <runId>` completes it (CLM-0046 evidence).

**Honest-failure history, deliberately preserved:** the committed live audit
log contains two earlier failed runs. Run 1 failed when coder output violated
the files contract (JSON extraction desynchronized on prose braces; and the
PM created a verification child whose coder honestly reported "no files
needed"). Run 2 failed on a defect in MY fixture (a broken `node --test
test/` script), which the quality gate correctly caught — the gate did its
job; the workspace was at fault. Both drove hardening commits (string-aware
fence-tolerant JSON extraction; violation evidence persisted to
`checkpoints/<runId>-<node>-violation.txt`; decompose prompt forbids
verification children since the quality gate already runs per child). No
retries were added: a contract violation remains a failed run.

## Claims (46 total, all verified, zero backlog)

| Range          | Component           | Substance                                                                                                                                                                             |
| -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLM-0037..0039 | vote gate           | panel aggregation (3 strategies; 3/7 panels); VoterRecords for precision tracking; one shared Brief per panel (object-identity tested)                                                |
| CLM-0040..0041 | workforce           | five templates as configuration entering at `suggest`; PM decomposition with the per-dimension budget-sum invariant                                                                   |
| CLM-0042..0045 | workflows + overlay | graph as data, every edge contract-validated; K-bounded vote-iterate with honest `escalated` status; per-node checkpoint/resume; overlay overrides behavior without graph duplication |
| CLM-0046       | composition root    | the live run above + 4 E2E test refs                                                                                                                                                  |

## LOC vs budgets · tests

| Package           | LOC    | Budget                       | Tests |
| ----------------- | ------ | ---------------------------- | ----- |
| contracts         | 474    | 800                          | 69    |
| kernel            | 2,150  | 5,000                        | 185   |
| faculty-compiler  | 425    | 4,000                        | 22    |
| faculty-memory    | 435    | 4,000                        | 27    |
| faculty-gates     | 882    | 4,000                        | 67    |
| faculty-workforce | 456    | 4,000                        | 29    |
| workflows         | 1,000  | 4,000                        | 40    |
| cli               | ~2,600 | (held to file/function caps) | 140   |

**661 tests total**, coverage ≥80% all metrics per package (cli branches
87.7%). A `workflows` LOC budget (4,000, the faculty ceiling) was added to
loc-check — spec §2 named no budget for it and an unbounded package would be
a gap.

## Porting deltas from v1 (this phase)

- **Consensus voters (quarry item 3):** all 7 role prompts ported as data
  (catfish→contrarian, scope_steward→scope-steward); 3-panel composition uses
  v1's post-incident quickMode trio (architect/security/scope-steward).
  Strategies in use: simple_majority, supermajority, unanimous (spec §12.3
  proposal); v1's exact-rational ≥2/3 replaces a float comparison that made
  2-of-3 fail supermajority. Bayesian/higher-order strategies stay quarried.
- **Checkpoint/resume (quarry item 6):** per-node (not per-super-step)
  checkpoints; checkpoint-write failure now fails the run (v1 continued
  silently); zero-trust resume (zod-parsed state). HITL interrupt machinery
  replaced by the K-escalation halt + `--resume`.

## Ratification items batched in this PR (protocol step 4)

1. **Vote gate tier: `advisory`** (initial assignment, not a promotion).
2. **Spec §12.2/§12.3 open items resolved:** K default = 3;
   strategies-in-use = simple_majority/supermajority/unanimous.
3. **PM authority:** spec §5.4's "PM may compose bespoke specialists at
   `enforce`" is DEFERRED to P3 evidence — the P2 PM runs at `suggest`.

## Spec ambiguities encountered → resolutions

1. **Edge contracts for plan/implement nodes** — plan emits Brief
   (plan-as-reproducible-artifact), implement emits Outcome; rejected-edge
   Verdicts travel back to plan via context findings.
2. **K counting** — K rejected re-entries into plan (K+1 vote attempts);
   resume-from-escalated resets the iteration budget (else resume would
   instantly re-escalate).
3. **Specialist overlay children carry zero budget** — overlay additions
   cannot break the PM's decomposed budget-sum invariant.
4. **Fan-out is sequential** in children order: deterministic traces and an
   unambiguous checkpoint cursor; concurrency is a later claim if wanted.
5. **`gate` tool not extended to vote** — vote runs inside the loop; the MCP
   surface stays exactly nine tools (CLM-0033 re-verified).
6. **Live-run finding worth keeping:** model output contracts need
   string-aware, fence-tolerant extraction and explicit "the quality gate
   already verifies" framing in decompose prompts — otherwise PMs invent
   verification children and coders honestly emit empty file lists.

## P3 starting line

- **Review gate (advisory):** Verdict plumbing, VoterRecords, and the
  per-voter precision data path exist; the v1 n=10 eval set + labeling rubric
  (quarry item 4) seed it.
- **Distill:** retrospect already flags distill candidates; episodic traces
  - checkpoint streams are the raw material; `distill` tool slot is reserved
    in the kernel eleven.
- **Toolsmith/forge:** the manifest+claims birth requirements have precedent;
  needs the Docker sandbox profile (a named human-ratification point).
- **Observer self-issue loop:** `observe` aggregates are in place; the
  fitness ledger needs per-voter precision series (VoterRecords land in
  Verdicts already).
- **Self-hosting milestone:** from P3 exit, kernloop work runs through
  kernloop itself.
