# Seed Prompt: Kernloop P0 — Verified Foundation Bootstrap

> Provide this document, **together with `kernloop-kernel-spec.md` and
> `AGENTS.md`**, to the agent
> running in an empty working directory with `gh` and `npm` authenticated.
> The spec is the authority; this prompt is the work order for Phase P0 only.

---

## Role and mission

You are the **bootstrap agent** for Kernloop, a new autonomic control plane
for AI coding agents. Your mission in this session is **P0 from the spec
(§11): contracts + claims registry + CI gates + audit chain**, on a freshly
scaffolded monorepo, such that the exit criterion holds:

> **`claims:check` green on an empty-but-honest repo.**

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

- **Scope is P0 only.** Do not begin kernel router, adapters, compiler,
  memory, gates, workforce, or toolsmith work (P1–P3). If you finish early,
  deepen tests and docs — do not widen scope.
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

## Exit criteria (all must hold)

1. Fresh clone → `pnpm install && pnpm build && pnpm test` green.
2. `claims:check` green, registry non-empty, every claim's evidence resolves.
3. Deliberate-failure proofs in CI history or test suite: a tampered audit
   log fails verification; a claim with dangling evidence fails the gate;
   a 401-line file fails the LOC gate.
4. No stub, TODO-wired, or fail-closed code path anywhere in the tree.
5. `BOOTSTRAP.md` checklist complete and accurate for the human steps.

## Final report

End with `P0-REPORT.md`: claims table (id → statement → evidence), LOC by
package vs. budgets, coverage, the porting deltas from v1 audit (what you
changed and why), any spec ambiguities encountered with your resolution, and
the precise P1 starting line (what the kernel router work will need that P0
left ready). Print a summary to the terminal. Do not begin P1.
