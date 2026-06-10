# Kernloop

[![CI](https://github.com/kernloop/kernloop/actions/workflows/ci.yml/badge.svg)](https://github.com/kernloop/kernloop/actions/workflows/ci.yml)

An **autonomic control plane for AI coding agents**, delivered as a local CLI +
MCP server. Kernloop does not write code itself; it makes the agents that write
code governed, observable, context-rich, and compounding.

Most of that sentence is **roadmap, not capability**. This repository's thesis
is that documentation never lies about behavior, so the line between the two is
machine-enforced: every capability statement below carries a claim ID from
[`claims/`](claims/), and the `claims:check` CI gate fails if a statement's
evidence does not resolve to real, passing tests. The one entry point (`run`),
adversarial review gates, and closed-loop self-tuning arrive in P1–P3 (see
[Roadmap](#roadmap)). What exists today is the verified foundation: the frozen
contracts, the claims registry and its gate, the audit chain, and CI that
blocks on all of them.

## Capabilities (P0, verified)

<!-- claims:begin -->

Kernloop's five contracts are zod-validated: malformed messages — missing fields, unknown enum values, wrong types, negative budgets — are rejected at parse time [CLM-0001].
The contract surface is frozen at exactly five types — TaskContract, Brief, Verdict, Outcome, Manifest — and references outside it are rejected [CLM-0004].
All five reject unknown top-level keys, so field drift fails loudly instead of passing silently [CLM-0006].
All five survive JSON round-trip serialization unchanged [CLM-0003].
The authority ladder is a closed four-tier enum — observe, suggest, advisory, enforce — and unknown tiers cannot enter the system [CLM-0002].
Manifests carry governance as data: authority tier, maturity, promotion thresholds, and claim references are schema-enforced [CLM-0005].

Every audit event is hash-chained, and a chain of appended events verifies end-to-end with its exact length [CLM-0009].
Every audit envelope carries the contracts version it was written under [CLM-0010].
A single flipped bit anywhere in a stored record is detected and attributed to its sequence number [CLM-0011].
Truncating, reordering, or deleting log entries fails verification [CLM-0012].
Tamper evidence is property-tested across seeded random chains [CLM-0013].

The documentation gate enforces itself: claims:check fails on dangling evidence [CLM-0007].
A claim marked verified without test evidence fails the gate [CLM-0008].

The event bus carries only the five contracts, rejects malformed messages at the boundary [CLM-0014], and applies backpressure instead of dropping events silently [CLM-0018].
The manifest registry is the single source of capability truth and rejects invalid manifests at registration [CLM-0015].
The authority ladder blocks any action above its manifest's tier or the task's ceiling [CLM-0016], and every tier transition is audited, with automatic demotion on threshold breach [CLM-0017].
Adapter subprocess calls capture all output, enforce wall-clock timeouts [CLM-0019], and meter every call honestly — measured duration always, tokens and dollars only when the CLI reports them [CLM-0020].
An unavailable model CLI is reported as unavailable, never stubbed [CLM-0021].
Semantic memory rejects writes without provenance [CLM-0022] and ranks recall by provenance and recency with a decay clock [CLM-0023].
Episodic memory persists each Outcome as a summary plus trace pointer, retrievable by task id [CLM-0024], in repo-local SQLite that functions empty if deleted [CLM-0025].
The router matches tasks to manifests by capability and budget [CLM-0026], never routes above the task's authority ceiling [CLM-0027], and guarantees demoted capabilities an exploration floor [CLM-0028].
The context compiler is deterministic — identical inputs produce byte-identical Briefs [CLM-0029] — with hard per-section token budgets, priority-ordered drop, and provenance on every section [CLM-0030].
The quality gate runs typecheck, lint, test, and coverage and emits structured, severity-tagged Verdicts [CLM-0031], every one appended to the audit chain [CLM-0032].
The MCP surface exposes exactly nine kernel tools in P1 — run, status, brief, gate, recall, remember, manifest, audit, observe — and nothing else [CLM-0033].
The run entry point routes a TaskContract via manifests and returns an Outcome with every routing decision audited [CLM-0034]; the audit tool queries and verifies the chain on demand [CLM-0035].
One real task has run end-to-end through the quality gate — Verdict, Outcome, and verifiable audit chain included [CLM-0036].

<!-- claims:end -->

## The claims registry

[`claims/registry/`](claims/registry/) holds one YAML file per claim: a
one-sentence statement, typed evidence references
(`test:<path>::<name>`, `ci:<job>`, `doc:<path>#<anchor>`, `eval:<artifact>`),
a status, an owner, and the version it landed in. `pnpm claims:check` verifies
that every evidence reference resolves and that every sentence in the
capabilities section above carries a claim tag. The registry is also the
backlog: no feature is implemented before its claim and acceptance test exist.

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

## Roadmap

| Phase         | Scope                                                                                | Exit criterion                                                  |
| ------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **P0** (this) | contracts + claims registry + CI gates + audit chain                                 | `claims:check` green on an empty-but-honest repo                |
| P1            | kernel (registry, router, ladder, bus) + adapters + compiler + memory + quality gate | one real task end-to-end through the quality gate               |
| P2            | vote gate + workforce + canonical loop + overlay                                     | full loop on a real feature, checkpoint/resume proven           |
| P3            | review gate + distill + Toolsmith + Observer self-issue loop                         | a distilled skill and a forged workshop tool born through gates |

The canonical design is [`docs/kernloop-kernel-spec.md`](docs/kernloop-kernel-spec.md);
the agent charter is [`AGENTS.md`](AGENTS.md). Architecture overview:
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## License

MIT — see [LICENSE](LICENSE). Ancestry: ported-by-evidence from
[nexus-agents v1](https://github.com/nexus-substrate/nexus-agents) per the
porting queue in the spec; see [NOTICE](NOTICE).
