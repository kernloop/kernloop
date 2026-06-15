# AGENTS.md — Kernloop Agent Charter

> The behavioral contract for every AI agent operating in this repository —
> Claude (Fable/Opus), Codex, Gemini, OpenCode, and any subagent they spawn.
> `CLAUDE.md` and `GEMINI.md` are symlinks to this file; there is one charter.
> Adapted from the nexus-agents v1 charter; this version is claims-first.
> `governance:check` verifies this file against repo reality. If you change
> behavior, change this file in the same PR — drift fails CI.

---

## What this repository is

Kernloop is an **autonomic control plane for AI coding agents** — kernel,
frozen contracts, governed faculties, one canonical loop. The authoritative
design is `docs/kernloop-kernel-spec.md`. Where this charter and the spec
disagree, **the spec wins**; report the conflict.

**Phase progression (P0 → P1 → P2 → P3, spec §11).** Work proceeds
continuously through the phases in order — there is no idle state — but a
phase's exit criteria are a **hard gate**: no Pn+1 implementation while any
Pn exit criterion is red. The current phase is determined by the repo itself:
the highest phase whose exit PR has been merged, plus one. P0 builds on main
(pre-ruleset); P1+ each live on a phase branch (`phase/p1`, `phase/p2`,
`phase/p3`) whose exit PR — containing the phase report — is reviewed and
merged by the human. That merge IS the ratification; do not self-merge.
Within a phase, triage is claims-first: populate the phase's claims registry
entries as the backlog before implementing, then execute in dependency order.

## The prime directive

**Never claim what you have not wired and tested.** This repo's thesis is
that documentation cannot lie about behavior. A small true repo beats a large
partially-true one. If you feel pressure to stub something to "make progress,"
stop: per the constitution, it is wiring-complete or absent.

## Constitutional rules (spec §1 — binding on every agent)

1. **Wiring-complete or absent.** No fail-closed code paths, no stub
   executors, no TODO-wired exports. Incomplete work lives on a branch, not
   in main behind a stub.
2. **Claims-first.** Before implementing: add the claim (`claims/`) and the
   acceptance test. The claims registry is the backlog. Done = `claims:check`
   green with your claim's evidence resolving.
3. **Protected paths need a human.** `packages/contracts/**`,
   `packages/kernel/**`, `claims/**`, and this file merge only via PR with
   human review. Never push directly; never weaken these rules.
4. **The kernel contains no intelligence.** Do not add model calls to kernel
   code. Ever.
5. **No plugin imports another plugin.** Faculties communicate via contracts
   over the bus. The isolation lint enforces this; do not suppress it.
6. **Authority tiers are real.** Anything automated declares
   `observe | suggest | advisory | enforce` in its manifest. Promotion needs
   evidence + ratification; never default upward.
7. **Audit everything.** If you add a behavior that acts, it appends audit
   events. No silent actions.

## Definition of done (all six, no exceptions)

1. A tracking **GitHub issue** exists and the PR references it (`Closes #N`)
2. Claim exists in `claims/` with evidence refs that resolve
3. Tests written first or alongside; coverage ≥80% on touched packages
4. Wired end-to-end — invocable through a real entry point, not just exported
5. All gates green: build, typecheck, lint (incl. isolation + LOC), test,
   `claims:check`, `claims:verify-ran` (every cited test ran and passed),
   `governance:check`
6. Docs updated in the same PR, capability statements tagged `[CLM-xxxx]`

## Work tracking — issues are the durable record

Memory and in-session todo lists do not survive a context reset; **issues
do**. The registry tracks _capabilities_; issues track _work and problems_.

- **Issue-first.** Any non-trivial unit of work (a feature, a fix, a phase, a
  review-round finding) gets a GitHub issue before or as it starts. Trivial
  mechanical edits (a typo, a format pass) do not. When unsure, file one —
  cheap insurance against a lost thread.
- **Findings become issues immediately.** Anything a QA / security /
  cleanup round surfaces is filed as a labeled issue the moment it is found,
  with file:line and a concrete fix — never left only in prose a reset will
  erase. Labels: `review-finding`, `security`, `honesty`, `vestigial`.
- **Deferrals become issues.** Any work you consciously DEFER — a
  `later`/`for now`/`not yet`/`P3` in code, an "honestly deferred" in a claim,
  a scope split out of a PR, a TODO, or a ratified "do not do this yet"
  decision — gets a GitHub issue (label `deferred`) capturing WHAT is
  postponed, WHY, and the TRIGGER that should bring it back (a condition, a
  date, or "when a 3rd caller appears"), before you move on. The in-code, doc,
  or claim note that records the deferral references that issue (`#N`). A reset
  erases the reasoning behind a deferral; the issue is where that intent
  survives — so a deferral with no issue is a lost thread, which this repo does
  not allow.
- **Closed by the PR that fixes it.** `Closes #N` in the PR body gives a
  searchable, permanent record of completed work and the reasoning behind it.
- **Triage into the backlog.** A finding that needs a new capability gets a
  `planned` claim (the registry is the backlog); a finding that is a defect
  in existing work gets fixed directly. Either way the issue is the anchor.

## Standing review rounds (run by default, as appropriate)

These are not optional polish — they are gates with triggers. Each round
files issues for what it finds (above), and a phase exit PR may not merge
with an open `security` or `honesty` finding it introduced. The e2e suite
(`pnpm e2e`, its own CI job) is a standing integration gate alongside these
rounds: it drives the real built CLI through the AGILE pipeline and the hard
invariants against a hermetic `gh`, and a phase exit PR may not merge red.

- **QA / claim-honesty round — every phase exit, and before any exit PR.**
  Adversarially audit whether each claim's cited evidence _enforces_ the
  claim or merely touches the same code. Verify `claims:verify-ran` is green
  (cited tests actually ran and passed). Spot-check the load-bearing claims
  by reading test bodies, not names.
- **Security round — whenever the change executes generated or external
  content, spawns a subprocess, handles paths, or touches secrets; mandatory
  at the exit of any phase that did.** Trace the data flow adversarially;
  prefer realpath/allowlist/sandbox defenses over lexical checks.
- **Vestigial-cleanup round — every phase exit and after any large merge.**
  Stale docs (especially capability prose _outside_ the claims-gated block),
  dead exports, decorative `[CLM-]` tags beyond the lint's reach, orphaned
  files, point-in-time reports presented as current.

Independence matters: a system grading its own homework is the dishonesty
this repo exists to prevent. Use external review (nexus-agents quarry-panel,
adversarial subagents told to _refute_) for these rounds, not only self-audit.

## Autonomous mode (the loop)

When the human invokes autonomous/loop mode ("continue autonomously", "loop
through the backlog", `/loop`, or a standing directive to that effect), operate
as a continuous loop rather than a single task — but the constitution above is
unchanged; autonomy is a _cadence_, never a license to weaken a rule.

- **Ask up front, then don't stop.** Surface every genuinely-blocking question
  (a direction fork, a needed ratification) at the START of the run, so the
  loop runs to a natural checkpoint without interrupting. Mid-loop, prefer the
  narrower interpretation and a recorded resolution over stopping.
- **One coherent unit per iteration.** Pick the highest-value backlog item (any
  size — a clean cleanup or a large epic), execute it end-to-end to the full
  Definition of Done (claim + tests + wiring + green gates), open a PR, and —
  under the human's standing merge approval — merge it, sync, and repeat. Work
  in claims-first dependency order.
- **Ideas and problems become issues, always** (see Work tracking): a great
  idea, a finding, a deferral, a question you resolved by being clever — file
  it the moment it appears; the issue is the durable record a reset cannot lose.
- **Run the standing rounds** (QA / security / vestigial) when appropriate, not
  only at phase exits — after a substantial change, before relying on a claim.
  Use adversarial subagents told to _refute_; their findings become issues.
- **Stop and surface, don't guess.** Anything that changes a contract, claims
  semantics, or phase scope, or needs a protected-path human-review merge or a
  phase-exit ratification, goes to the human — autonomous mode never self-merges
  those, never overrides a ratified decision, and never defaults an authority
  tier upward.
- **Never idle longer than 4.5 minutes in one gap.** The model's prompt cache
  has a ~5-minute TTL; a longer idle (e.g. sleeping on a CI run or a build)
  reads the whole context back UNCACHED — slower and costlier. When a wait would
  exceed ~4.5 min, do useful work in the gap instead of sleeping — scout the
  next item, run a review round, update docs, draft the next claim — and poll
  long-running CI at sub-4.5-minute intervals so the loop never goes cold.

## Commands

```
pnpm install            # bootstrap
pnpm build              # turbo build all packages
pnpm test               # all tests + coverage
pnpm e2e                # end-to-end functional suite: drives the real CLI through the AGILE pipeline + the hard invariants against a hermetic gh
pnpm lint               # eslint incl. plugin-isolation + LOC limits
pnpm claims:check       # statically verify every claim's evidence resolves
pnpm claims:verify-ran  # prove every cited test actually ran and passed
pnpm docs:render        # regenerate docs/API.md from package JSDoc (--check drift-gates it)
pnpm docs:coverage      # every value export of a gated package carries a doc-comment
pnpm stats:check        # derived counts (README block + watched prose) match the code consts
pnpm governance:check   # verify repo structure + charter match reality
```

A fresh clone must pass all of the above before and after your change.

## Repository map

```
packages/contracts/   FROZEN FIVE (TaskContract, Brief, Verdict, Outcome,
                      Manifest) — ≤800 LOC total — protected path
packages/kernel/      registry · router · audit · ladder · bus · adapters
                      — protected path
packages/faculty-*/   compiler, memory, gates, workforce, observer,
                      toolsmith, models
packages/workflows/   canonical loop graph + engine
packages/cli/         kernloop init/doctor/run/…
claims/               claims registry + schema — protected path
skills/               global skill library
docs/                 spec (canonical) + thin ARCHITECTURE.md
```

## Coding standards (CI-enforced, not aspirational)

- TypeScript strict; Node 22; pnpm + turborepo; MIT
- Files ≤400 lines · functions ≤50 lines · coverage ≥80%
- Conventional commits (`feat(scope):`, `fix(scope):`, `chore(scope):`);
  small commits; every commit leaves CI green
- zod-validate at every contract boundary; no `any` across boundaries
- No new runtime dependency without stating why in the PR description
- Tests doing real I/O (subprocess, `tsc`, the canonical loop, whole-repo
  scans) set a generous `testTimeout` (the I/O-heavy packages default to 30s in
  their `vitest.config.ts`) — never rely on vitest's 5s default, which flakes
  under CI load. A transitive dev-dep advisory that fails `pnpm audit
--audit-level=high` is pinned via root `pnpm.overrides` (e.g. esbuild),
  stating the advisory in the PR.

## Forbidden (will be reverted on sight)

- Stubs, mocks-as-implementation, or fail-closed paths in main
- Capability statements in any doc without a `[CLM-xxxx]` tag
- Disabling, skipping, or loosening any CI gate to get green
- Adding an MCP tool beyond the kernel eleven (spec §3.4) — depth ships as
  skills or `workshop/*` tools, never tool #12
- Editing protected paths without the human-review PR path
- `npm publish` or version tags without explicit human instruction
- Using nexus-agents v1 to generate or execute kernloop code (see below)

## Multi-agent / subagent fan-out protocol

When an orchestrating agent spawns subagents:

- **Scope by file ownership.** Each subagent receives a TaskContract-shaped
  brief: goal, the spec sections that govern it, the files it owns, its
  definition of done. **No two concurrent subagents may own the same file.**
- **Charter travels.** Every subagent prompt includes (or links) this file;
  the constitution binds subagents identically.
- **Subagents do not merge.** They produce branches/diffs; the orchestrator
  integrates serially, runs the full gate suite after each integration, and
  owns the final state.
- **Subagents do not expand scope.** Discovery outside their brief is
  reported back, not acted on.
- **Claims are written by the implementer.** The subagent that wires a
  capability writes its claim + evidence; the orchestrator verifies
  resolution at integration.

## nexus-agents v1 usage policy

v1 (`nexus-substrate/nexus-agents`) has exactly two roles here:

1. **Quarry (read-only).** Ports follow spec §10: read the v1 source and
   tests, reimplement against kernloop contracts, bring the test cases.
   Never copy wholesale; never import v1 packages.
2. **Ratification panel.** `consensus_vote` may be used for spec changes and
   tier promotions until kernloop's own vote gate exists (P2).

It is never an execution engine for this repo. From P3 exit onward, kernloop
work runs through kernloop itself (dogfooding milestone, spec §11).

## When uncertain

Prefer the narrower interpretation; record the ambiguity and your resolution
in your session report. Questions that change contracts, claims semantics, or
phase scope go to the human — do not resolve them by being clever.
