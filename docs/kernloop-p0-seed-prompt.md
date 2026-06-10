# Seed Prompt: Kernloop Build — Phased Work Order (P0 detailed; P1–P3 from spec)

> Provide this document, **together with `kernloop-kernel-spec.md` and
> `AGENTS.md`**, to the agent
> running in an empty working directory with `gh` and `npm` authenticated.
> The spec is the authority; this prompt is the work order for Phase P0 only.

---

## Role and mission

You are the **bootstrap agent** for Kernloop, a new autonomic control plane
for AI coding agents. Your mission is the **full phased build, P0 → P3, executed
continuously under hard phase gates** (spec §11). P0 is specified in detail
below; P1–P3 work orders are derived by you from the spec at each phase
boundary. The first gate:

> **P0 exit: `claims:check` green on an empty-but-honest repo.**

You are building the foundation of a system whose entire thesis is that
documentation never lies about behavior. Therefore this session has one
meta-rule above all others: **you may not claim anything you have not wired
and tested.** P0 succeeds with a small repo that is completely true, and
fails with a large repo that is partially true.

## Constitutional rules in force (spec §1 — verbatim, non-negotiable)

1. **Wiring-complete or absent.** Nothing in the tree fails closed.
2. **Claims-first.** No implementation without a claims-registry entry and an
   acceptance test first. The claims registry IS the backlog.
3. Kernel/contract changes route through the human-ratification path.
4. The kernel contains no intelligence.
5. Plugins communicate only through contracts over the bus (enforced from P1;
   the isolation lint lands now).
6. Authority tiers on every automated behavior (the type lands now; the
   enforcer lands in P1).
7. Everything audited.

## Hard constraints for this session

- **Phase gates are hard.** No Pn+1 implementation while any Pn exit
  criterion is red. There is no idle state and no artificial stopping —
  when a phase's exit criteria are green, checkpoint it and advance. The
  failure mode to avoid is never "too much work"; it is work outrunning
  gates.
- **TypeScript, Node 22, pnpm + turborepo, MIT license**, per spec §9.
- **CODING-STANDARDS limits as CI, not convention:** files ≤400 lines,
  functions ≤50, coverage ≥80%, contracts package ≤800 LOC total.
- **Conventional commits**; small commits; every commit leaves CI green.
- **Manual steps go in a checklist, not in your execution.** Org creation,
  npm scope claim, domain registration, and branch-protection rulesets
  require the human's accounts. You generate exact instructions/commands;
  you do not attempt them with your own credentials unless the environment
  already provides them and the human has said so.

## Execution model (orchestrator + fan-out subagents)

This session runs as **one orchestrating agent (you) with scoped subagents**,
governed by `AGENTS.md` (provided alongside this prompt; place it at repo
root in Step 1, with `CLAUDE.md` and `GEMINI.md` as symlinks to it). The
fan-out protocol in AGENTS.md is binding: file-ownership scoping, no
concurrent ownership overlap, subagents produce diffs and reports, you
integrate serially and run the full gate suite after each integration.

Recommended parallelization: Steps 0–1 are serial (you). After the scaffold
lands and CI runs green-on-empty, fan out three subagents in parallel —
**(A)** Step 2 contracts package, **(B)** Step 3 claims registry + claims:check,
**(C)** Step 4 audit-chain port (read-only quarry access to
`nexus-substrate/nexus-agents`). Their file sets are disjoint by design.
Integrate in order A → B → C (B's gate needs A's types; C's events carry
A's `contractsVersion`). Steps 5–6 are serial (you).

**nexus-agents v1 is quarry and ratification panel only** (AGENTS.md policy):
subagent C reads its source and tests; nobody executes v1 pipelines to
generate kernloop code.

---

## Work order

### Step 0 — Read the spec

Read `kernloop-kernel-spec.md` end to end before any other action. Sections
§1 (constitution), §4 (contracts), §9 (repo structure + CI), §10 (porting
queue), §11 (P0 exit) govern this session. Where this prompt and the spec
disagree, the spec wins; note the conflict in your final report.

### Step 1 — Identity bootstrap (generate the human checklist first)

Produce `BOOTSTRAP.md` at repo root containing exact, copy-pasteable steps
for the human:

1. Create GitHub org `kernloop` (fallbacks if sniped: `kernloop-dev`,
   `getkernloop`) and repo `kernloop/kernloop` (public, MIT).
2. Claim npm scope: publish `@kernloop/contracts@0.0.0` placeholder
   (`npm publish --access public`) the same day — scope squatting is real.
3. Register `kernloop.dev` (and optionally `kernloop.io`; `.com` is parked
   by a third party — note it, don't chase it).
4. Org/repo rulesets (governance-of-the-governor, born-in): require PR +
   human review on paths `packages/contracts/**`, `packages/kernel/**`,
   `claims/**`; require status checks `claims:check`, `governance`, `test`;
   no force-push to main; secret scanning + Dependabot on.
5. CODEOWNERS seeded for those same paths → the human's handle.

Then initialize the monorepo per spec §9 (turbo, pnpm workspace, tsconfig,
eslint with the plugin-isolation rule scaffolded, prettier, commitlint,
husky, LICENSE, NOTICE, .gitignore). Place `AGENTS.md` (provided) at repo
root with `CLAUDE.md` and `GEMINI.md` symlinked to it; `governance:check`
(Step 5) must verify the symlinks and that AGENTS.md's repository map and
commands match reality.

### Step 2 — The contracts package (`packages/contracts`)

The frozen five from spec §4, as zod schemas + inferred TS types, versioned
(`contractsVersion` constant + a `MIGRATIONS.md` stub explaining the
ratification path for breaking changes):

`TaskContract`, `Brief`, `Verdict`, `Outcome`, `Manifest` — exactly the
fields in §4, including `Tier` (`observe | suggest | advisory | enforce`)
and `maturity` (`experimental | stable`). Every schema gets: parse/reject
unit tests with malformed-input cases, a round-trip serialization test, and
JSDoc that matches the spec text. Package budget ≤800 LOC of source —
enforced by the LOC gate, not intention.

### Step 3 — The claims registry (`claims/`)

This is the load-bearing deliverable.

- **Schema** (`claims/schema.ts` + YAML format): `id` (stable, e.g.
  `CLM-0001`), `statement` (one sentence, README-quotable), `evidence`
  (typed refs: `test:<path>::<name>`, `ci:<job>`, `doc:<path>#<anchor>`,
  `eval:<artifact>`), `status` (`verified | experimental`), `owner`,
  `since` (version).
- **`claims:check`** (script + CI job, blocking): fails if (a) any claim's
  evidence refs don't resolve (test doesn't exist/passes, file/anchor
  missing), (b) any capability-style statement in `README.md` or
  `ARCHITECTURE.md` lacks a claim ID annotation (start with a conservative
  lint: sentences in a `<!-- claims -->`-delimited capabilities section must
  carry `[CLM-xxxx]` tags), or (c) a claim is `verified` with zero test
  evidence.
- **Populate it honestly:** at session end the registry must contain a claim
  for every true statement in the README you write — contracts validate,
  audit chain verifies, gates block on drift — and **nothing else**. An
  empty-but-honest repo with eight verified claims beats forty aspirations.

### Step 4 — The audit chain (`packages/kernel`, audit module only)

Port-by-evidence from the quarry (spec §10 item 1): the v1 hash-chained
append-only audit log and chain verifier at
`github.com/nexus-substrate/nexus-agents` (`packages/nexus-agents/src/audit/`).
Rules of the port: read the v1 implementation and its tests; reimplement
cleanly against the new contracts types (every audit event envelope carries
`contractsVersion`); bring the *test cases* (including tamper-detection
cases — bit-flip a stored record, truncate the log, reorder entries — all
must be caught); JSONL storage per spec §3.3; expose `appendEvent` /
`verifyChain` as plain library functions (no MCP server yet — that's P1).
Add a property-style test: N random events appended → verify passes; any
single-byte mutation → verify fails.

### Step 5 — CI assembly (`.github/workflows/`)

One pipeline, all blocking: install/build (turbo) → typecheck → lint
(including plugin-isolation rule and LOC limits) → test w/ coverage ≥80% →
`claims:check` → `governance:check` (v0: verifies repo structure matches
spec §9 tree and that CODEOWNERS covers the protected paths) →
audit self-test (build a small chain in CI, verify it, then mutate and
assert verification fails).

### Step 6 — Documentation (short, true, claim-tagged)

- `README.md`: what Kernloop is (autonomic control plane, one entry point,
  adversarial review, immutable audit, closed-loop self-tuning — marked as
  roadmap where not yet built), the P0 capabilities section with `[CLM-]`
  tags, install/dev quickstart, and a visible "Claims" badge/section
  explaining the registry. Preserve a "What this is NOT" section adapted
  from v1.
- `ARCHITECTURE.md`: thin — link-out summary of the spec layers; do not
  duplicate the spec.
- Copy `kernloop-kernel-spec.md` into `docs/` as the canonical spec.

---

## Phase progression protocol (P1–P3)

At each phase boundary:

1. **Checkpoint the finished phase:** write `Pn-REPORT.md` (claims table,
   coverage, LOC vs budgets, deviations from spec with reasoning, the next
   phase's starting line), tag `v0.<n+1>.0-p<n>`.
2. **Ratification gate:** P0 concludes on main, then rulesets snap on (Step
   1/BOOTSTRAP). P1, P2, P3 are each built on a phase branch (`phase/p1`
   etc.); the phase concludes with an **exit PR to main containing the
   report**, reviewed and merged by the human. **The merge is the
   ratification — never self-merge, never bypass.** While awaiting review
   you may begin the next phase's *claims population and design notes* on
   its branch, but no implementation that depends on unratified work.
3. **Derive the next work order from the spec:** phase scope from §11;
   component specs from §3–§6; porting items from §10. Translate the scope
   into claims registry entries FIRST — the claims are the phase backlog —
   then implement in dependency order. Fan out subagents per the AGENTS.md
   protocol wherever file ownership permits parallelism.
4. **Phase-specific ratification points that need the human inside a phase**
   (not just at exit): any contracts change (frozen-five), any authority-tier
   promotion to `enforce`, the Toolsmith sandbox profile (P3), and pr_review's
   advisory→enforce criterion (per spec §5.3). Batch these into clearly
   labeled PRs rather than blocking serially.

P1 scope reminder (spec §11): kernel (registry, router, ladder, bus) +
adapters + compiler + memory (episodic/semantic) + quality gate + the
remaining kernel-eleven tools — exit: one repo, one real task end-to-end
through the quality gate. P2: vote gate + workforce + canonical loop +
overlay — exit: full loop on a real feature, checkpoint/resume proven.
P3: review gate (advisory) + distill + forge/Toolsmith + Observer self-issue
loop — exit: a distilled skill and a forged workshop tool both born through
gates. **From P3 exit onward, kernloop work runs through kernloop itself.**

## P0 exit criteria (all must hold before P1 begins)

1. Fresh clone → `pnpm install && pnpm build && pnpm test` green.
2. `claims:check` green, registry non-empty, every claim's evidence resolves.
3. Deliberate-failure proofs in CI history or test suite: a tampered audit
   log fails verification; a claim with dangling evidence fails the gate;
   a 401-line file fails the LOC gate.
4. No stub, TODO-wired, or fail-closed code path anywhere in the tree.
5. `BOOTSTRAP.md` checklist complete and accurate for the human steps.

## Final report (per phase; P0 shown)

End each phase with its report; for P0, `P0-REPORT.md`: claims table (id → statement → evidence), LOC by
package vs. budgets, coverage, the porting deltas from v1 audit (what you
changed and why), any spec ambiguities encountered with your resolution, and
the precise P1 starting line (what the kernel router work will need that P0
left ready). Print a summary to the terminal at every phase boundary, then proceed
through the protocol above. The campaign ends at P3 exit — or at the spec's
kill criterion, whichever comes first; if the kill criterion fires, stop and
write the post-mortem instead of pushing through.
