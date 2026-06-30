# Kernloop

[![CI](https://github.com/kernloop/kernloop/actions/workflows/ci.yml/badge.svg)](https://github.com/kernloop/kernloop/actions/workflows/ci.yml)

An **autonomic control plane for AI coding agents**, delivered as a local CLI +
MCP server. Kernloop does not write code itself; it makes the agents that write
code governed, observable, context-rich, and compounding.

Every word of that is now capability, not aspiration — and you do not have to
take that on faith. This repository's thesis is that documentation never lies
about behavior, so the line is machine-enforced: every capability statement
below carries a claim ID from [`claims/`](claims/); `claims:check` fails CI if
a statement's evidence does not resolve, and `claims:verify-ran` fails CI
unless every cited test actually ran and passed in that build. The P0→P3
campaign is complete (see [Status](#status)): the frozen contracts, the
kernel, the faculties, the canonical loop, and the eleven MCP tools all exist
and are claim-backed.

## Quickstart

```bash
git clone https://github.com/kernloop/kernloop.git && cd kernloop
pnpm install
pnpm build
pnpm test              # all packages + gate-script tests, coverage ≥80%
pnpm claims:check      # every claim's evidence resolves
pnpm governance:check  # repo structure + charter match reality
```

Node ≥22 and pnpm 10 required.

## At a glance

These counts are DERIVED from the canonical code consts (not hand-typed) and
drift-gated by `pnpm stats:check` (#189):

<!-- stats:begin -->

| Frozen contracts | Kernel MCP tools | Doc-gate languages | Gated packages | Verified claims |
| ---------------- | ---------------- | ------------------ | -------------- | --------------- |
| 5                | 11               | 12                 | 14             | 182             |

<!-- stats:end -->

## Capabilities (verified)

<!-- claims:begin -->

Kernloop's five contracts are zod-validated: malformed messages — missing fields, unknown enum values, wrong types, negative budgets — are rejected at parse time [CLM-0001].
The contract surface is frozen at exactly five types — TaskContract, Brief, Verdict, Outcome, Manifest — and references outside it are rejected [CLM-0004].
All five reject unknown top-level keys, so field drift fails loudly instead of passing silently [CLM-0006].
All five survive JSON round-trip serialization unchanged [CLM-0003].
The authority ladder is a closed four-tier enum — observe, suggest, advisory, enforce — and unknown tiers cannot enter the system [CLM-0002].
Manifests carry governance as data: authority tier, maturity, promotion thresholds, and claim references are schema-enforced [CLM-0005].

Every audit event is hash-chained, and a chain of appended events verifies end-to-end with its exact length [CLM-0009].
Every audit envelope carries the contracts version it was written under [CLM-0010].
A flipped bit in a stored record is detected and attributed to its sequence number [CLM-0011].
Truncating, reordering, or deleting log entries fails verification [CLM-0012].
Tamper evidence is property-tested: across seeded random chains, every sampled single-byte mutation fails verification [CLM-0013].

The documentation gate enforces itself: claims:check fails on dangling evidence [CLM-0007].
A claim marked verified without test evidence fails the gate [CLM-0008].

The event bus carries only the five contracts, rejects malformed messages at the boundary [CLM-0014], and applies backpressure instead of dropping events silently [CLM-0018].
The manifest registry is the single source of capability truth and rejects invalid manifests at registration [CLM-0015].
The authority ladder blocks any action above its manifest's tier or the task's ceiling [CLM-0016], and every tier transition is audited, with automatic demotion on threshold breach [CLM-0017].
Adapter subprocess calls capture all output, enforce wall-clock timeouts [CLM-0019], and meter every call honestly — measured duration always, tokens and dollars only when the CLI reports them [CLM-0020].
An unavailable model CLI is reported as unavailable, never stubbed [CLM-0021].
Semantic memory rejects writes without provenance [CLM-0022] and ranks recall by relevance and recency with a decay clock [CLM-0023].
Episodic memory persists each Outcome as a summary plus trace pointer, retrievable by task id [CLM-0024], in repo-local SQLite that functions empty if deleted [CLM-0025].
The router matches tasks to manifests by capability and budget [CLM-0026], never routes above the task's authority ceiling [CLM-0027], and guarantees demoted capabilities an exploration floor [CLM-0028].
The context compiler is deterministic — identical inputs produce byte-identical Briefs [CLM-0029] — with hard per-section token budgets, priority-ordered drop, and provenance on every section [CLM-0030].
The quality gate runs typecheck, lint, test, and coverage and emits structured, severity-tagged Verdicts [CLM-0031], every one appended to the audit chain [CLM-0032].
The MCP surface exposes exactly the kernel eleven — run, status, brief, gate, recall, remember, distill, forge, manifest, audit, observe — and nothing else [CLM-0033].
The run entry point routes a TaskContract via manifests and returns an Outcome with every routing decision audited [CLM-0034]; the audit tool queries and verifies the chain on demand [CLM-0035].
One real task has run end-to-end through the quality gate — Verdict, Outcome, and verifiable audit chain included [CLM-0036].

The vote gate aggregates voter panels into one Verdict under simple-majority, super-majority, or unanimous strategies — three voters by default, seven at plan ratification [CLM-0037].
Every voter's vote and reasoning is recorded for precision tracking [CLM-0038], and one compiled Brief is shared across the whole panel [CLM-0039].
Workforce agents are configuration, not generation: five shipped templates instantiate as manifests, and new templates enter at suggest tier [CLM-0040].
The PM decomposes plans into child TaskContracts whose declared budgets must sum within the parent's, independent of the run's budget-enforcement mode [CLM-0041].
The canonical loop is declared as data, every edge carrying a contract and every gate emitting a Verdict [CLM-0042].
The vote-iterate cycle is bounded at K iterations before escalating to the human, and the child fan-out re-runs implement on a quality reject — bounded by Kc, folding the gate findings into the coder, escalating one stuck child without sinking the run, every re-iteration audited [CLM-0043].
Per-node checkpoints make any run resumable: a run killed mid-loop resumes and completes without re-running finished nodes [CLM-0044].
A repo overlay overrides gate thresholds, K, budgets, and loop nodes as data — never by duplicating the graph [CLM-0045].
The full canonical loop has run on a real feature in a real repository, end to end through vote and quality gates [CLM-0046].

The review gate performs adversarial diff review at advisory tier, recording every reviewer's vote for precision tracking [CLM-0047], calibrated against the labeled eval set ported from v1 [CLM-0048].
Distill proposes a skill document from an episodic trace at suggest tier [CLM-0049], and skills go live only through the distill ratification path — a human-reviewed move from proposed to live [CLM-0050].
Forge refuses to build a workshop tool without a claim, an acceptance test, and a manifest first [CLM-0051].
Workshop tools are generated and tested only inside the ratified sandbox — no network, scratch-dir filesystem [CLM-0052] — live under the workshop namespace with a hard cap of twelve [CLM-0053], and climb the ladder only by evidence: suggest at birth, advisory after clean audited runs, enforce only with human ratification, decay when unused [CLM-0054].
The Observer maintains the fitness ledger and per-voter precision series [CLM-0055] and proposes self-issues at suggest tier (filing is a separate, enforce-gated action via `kernloop observer file`) that re-enter the canonical loop with no privileged path [CLM-0056], turned into real tracker issues only through a dry-run-default, enforce-gated, audited CLI path [CLM-0094].
The Observer turns fitness and drift signals into suggest-tier deprecation and distill proposals, surfaced through observe, and never auto-acts on them — every proposal awaits human ratification [CLM-0092].
A distilled skill and a forged workshop tool have both been born through gates [CLM-0057].
Distill and forge complete the MCP surface at exactly the kernel eleven [CLM-0058].

Files a coder model emits are confined to the workspace, against both lexical traversal and symlink escape [CLM-0059].
The constitution enforces itself, not just asserts itself: no incompleteness marker — TODO/FIXME/XXX/HACK, "not implemented", or a stub-throwing literal — survives in shipped source [CLM-0060]; kernel source outside the adapters module cannot call or import the model-invocation primitives, so it cannot originate a model call [CLM-0061]; no plugin imports another plugin, including via dynamic faculty-prefixed imports [CLM-0062]; and per-file, per-function, and per-package LOC budgets are gated [CLM-0063].

The canonical loop runs an advisory review gate per child after the quality gate — implement, then quality, then review — its Verdict audited but never blocking [CLM-0064].
A research skill pack ships, so the Researcher template's skill reference resolves [CLM-0066], and the loop's research node invokes the Researcher template, folding gathered findings into the Brief [CLM-0067].

A component's model demand is a two-axis ModelRequirement — model tier (frontier > large > medium > small) and reasoning effort (low < medium < high < xhigh) plus required capabilities — declared on the Manifest and the five workforce templates, superseding the shipped cheap|frontier tiering [CLM-0076].
The kernel translates a ModelRequirement against an adapter's declarative profile by a pure fail-closed lookup: tier resolves to the bound model, degrading downward only to the nearest populated tier and recording it; effort maps to the adapter's literal, clamping to the nearest supported level or dropping honestly when the adapter has none — synthesizing nothing [CLM-0079].
Each model-calling loop node derives its ModelRequirement from the single template/manifest it routes to, and the composition root resolves that to the served adapter, model alias, and effort arg — picking the adapter from the overlay's per-tier map (defaulting to the run adapter) and naming the served model+effort and any degradation in the node's provenance [CLM-0078].
resolveIdentity normalizes a served model alias or id into a ModelIdentity by a pure, layered lookup against a vendored offline catalog — a table hit yields full metadata, a well-formed uncatalogued id is rule-parsed with null metadata, and garbage or the empty string resolves to unknown with its tier defaulted down to small — never throwing, never guessing, and treating generation as an opaque label with no cross-provider arithmetic [CLM-0080].
The canonical loop records that normalized served identity — the real model class behind the served alias, named family, generation, tier, and how it was resolved — in each model-calling node's provenance alongside the raw served ref, admitting an honest unknown for a harness-default node where kernloop pinned no model [CLM-0081].
An OpenAI-compatible HTTP adapter POSTs one assembled prompt to a configured endpoint's chat-completions path, reads the first choice's message content as the output, and meters honestly from the response usage — prompt-plus-completion tokens and a reported cost when the endpoint returns them, else metered false — never fabricating a figure [CLM-0082].
An api endpoint's secret is held env-only: the key is read from the named environment variable at call time, a missing key fails closed with an error naming the env var (never the value), the key appears in no error, output, or raw field, the overlay config boundary rejects a literal key (only the NAME of an env var is ever stored), the kernel writes the authorization and content-type headers last so a config header cannot clobber them and rejects reserved header names at parse, and the looks-like-a-secret guard over header values is defence-in-depth only — bypassable for short keys, not the primary control [CLM-0083].
The api adapter validates the operator-configured base URL before any network egress — requiring HTTPS except for an explicit local host, rejecting any other scheme or embedded credentials — appends only the fixed chat-completions path, refuses cross-host redirects, caps the response read with a streamed size limit that aborts past the cap, and enforces a wall-clock timeout via one AbortController spanning both request and body read, a guard that trusts the overlay as operator config (an HTTPS base URL may reach any host the operator points it at) and is not SSRF immunity against a hostile overlay [CLM-0084].
When a loop node's tier resolves to a registered api endpoint, the composition root invokes it through the kernel api adapter, resolves the served model and effort through the same pure translation seam, records the endpoint as the served adapter, and meters the call's tokens and dollars into the run budget — with an optional per-endpoint spend cap failing closed [CLM-0085].
Model discovery enumerates the models an endpoint serves via its stable public contract — an OpenAI-compatible /v1/models with the bearer key read env-only at call time, and ollama's local /api/tags with no secret — reusing the api adapter's base-URL guard, fixed path, redirect refusal, streamed size cap, single timeout, and key-scrub primitives, validating the response defensively so a non-2xx or malformed body is a typed error rather than a guessed model and the key leaks into no surface [CLM-0086].
Discovered ids normalize through the unchanged resolveIdentity and persist to a machine-local discovered cache keyed by source with its sync timestamp, validated by zod so a missing or corrupt cache degrades to empty rather than crashing, a re-sync replaces a source's set so a vanished model never persists, and the loop's provenance consults the cache so a discovered served model normalizes by table rather than a bare rule parse [CLM-0087].
The CLI verb `kernloop models sync` discovers every registered endpoint plus a local ollama, normalizes and replaces each source's discovered set, and audits the run with per-source counts but never the key — isolating a failed source so the others proceed and never fabricating a model — while `kernloop models list` prints the merged vendored and discovered catalog with each row's identity and provenance and the cache's freshness, both as CLI verbs rather than a twelfth MCP tool [CLM-0088].
Budget enforcement is a run-level mode: enforce halts an over-budget run (escalates, resumable) while unlimited never halts on budget — but usage and cost are metered and reported identically in both modes, and an unlimited run is recorded honestly as having run without budget enforcement [CLM-0077].

Semantic facts and episodic trace summaries export to a portable JSON document and re-import loss-free, so an overlay's memory can travel with the repo [CLM-0069].
Learned routing priors export from the Observer fitness ledger to a reviewable YAML priors file committed with the overlay [CLM-0070].

A born workshop tool is invocable: `kernloop workshop run` executes it in the ratified sandbox against a stdin contract JSON, parses its stdout contract JSON, and audits every invocation [CLM-0071].
Workshop tools earn promotion through use — five clean audited invocations move a tool from suggest to advisory — and `kernloop workshop sweep` decays unused tools toward removal [CLM-0072].

Every run is recorded in a persisted job registry, and `status` resolves a job id to its state — running, done, or failed — cross-session from a fresh process over the same overlay [CLM-0073].
`run --async` returns a job id immediately and runs the work in the resident process, recording the terminal state to the job registry — a failed background run is recorded as failed, never an unhandled rejection [CLM-0074].

A claim may anchor to a function and its doc-comment with `code:path#symbol[@doc:/regex/]`: the symbol must exist and, with `@doc`, its doc-comment must assert the claim — additive evidence that pins the implementation, while `claims:check` still requires a `test:` ref before any claim is verified [CLM-0089].

The generated public-API reference under `docs/` is derived, never hand-written: it is mined from each gated package's existing JSDoc — symbol name, kind, the first sentence of the comment, and the `[CLM-]`/`spec §` refs already present — and drift-checked in CI so a stale reference fails the build [CLM-0090].
Every value export — function, const, class, enum — on a gated package's public API surface carries a real, non-placeholder doc-comment, enforced by a CI doc-coverage gate over twelve packages — including the nested-barrel and `export *` packages, via a recursive re-export resolver — whose excluded scope is recorded rather than silently weakened [CLM-0091].

A provider-agnostic TrackerProvider abstraction with an honest capability descriptor and a secure GitHub provider files, closes, comments on, and labels issues by building gh invocations as args-arrays with no shell, the body via a temp file, flag injection guarded, the gh subcommand allowlisted, and the repo scoped from validated config — gated to the enforce tier and audited through the dry-run-default `kernloop tracker` CLI [CLM-0093].

<!-- claims:end -->

The list above is a **curated highlight**. The complete, claim-by-claim list —
every verified claim, with its statement and the evidence that enforces it —
lives in [`docs/CLAIMS.md`](docs/CLAIMS.md), generated from the registry and
drift-checked in CI.

## The claims registry

[`claims/registry/`](claims/registry/) holds one YAML file per claim: a
one-sentence statement, typed evidence references
(`test:<path>::<name>`, `ci:<job>`, `doc:<path>#<anchor>`, `eval:<artifact>`),
a status, an owner, and the version it landed in. `pnpm claims:check` verifies
that every evidence reference resolves and that every sentence in the
capabilities section above carries a claim tag. The registry is also the
backlog: no feature is implemented before its claim and acceptance test exist.

Each claim is enforced by its cited evidence, not by prose. `test` evidence is
gated twice — the `test` job runs it, and `claims:verify-ran` proves the cited
test actually ran and passed in that build — so a claim cannot be marked
verified by a test that never executed. The full enforcement detail per claim
(which test or gate backs it) is generated into
[`docs/CLAIMS.md`](docs/CLAIMS.md) and the per-claim YAML, both drift-checked,
so neither can lie about which evidence proves which claim.

## What this is NOT

- **Not a coding agent.** Kernloop never writes application code; it governs
  the agents that do. The kernel contains no intelligence and never calls a
  model on its own behalf.
- **Not a SaaS.** No REST API, no server mode, no multi-user anything.
  Local-first: SQLite, JSONL, and the filesystem.
- **Not a framework with 40 aspirational features.** Anything not backed by a
  verified claim does not exist here. A small true repo beats a large
  partially-true one.
- **Not self-modifying.** Kernel and contract changes require human
  ratification (CODEOWNERS + required review + audit event).

## Status

The P0→P3 build campaign is **complete** — all four phases (P0 contracts, P1
kernel + faculties, P2 canonical loop, P3 self-improvement) are merged on
`main`, each phase's exit report archived under [`docs/history/`](docs/history/)
as a point-in-time snapshot.

There is no forward roadmap table to maintain: the project now evolves
continuously under the spec §11 phase model, where the current phase is
**derived from the repo** (the highest phase whose exit PR merged, plus one),
not pinned in this file. Open work lives in GitHub issues and milestones; the
direction is the north-star epic ([#47](https://github.com/kernloop/kernloop/issues/47)).
From P3 onward, kernloop work runs through kernloop itself.

The canonical design is
[`docs/kernloop-kernel-spec.md`](docs/kernloop-kernel-spec.md); the agent
charter is [`AGENTS.md`](AGENTS.md). Architecture overview:
[`ARCHITECTURE.md`](ARCHITECTURE.md). Security policy:
[`SECURITY.md`](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). Ancestry: ported-by-evidence from
[nexus-agents v1](https://github.com/nexus-substrate/nexus-agents) per the
porting queue in the spec; see [NOTICE](NOTICE).

<!-- claim-links:begin -->

[CLM-0001]: docs/CLAIMS.md#clm-0001
[CLM-0002]: docs/CLAIMS.md#clm-0002
[CLM-0003]: docs/CLAIMS.md#clm-0003
[CLM-0004]: docs/CLAIMS.md#clm-0004
[CLM-0005]: docs/CLAIMS.md#clm-0005
[CLM-0006]: docs/CLAIMS.md#clm-0006
[CLM-0007]: docs/CLAIMS.md#clm-0007
[CLM-0008]: docs/CLAIMS.md#clm-0008
[CLM-0009]: docs/CLAIMS.md#clm-0009
[CLM-0010]: docs/CLAIMS.md#clm-0010
[CLM-0011]: docs/CLAIMS.md#clm-0011
[CLM-0012]: docs/CLAIMS.md#clm-0012
[CLM-0013]: docs/CLAIMS.md#clm-0013
[CLM-0014]: docs/CLAIMS.md#clm-0014
[CLM-0015]: docs/CLAIMS.md#clm-0015
[CLM-0016]: docs/CLAIMS.md#clm-0016
[CLM-0017]: docs/CLAIMS.md#clm-0017
[CLM-0018]: docs/CLAIMS.md#clm-0018
[CLM-0019]: docs/CLAIMS.md#clm-0019
[CLM-0020]: docs/CLAIMS.md#clm-0020
[CLM-0021]: docs/CLAIMS.md#clm-0021
[CLM-0022]: docs/CLAIMS.md#clm-0022
[CLM-0023]: docs/CLAIMS.md#clm-0023
[CLM-0024]: docs/CLAIMS.md#clm-0024
[CLM-0025]: docs/CLAIMS.md#clm-0025
[CLM-0026]: docs/CLAIMS.md#clm-0026
[CLM-0027]: docs/CLAIMS.md#clm-0027
[CLM-0028]: docs/CLAIMS.md#clm-0028
[CLM-0029]: docs/CLAIMS.md#clm-0029
[CLM-0030]: docs/CLAIMS.md#clm-0030
[CLM-0031]: docs/CLAIMS.md#clm-0031
[CLM-0032]: docs/CLAIMS.md#clm-0032
[CLM-0033]: docs/CLAIMS.md#clm-0033
[CLM-0034]: docs/CLAIMS.md#clm-0034
[CLM-0035]: docs/CLAIMS.md#clm-0035
[CLM-0036]: docs/CLAIMS.md#clm-0036
[CLM-0037]: docs/CLAIMS.md#clm-0037
[CLM-0038]: docs/CLAIMS.md#clm-0038
[CLM-0039]: docs/CLAIMS.md#clm-0039
[CLM-0040]: docs/CLAIMS.md#clm-0040
[CLM-0041]: docs/CLAIMS.md#clm-0041
[CLM-0042]: docs/CLAIMS.md#clm-0042
[CLM-0043]: docs/CLAIMS.md#clm-0043
[CLM-0044]: docs/CLAIMS.md#clm-0044
[CLM-0045]: docs/CLAIMS.md#clm-0045
[CLM-0046]: docs/CLAIMS.md#clm-0046
[CLM-0047]: docs/CLAIMS.md#clm-0047
[CLM-0048]: docs/CLAIMS.md#clm-0048
[CLM-0049]: docs/CLAIMS.md#clm-0049
[CLM-0050]: docs/CLAIMS.md#clm-0050
[CLM-0051]: docs/CLAIMS.md#clm-0051
[CLM-0052]: docs/CLAIMS.md#clm-0052
[CLM-0053]: docs/CLAIMS.md#clm-0053
[CLM-0054]: docs/CLAIMS.md#clm-0054
[CLM-0055]: docs/CLAIMS.md#clm-0055
[CLM-0056]: docs/CLAIMS.md#clm-0056
[CLM-0057]: docs/CLAIMS.md#clm-0057
[CLM-0058]: docs/CLAIMS.md#clm-0058
[CLM-0059]: docs/CLAIMS.md#clm-0059
[CLM-0060]: docs/CLAIMS.md#clm-0060
[CLM-0061]: docs/CLAIMS.md#clm-0061
[CLM-0062]: docs/CLAIMS.md#clm-0062
[CLM-0063]: docs/CLAIMS.md#clm-0063
[CLM-0064]: docs/CLAIMS.md#clm-0064
[CLM-0066]: docs/CLAIMS.md#clm-0066
[CLM-0067]: docs/CLAIMS.md#clm-0067
[CLM-0069]: docs/CLAIMS.md#clm-0069
[CLM-0070]: docs/CLAIMS.md#clm-0070
[CLM-0071]: docs/CLAIMS.md#clm-0071
[CLM-0072]: docs/CLAIMS.md#clm-0072
[CLM-0073]: docs/CLAIMS.md#clm-0073
[CLM-0074]: docs/CLAIMS.md#clm-0074
[CLM-0076]: docs/CLAIMS.md#clm-0076
[CLM-0077]: docs/CLAIMS.md#clm-0077
[CLM-0078]: docs/CLAIMS.md#clm-0078
[CLM-0079]: docs/CLAIMS.md#clm-0079
[CLM-0080]: docs/CLAIMS.md#clm-0080
[CLM-0081]: docs/CLAIMS.md#clm-0081
[CLM-0082]: docs/CLAIMS.md#clm-0082
[CLM-0083]: docs/CLAIMS.md#clm-0083
[CLM-0084]: docs/CLAIMS.md#clm-0084
[CLM-0085]: docs/CLAIMS.md#clm-0085
[CLM-0086]: docs/CLAIMS.md#clm-0086
[CLM-0087]: docs/CLAIMS.md#clm-0087
[CLM-0088]: docs/CLAIMS.md#clm-0088
[CLM-0089]: docs/CLAIMS.md#clm-0089
[CLM-0090]: docs/CLAIMS.md#clm-0090
[CLM-0091]: docs/CLAIMS.md#clm-0091
[CLM-0092]: docs/CLAIMS.md#clm-0092
[CLM-0093]: docs/CLAIMS.md#clm-0093
[CLM-0094]: docs/CLAIMS.md#clm-0094

<!-- claim-links:end -->
