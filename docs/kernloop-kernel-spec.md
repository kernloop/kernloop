# Kernloop — Kernel & System Specification

**Status:** Draft for ratification (run through v1 `consensus_vote` before seeding the new repo)
**Decisions encoded:** Local CLI + MCP deployment · Toolsmith in first build (sandboxed) · TypeScript · Name: **Kernloop** (verified clear: npm `kernloop` + scope `@kernloop` free, GitHub name free, no web presence; kernloop.dev/.io likely free, .com parked)

---

## 1. Identity

An **autonomic control plane for AI coding agents**, delivered as a local CLI +
MCP server. It does not write code itself; it makes the agents that write code
**governed, observable, context-rich, and compounding** — each session starts
further ahead because the system remembered, and ships safer because every
path runs through gates.

### Constitutional rules (violations are kernel bugs, not style issues)

1. **Wiring-complete or absent.** Nothing in the tree fails closed. Incomplete
   capability lives behind an explicit `experimental` manifest tier that the
   router reports honestly, or it does not exist.
2. **Claims-first development.** No implementation without a claims-registry
   entry and an acceptance test first. The claims registry IS the backlog.
   A feature exists when `claims:check` passes.
3. **The kernel never self-modifies.** Kernel and contract changes require the
   human-ratification path (CODEOWNERS + recorded review + audit event).
4. **The kernel contains no intelligence.** It routes, records, enforces, and
   budgets. It never calls a model on its own behalf.
5. **Plugins communicate only through contracts over the event bus.** No
   plugin imports another plugin. Ever.
6. **Every automated behavior declares an authority tier** and earns
   promotion through evidence. Promotion is never a default.
7. **Everything is audited.** Every contract message, gate verdict, routing
   decision, tier change, memory write, and tool build appends to the hash
   chain.

### Second-system restraint — what does NOT exist in v2

No REST API. No multi-user/server mode. No Byzantine consensus protocols
beyond the voting strategies actually used by gates. No 8-type memory
taxonomy. No tool beyond the kernel eleven (§3.4) except `workshop/*`
creations under their cap. No research mega-system in the kernel — research
is one faculty among peers. Anything cut here that proves necessary returns
through a claim + manifest, not nostalgia.

---

## 2. Layer model

```
L3  Workflows      canonical loop graph + repo overrides        (data: graphs)
L2  Faculties      compiler · memory · gates · workforce ·      (plugins)
                   observer · toolsmith
L1  Contracts      TaskContract · Brief · Verdict ·             (frozen types)
                   Outcome · Manifest
L0  Kernel         registry · router · audit chain ·            (~3–5k LOC)
                   ladder · bus · adapters
```

LOC budgets are acceptance criteria, not aspirations: kernel ≤5,000;
contracts package ≤800; each faculty ≤4,000; any file ≤400; any function ≤50.
CI fails on breach.

---

## 3. Layer 0 — Kernel

### 3.1 Components

| Component | Responsibility | Explicitly NOT |
|---|---|---|
| **ManifestRegistry** | Register/validate/version manifests; single source of capability truth; drift-checked | Loading plugin code (loader is dumb, registry is law) |
| **Router** | Match TaskContract → manifest(s) by capability, budget, authority tier, fitness prior | Strategy logic, retries-with-cleverness, model calls |
| **AuditChain** | Append-only hash-chained event log; `verify` op; SIEM-compatible JSON lines | Analytics (Observer's job) |
| **Ladder** | Enforce authority tiers on every routed action; record tier transitions | Deciding promotions (humans + gates decide; Ladder enforces) |
| **EventBus** | Typed pub/sub carrying the five contracts; backpressure; replay hooks | Persistence beyond audit (memory faculty owns durable state) |
| **Adapters** | Uniform interface to model CLIs/APIs (claude, codex, gemini, opencode, ollama); per-call token/cost metering | Routing decisions, prompt assembly |

### 3.2 Authority ladder (kernel-enforced)

| Tier | May | Promotion requires |
|---|---|---|
| `observe` | Emit telemetry only | — (entry tier for Observer probes) |
| `suggest` | File issues / proposals | Default entry for anything generative |
| `advisory` | Cast non-blocking Verdicts | Evidence threshold defined in the component's manifest (e.g., precision ≥ X over sliding window n ≥ Y) + ratification vote |
| `enforce` | Block, act, mutate | Sustained advisory evidence + human ratification, recorded in audit |

Demotion is automatic on threshold breach; demotion events are audited; a
**floor of exploration traffic** (router exploration term, verified by test)
prevents the demote→starve→prune death spiral. Capability *removal* always
requires human ratification regardless of fitness score.

### 3.3 Storage

Local-first per machine: SQLite for memory/outcomes/fitness — **one DB per
overlay** — append-only JSONL for the audit chain, filesystem for skills and
workshop tools. No daemon; the MCP server is the only resident process, per
session. (A per-machine *global* cross-overlay DB — memory/fitness that
compounds across repos — is a deferred extension that returns through a claim
when a real cross-overlay use case exists, not before; ratified 2026-06-11.
As realized, every fact lives in its overlay's DB and is repo-local by
construction.)

### 3.4 The kernel eleven (complete MCP tool surface)

| Tool | Contract in → out | Purpose |
|---|---|---|
| `run` | goal/TaskContract → Outcome (or job id) | The entry point. Routes via manifests; `execute:false` returns the routing decision |
| `status` | job id → task state | Async job inspection, cross-session |
| `brief` | TaskContract → Brief | Compile context without executing (dry-run the compiler; also used by external agents wanting a brief) |
| `gate` | proposal + gate name → Verdict | Invoke any gate (vote / quality / review) uniformly |
| `recall` | query → Brief fragments | Memory read, provenance-tagged |
| `remember` | typed fact/trace → ack | Memory write; provenance mandatory |
| `distill` | trace id → skill proposal | Propose SKILL.md from an episodic trace (enters at `suggest`) |
| `forge` | tool spec → workshop build report | Toolsmith entry (§5.6) |
| `manifest` | op → registry view/ack | Register/list/inspect/version manifests |
| `audit` | range/op → events / chain verification | Query + `verify_chain` |
| `observe` | scope → fitness/cost/health report | Telemetry, tool-fitness ledger, weather |

Eleven, frozen. Depth ships as **skills** (progressive disclosure), never as
tool #12. Workshop tools register under a separate `workshop/*` namespace and
do not count against — or extend — the kernel surface.

---

## 4. Layer 1 — Contracts (the frozen five)

Versioned with explicit migrations; breaking changes follow the kernel
ratification path. Sketches (canonical schemas live in `packages/contracts`,
zod-validated at every bus boundary):

```ts
interface TaskContract {
  id: string; parent?: string;
  goal: string;
  constraints: string[];
  budget: { tokens: number; usd: number; wallClockMin: number };
  evidence: EvidenceRequirement[];      // what proves done
  definitionOfDone: Check[];            // machine-checkable
  authorityCeiling: Tier;               // max tier any action may use
  overlay: string;                      // repo overlay id
}

interface Brief {
  taskId: string;
  sections: BriefSection[];             // each: { name, content, tokens,
                                        //   priority, provenance: Source[] }
  budget: { allotted: number; used: number };
  compilerVersion: string;              // briefs are reproducible artifacts
}

interface Verdict {
  taskId: string; gate: string;
  result: 'approve' | 'reject' | 'abstain' | 'pass' | 'fail';
  confidence: number;
  findings: Finding[];                  // structured, severity-tagged
  voters?: VoterRecord[];               // per-voter reasoning, for precision tracking
  cost: Cost;
}

interface Outcome {
  taskId: string;
  status: 'success' | 'partial' | 'failure' | 'cancelled';
  signals: Signal[];                    // tests passed, gates cleared, regressions
  cost: Cost;                           // per-adapter, per-phase
  traceRef: string;                     // pointer to full episodic trace
  distillCandidates: string[];          // traces worth skill distillation
}

interface Manifest {
  name: string; version: string; kind: 'faculty'|'strategy'|'gate'|'agentTemplate'|'skill'|'workshopTool';
  capabilities: Capability[];
  contracts: { consumes: ContractRef[]; emits: ContractRef[] };
  cost: CostProfile;                    // expected tokens/usd/latency
  tier: Tier;                           // current authority tier
  promotion?: EvidenceThreshold;        // what earns the next tier
  claims: ClaimRef[];                   // backing evidence — empty = experimental
  maturity: 'experimental'|'stable';
}
```

---

## 5. Layer 2 — Faculties

Each faculty is a workspace package with a manifest, conforms to contracts,
and is independently replaceable.

### 5.1 Context Compiler — the capability multiplier

Deterministically assembles a Brief from: TaskContract → overlay claims
registry → semantic memory (provenance-ranked) → relevant episodic summaries
→ repo state probes → applicable skills index (names + one-liners only —
bodies load on demand). **Hard token budget per section, priority-ordered
drop policy, every line provenance-tagged.** Identical inputs → identical
Brief (compiler version pinned), so briefs are testable and replayable.
Voters at a gate share one Brief — never per-voter recompilation.

### 5.2 Memory — three stores, strong policies

| Store | Form | Write policy | Read policy |
|---|---|---|---|
| **Episodic** | Replayable traces; compressed summary + pointer to full | Auto on Outcome; summarized at write time | Compiler pulls summaries; full trace only on demand |
| **Semantic** | Typed facts in SQLite | Provenance mandatory; confidence; **decay clock** — unrefreshed facts fade | Ranked by relevance × recency (provenance mandatory at write; repo-locality is intrinsic — the DB is per-overlay) |
| **Procedural** | SKILL.md library, realized as the `skills/` library | Only via the `distill` ratification path (proposal → human-reviewed move to live) | Progressive disclosure via the compiler's Brief skill index |

> **As-realized note (ratified 2026-06-11).** Procedural memory is **not** a
> store inside the memory faculty; it is realized as the `distill` tool (writes
> proposals to `skills/proposed/`), the human-reviewed PR that moves a proposal
> to the live `skills/` library, and the context compiler's skill index that
> reads it. The write and read halves are coherent and gated; the spec keeps
> the three-store *model* but the procedural store's mechanism is this, not a
> SQLite table. The "global + overlay" SKILL.md scoping (overlay-local skill
> overrides) is a deferred extension. Semantic ranking is relevance × recency:
> within a per-overlay DB every fact is already repo-local, so the original
> "× repo-locality" factor is intrinsic, and provenance is enforced at write
> rather than weighted at read.

No other memory types. The compounding loop: trace → distill → skill →
better Brief → better Outcome → better trace.

### 5.3 Gates — uniform Verdict emitters

Ship three: `vote` (panel from agent templates; **default 3 voters; 7 only at
plan ratification**; strategies: simple/super-majority, unanimous —
others return via claims), `quality` (typecheck/lint/test/coverage over a
workspace — mechanical, model-free; **security is covered out-of-band** rather
than as a per-child mechanical check, see note), `review` (adversarial diff
review with per-voter precision recorded into the fitness ledger — **advisory
tier until the v1 Epic-E promotion criterion is met**; the n=10 eval set and
labeling rubric port from v1 as the seed).

> **As-realized note (ratified 2026-06-11).** The quality gate ships
> typecheck/lint/test (coverage rides the test exit code); it does **not** run
> a per-child security scanner — no real local, model-free security tool exists
> to wire without violating "wiring-complete or absent," and running a scanner
> on every fan-out child would be prohibitively slow. Security is covered
> out-of-band instead: the dedicated `Security` CI workflow (gitleaks · `pnpm
> audit` · semgrep) on every push/PR, plus the review gate's adversarial
> `security` reviewer lens. A per-workspace security QualityCheck returns
> through a claim if a suitable local tool is adopted.

### 5.4 Workforce — configuration, not generation

An agent = manifest instantiated from a **template** (role prompt + skill set
+ model tier + budget slice). Ships with: PM (decomposes ratified plans into
child TaskContracts whose budgets must sum within the parent's), Coder,
Reviewer, Documenter, Researcher. The PM may compose bespoke specialists from
existing templates at `enforce`; **new templates** enter at `suggest` and are
ratified into the library. Fan-out parallelism is bounded by the parent
contract's budget — the kernel meters, the PM allocates.

> **As-realized note (2026-06-12).** `@kernloop/faculty-scrum` Increment 1 wires
> the GitHub-free foundation of agile/scrum program management [CLM-0096]: PM
> decomposition "one altitude up". `decomposeGoal` mirrors the workforce's
> `decomposePlan` exactly — parent-chain identity, the per-dimension budget-sum
> invariant, and the `suggest` ceiling clamp — but splits a program GOAL into an
> epic/story TaskContract tree, tagging each child with its program
> altitude/track/sprint as constraint tags. Those tags are a typed READER over
> the existing `constraints: string[]` (no new contract, no new field) —
> `altitude:` is the `epic|story|task` enum, and `track:`/`sprint:` are
> charset-restricted so they are safe as later labels [CLM-0095]. It is pure and
> model-free; the capability has no run-executor and is surfaced through the
> suggest-tier `kernloop program decompose` CLI as a PREVIEW that mutates nothing
> (no GitHub, no loop enforcement — those are later increments) and writes only a
> single `cli.program.decompose` audit event (goalChars, never the goal verbatim).

> **As-realized note (2026-06-12).** Increment 2 (emit) wires the GitHub
> emission edge [CLM-0098]: `kernloop program emit` re-decomposes the same tree
> and FILES each child node as a labeled GitHub issue through the EXISTING
> hardened `@kernloop/tracker` (no new `gh` seam). It is DRY-RUN FIRST: a real
> mutation happens ONLY at `tracker.tier: enforce` AND `--execute`; at `suggest`
> an `--execute` is refused and the op stays dry-run (never defaults upward). A
> #52 vote condition — the issue-spam guard — runs BEFORE any provider is built:
> emitting more than the limit (20) needs an explicit `--confirm-count N`
> matching the exact child count. The constraint-tag → label map lives in
> `@kernloop/faculty-scrum` as ONE table [CLM-0097] (`assign:agent.<t>` →
> `agent:<t>`; `altitude`/`track`/`sprint` pass through; free-form constraints
> emit no label), so the GitHub view and future loop routing cannot diverge; the
> faculty asserts each label against the tracker charset without importing the
> tracker (isolation). Emit is audited ONCE as `cli.program.emit` with
> counts/refs only — never the node goal/body verbatim. Native parent-child
> sub-issue LINKING is deferred to Increment 2b.

> **As-realized note (2026-06-12).** Increment 3a wires the program LEDGER
> [CLM-0099, CLM-0100]: a resumable, poll-driven, NO-daemon record of a
> decomposed program (root goal → story nodes) in a cross-session
> `.kernloop/programs.sqlite` (its own SQLite file at the CLI composition root,
> mirroring the job registry; parameterized queries only). `kernloop program
> create` decomposes the same parent/spec the preview/emit verbs do and records
> each child as a `planned` node; `status` reports the `planned/emitted/done`
> rollup; `advance` moves ONE node FORWARD-ONLY (`planned → emitted → done`) per
> CLI invocation — requiring the filed issue ref to reach `emitted`, rejecting a
> backward move or an unknown program/node as a clean exit 1. Each op is audited
> (`cli.program.{create,status,advance}`) with counts/ids only — never the goal
> verbatim. DEFERRED: GitHub-state RECONCILIATION (reading issue state back into
> the ledger, blocked on a tracker READ op) and auto-linking `program emit` into
> the ledger — this increment is the LOCAL ledger only.

### 5.5 Observer — telemetry and the self-issue loop

Consumes every Outcome and Verdict. Maintains the **tool/skill/template
fitness ledger** (invocations, success correlation, cost, last-used), the
per-voter precision series, cost-per-governed-decision, and drift signals.
Files issues at `suggest` tier into the overlay repo's tracker — including
issues about the system itself. Self-filed issues re-enter through the same
canonical loop as user work; there is no privileged self-modification path.

> **As-realized note (ratified 2026-06-12).** `lifecycleProposals` turns the
> fitness ledger + drift signals into **suggest-tier proposals** surfaced via
> the `observe` tool — *deprecate* a low-fitness/drifting capability (proposes a
> human review; demotes nothing, leaves the ladder + exploration floor
> untouched) and *distill* a high-fitness subject's most recent successful run
> into a skill (feeds the `distill` tool, human-PR to go live). It is a pure
> read that NEVER auto-acts (no gh write, no auto-distill, no auto-removal, no
> auto-merge) — the safe half of the compounding loop [CLM-0092].

> **As-realized note (2026-06-12).** The self-issue CLOSURE path is wired and
> gated [CLM-0094]. The faculty stays PURE — it proposes (`proposeIssue`, a DB
> write) and never holds a `gh`/subprocess seam. The `kernloop observer` CLI is
> the sole actor: `proposals` is a pure read of the live `lifecycleProposals`;
> `propose <n>` snapshots one into `observer_issues` (de-duped by title); `file
> <id>` routes through `@kernloop/tracker` and is DRY-RUN BY DEFAULT — it files a
> real issue ONLY at `tracker.tier: enforce` with `--execute` (a `--execute` at
> `suggest` is refused and stays dry-run; never defaults upward, spec §3.2), and
> on success records the tracker url back onto the proposal (`markIssueFiled`).
> Every acting op is audited (`cli.observer.<op>`) with a bounded body char
> count, never the body verbatim; the self-filed issue re-enters via the
> ordinary `run` loop — no privileged path, no auto-action.

### 5.6 Toolsmith — in the first build, caged

Per decision: ships in v2.0, under the strictest regime in the system.

- **Namespace:** all creations live in `workshop/*`, physically under the
  overlay (`.kernloop/workshop/`), never in kernel or faculty packages.
- **Birth requirements:** a tool spec must include a claim entry, an
  acceptance test, and a manifest *before* `forge` will build it. Forge runs
  generation and the tool's tests inside the Docker sandbox profile
  (no network by default; FS scoped to a scratch dir; declared mounts only).
- **Runtime:** workshop tools execute only in-sandbox; they cannot import
  kernel/faculty internals (enforced by package boundaries + a lint gate);
  they receive and emit contracts like everything else.
- **Ladder:** born at `suggest` (output proposed, not acted on) →
  `advisory` after N clean audited runs → `enforce` only with human
  ratification. Auto-decay: unused for the decay window → demoted →
  removal proposed (human-ratified, like all removals).
- **Cap:** ≤ 12 live workshop tools per overlay. At cap, forging requires
  retiring — scarcity forces consolidation and keeps tool-selection sharp.
- **Audit:** every build, test run, and invocation appends full provenance
  (spec hash, generator model, sandbox profile) to the chain.

### 5.7 Models — supply-side identity normalization

A small faculty (`faculty-models`) that turns a served model alias/id into a
normalized **`ModelIdentity`** — the SUPPLY dual of the `ModelRequirement`
demand (§8.4). `resolveIdentity` is a pure, layered lookup: a vendored
catalog snapshot (the models.dev pattern, models the adapters actually emit) →
a rule-parse of the canonical `provider/family-generation-variant` shape → an
honest UNKNOWN (family `unknown`, tier defaulted DOWN, all metadata `null`).
Every metadata field is nullable and carries a `resolvedBy: table | rule |
unknown` provenance; it never throws, never guesses cost/context, and makes no
cross-provider "newer-than" comparison (generation is an opaque label). The
loop records the normalized identity in Brief provenance so a report names the
real model class — or admits `unknown` (a harness-default pick) honestly. The
faculty acts at `observe` tier: it normalizes, it does not route or call a
model. **Discovery** (as-realized, ratified 2026-06-11): `kernloop models sync`
enumerates an endpoint's models via the stable public contracts — an
OpenAI-compatible `/v1/models` (reusing the §8.4 api adapter's env-only
secret + SSRF + timeout + no-leak handling) and ollama `/api/tags` — normalizes
each id through `resolveIdentity`, and persists a **machine-local** discovered
cache (gitignored) that `resolveIdentity` then consults. CLI adapters that
can't enumerate honestly declare so (curated static lists; kernloop never
parses another tool's private config). `models sync`/`list` are CLI verbs, not
a twelfth MCP tool. Live `models.dev` catalog enrichment remains deferred.

### 5.8 Day-one deferrals inside faculties

Research ships as a single Researcher template + a `research` skill pack —
not a faculty. Graph-engine checkpoint/resume ships; cross-machine anything
does not. Ollama adapter is `experimental` until claimed.

---

## 6. Layer 3 — The canonical loop

One blessed graph, declared as data, nodes wired to faculties:

```
Frame ──► Research ──► Plan ──► VOTE ◄──┐
                                  │ rejected + findings
                                  ├──────┘  (max K iterations, then human)
                                  ▼ approved (7-voter, plan ratification)
                            PM Decompose
                                  ▼
                    Fan-out: Coder ─ Documenter ─ Specialist…
                       each child: implement ──► quality gate ──► review gate
                                  ▼
                              Integrate
                                  ▼
                             Retrospect   (mandatory: Outcome → memory,
                                           distill candidates, Observer feed)
```

Properties: every edge carries a contract; every gate emits a Verdict; child
budgets are sliced from the parent and metered by adapters; per-node
checkpoints make any run resumable; the iterate-on-voter-feedback cycle is
bounded (K configurable, default 3) before escalating to the human. Overlays
may override nodes (swap a gate, add a specialist) — never duplicate the
graph.

---

## 7. The overlay — per-repo identity as data

`.kernloop/` committed with each repo:

```
.kernloop/
├── overlay.yaml        # gate thresholds, K, budgets, node overrides
├── claims/             # this repo's claims registry
├── memory.sqlite       # semantic + episodic summaries (repo-local)
├── skills/             # repo-specific + overridden skills
├── workshop/           # Toolsmith creations (≤12)
└── priors.yaml         # learned routing priors (exported, reviewable)
```

The system is installed once; repos differ only by overlay. Intuition travels
with `git clone`. Nothing in an overlay is executable outside the sandbox
except skills (which are instructions, not code). `kernloop init` scaffolds it;
`kernloop doctor` validates it.

---

## 8. Token & cost economics (structural, not aspirational)

1. Brief budgets with priority-drop — context cost is capped per task by
   contract, not by hope.
2. Skills over tools — capability index costs ~1 line until loaded.
3. Shared Brief per gate panel — one compile, n voters.
4. Tiered adapters — triage/read work on lean models, plan/vote/generation on
   capable ones; the demand is declared in manifests (see §8.4), the binding
   resolved at the loop composition root.
5. Trace summarization at write — episodic memory stores digests, not
   transcripts.
6. 3-voter default, 7 at ratification only.
7. `observe` answers "what does a governed decision cost" per gate type —
   the Epic-G requirement, native from day one.

### 8.4 Model requirements — two axes (as-realized, ratified 2026-06-11)

A component's model demand is a **`ModelRequirement`** — two orthogonal,
discrete axes plus capability filters, the industry-standard shape every major
harness exposes:

- **`tier`** = model class: `frontier | large | medium | small` (ordinal,
  default `medium`). `frontier` is the top (the cutting-edge model); the rest
  are the cross-vendor-neutral size ladder.
- **`effort`** = reasoning depth: `low | medium | high | xhigh` (ordinal,
  default `medium`) — the provider knob (OpenAI `reasoning_effort`, Anthropic
  `/effort`, Gemini thinking budget), declared **separately** from the model.
- **`capabilities`** = hard filters (`toolUse | vision | longContext |
  jsonMode`), AND-ed gates, not tier rungs.

Declared on the Manifest (`Manifest.model?`, the single source of truth for a
component) and on each loop node via the manifest/template it routes to.
Resolution is **at the loop composition root, not the Router** (the spec's §3.1
keeps the Router free of model-call concerns): a **pure kernel translation
seam** maps `(tier, effort)` against each adapter's declarative profile —
`tier → bound model/alias` degrading **downward only** to the nearest populated
tier, `effort → the adapter's literal` clamping to the nearest supported level
or **dropped** where a harness has no effort knob. Every degradation is
**recorded in provenance**, never silent (the prime directive); nothing is
synthesized upward. Each adapter (`harness-routed | concrete-id | api`)
declares its tier→model map, effort support, and capabilities as data, so a new
harness is a definition, not a code path. Volatile tier→concrete-model bindings
live in overlay/catalog config, not kernel code.

---

## 9. Repo structure

```
kernloop/                       # pnpm + turborepo, Node 22, MIT
├── packages/
│   ├── contracts/              # the frozen five + zod (≤800 LOC)
│   ├── kernel/                 # L0 (≤5k LOC)
│   ├── faculty-compiler/
│   ├── faculty-memory/
│   ├── faculty-gates/
│   ├── faculty-workforce/
│   ├── faculty-observer/
│   ├── faculty-toolsmith/
│   ├── faculty-models/         # model-identity normalization + vendored catalog
│   ├── workflows/              # canonical graph + engine
│   └── cli/                    # kernloop init/doctor/run/…
├── skills/                     # global skill library
├── claims/                     # system claims registry
├── AGENTS.md                   # agent charter (CLAUDE.md/GEMINI.md symlink to it)
└── .github/                    # gates below, from commit 1
```

**CI from commit 1:** `claims:check` (blocking) · drift check
(manifests ↔ docs ↔ AGENTS.md charter) · LOC budgets · coverage ≥80% · plugin-isolation lint ·
audit-chain verify on test artifacts · CODEOWNERS on `kernel/`, `contracts/`,
`claims/` requiring human review.

---

## 10. Porting queue (v1 as quarry)

Migrate only with tests + a passing claim, roughly in order: (1) audit hash
chain + verify, (2) adapter subprocess layer + metering, (3) consensus voter
role prompts + strategies-in-use, (4) review eval set n=10 + v5 labeling
lessons → Gate seed, (5) quality-gate runners, (6) graph checkpoint/resume,
(7) replay machinery → episodic memory substrate, (8) doctor/setup UX
patterns, (9) OutcomeStore schema → fitness ledger. Everything else stays in
the quarry until a claim pulls it.

---

## 11. Build phases & kill criterion

| Phase | Scope | Exit |
|---|---|---|
| **P0** (days) | contracts + claims registry + CI gates + audit chain | claims:check green on an empty-but-honest repo |
| **P1** | kernel + adapters + compiler + memory(episodic/semantic) + quality gate + `run/brief/gate/recall/remember/audit/observe/status/manifest` | one repo, one real task end-to-end through quality gate |
| **P2** | vote gate + workforce + canonical loop + overlay | full loop on a real feature in a real repo, checkpoint/resume proven |
| **P3** | review gate (advisory) + distill + **forge/Toolsmith** + Observer self-issue loop | a distilled skill and a forged workshop tool both born through gates |

**Build execution & self-hosting milestone:** P0–P2 are built by a
human-directed frontier agent (Fable) using the AGENTS.md fan-out protocol;
nexus-agents v1 serves only as read-only quarry and as ratification panel
(`consensus_vote`) until kernloop's own vote gate exists. **From P3 onward,
kernloop work is executed through kernloop itself** — self-hosting is a P3
exit property, not a bootstrap assumption. Execution is continuous and
phase-gated: P0 on main pre-ruleset; P1–P3 on phase branches whose exit PRs
(containing the phase report) are merged by the human — the merge is the
ratification. Claims population precedes implementation within every phase;
the registry is the backlog and the triage order.

**Kill criterion:** P0–P2 complete, claims:check continuously green, within
4–6 weeks at your actual pace. Miss it → stop, write the post-mortem, and
conclude the problem was never the repo.

---

## 12. Open items for ratification

1. ~~Final name~~ **RESOLVED: Kernloop.** Org: `kernloop` (claim immediately); scope `@kernloop`; binary `kernloop`; overlay `.kernloop/`; domain target kernloop.dev. `nexus-substrate` remains the historical home of v1.
2. K (vote-iterate bound) and workshop decay window defaults.
3. Which v1 consensus strategies count as "in use" for §5.3.
4. Whether overlays commit `memory.sqlite` or gitignore it with export/import
   (privacy vs. portability — recommend: gitignore + `kernloop memory export`).
