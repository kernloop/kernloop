# Claims catalog

> DERIVED from `claims/registry/` by `pnpm claims:render` — every `[CLM-xxxx]` tag in
> the README links to a section here. Do not edit by hand; it is drift-checked in CI.

## CLM-0001

**Status:** verified — **source:** [`CLM-0001.yaml`](../claims/registry/CLM-0001.yaml)

Kernloop's five contracts are zod-validated: malformed messages — missing fields, unknown enum values, wrong types, negative budgets — are rejected at parse time.

**Enforced by:**

- [`packages/contracts/src/task-contract.test.ts`](../packages/contracts/src/task-contract.test.ts)
- [`packages/contracts/src/task-contract.test.ts`](../packages/contracts/src/task-contract.test.ts)
- [`packages/contracts/src/task-contract.test.ts`](../packages/contracts/src/task-contract.test.ts)
- [`packages/contracts/src/task-contract.test.ts`](../packages/contracts/src/task-contract.test.ts)
- CI `test`

## CLM-0002

**Status:** verified — **source:** [`CLM-0002.yaml`](../claims/registry/CLM-0002.yaml)

The authority ladder is a closed four-tier enum — observe, suggest, advisory, enforce — and any other tier value is rejected at parse time.

**Enforced by:**

- [`packages/contracts/src/common.test.ts`](../packages/contracts/src/common.test.ts)
- [`packages/contracts/src/common.test.ts`](../packages/contracts/src/common.test.ts)

## CLM-0003

**Status:** verified — **source:** [`CLM-0003.yaml`](../claims/registry/CLM-0003.yaml)

All five contracts survive JSON round-trip serialization: parsing the stringified form of a valid contract yields a value equal to the original.

**Enforced by:**

- [`packages/contracts/src/task-contract.test.ts`](../packages/contracts/src/task-contract.test.ts)
- [`packages/contracts/src/brief.test.ts`](../packages/contracts/src/brief.test.ts)
- [`packages/contracts/src/verdict.test.ts`](../packages/contracts/src/verdict.test.ts)
- [`packages/contracts/src/outcome.test.ts`](../packages/contracts/src/outcome.test.ts)
- [`packages/contracts/src/manifest.test.ts`](../packages/contracts/src/manifest.test.ts)

## CLM-0004

**Status:** verified — **source:** [`CLM-0004.yaml`](../claims/registry/CLM-0004.yaml)

The contract surface is frozen at exactly five types — TaskContract, Brief, Verdict, Outcome, Manifest — and references to any contract outside the five are rejected.

**Enforced by:**

- [`packages/contracts/src/index.test.ts`](../packages/contracts/src/index.test.ts)
- [`packages/contracts/src/index.test.ts`](../packages/contracts/src/index.test.ts)
- [`packages/contracts/src/common.test.ts`](../packages/contracts/src/common.test.ts)
- [`packages/contracts/src/common.test.ts`](../packages/contracts/src/common.test.ts)
- [`packages/contracts/src/manifest.test.ts`](../packages/contracts/src/manifest.test.ts)

## CLM-0005

**Status:** verified — **source:** [`CLM-0005.yaml`](../claims/registry/CLM-0005.yaml)

Manifests carry governance as data: authority tier, maturity, optional promotion threshold, and claim references are schema-enforced, with unknown tiers and malformed claim ids rejected at parse time.

**Enforced by:**

- [`packages/contracts/src/manifest.test.ts`](../packages/contracts/src/manifest.test.ts)
- [`packages/contracts/src/manifest.test.ts`](../packages/contracts/src/manifest.test.ts)
- [`packages/contracts/src/manifest.test.ts`](../packages/contracts/src/manifest.test.ts)
- [`packages/contracts/src/manifest.test.ts`](../packages/contracts/src/manifest.test.ts)

## CLM-0006

**Status:** verified — **source:** [`CLM-0006.yaml`](../claims/registry/CLM-0006.yaml)

All five contracts reject unknown top-level keys, so field drift fails at parse time instead of passing silently across the bus.

**Enforced by:**

- [`packages/contracts/src/task-contract.test.ts`](../packages/contracts/src/task-contract.test.ts)
- [`packages/contracts/src/brief.test.ts`](../packages/contracts/src/brief.test.ts)
- [`packages/contracts/src/verdict.test.ts`](../packages/contracts/src/verdict.test.ts)
- [`packages/contracts/src/outcome.test.ts`](../packages/contracts/src/outcome.test.ts)
- [`packages/contracts/src/manifest.test.ts`](../packages/contracts/src/manifest.test.ts)

## CLM-0007

**Status:** verified — **source:** [`CLM-0007.yaml`](../claims/registry/CLM-0007.yaml)

claims:check fails on dangling evidence — a test ref naming a nonexistent test, a CI ref naming a nonexistent job, a doc ref with a missing anchor, or an eval ref pointing at a missing artifact each exit the gate red.

**Enforced by:**

- [`claims/src/check.test.ts`](../claims/src/check.test.ts)
- [`claims/src/check.test.ts`](../claims/src/check.test.ts)
- [`claims/src/check.test.ts`](../claims/src/check.test.ts)
- [`claims/src/check.test.ts`](../claims/src/check.test.ts)

## CLM-0008

**Status:** verified — **source:** [`CLM-0008.yaml`](../claims/registry/CLM-0008.yaml)

A claim marked verified without at least one test evidence ref fails claims:check.

**Enforced by:**

- [`claims/src/check.test.ts`](../claims/src/check.test.ts)

## CLM-0009

**Status:** verified — **source:** [`CLM-0009.yaml`](../claims/registry/CLM-0009.yaml)

Every audit event is hash-chained: a chain of appended events verifies end-to-end with its exact length.

**Enforced by:**

- [`packages/kernel/src/audit/chain.test.ts`](../packages/kernel/src/audit/chain.test.ts)

## CLM-0010

**Status:** verified — **source:** [`CLM-0010.yaml`](../claims/registry/CLM-0010.yaml)

Every audit envelope carries the contracts surface version it was written under.

**Enforced by:**

- [`packages/kernel/src/audit/chain.test.ts`](../packages/kernel/src/audit/chain.test.ts)

## CLM-0011

**Status:** verified — **source:** [`CLM-0011.yaml`](../claims/registry/CLM-0011.yaml)

A bit flipped in a stored audit record is detected and attributed to its sequence number (exhaustive single-byte coverage is CLM-0013).

**Enforced by:**

- [`packages/kernel/src/audit/chain.test.ts`](../packages/kernel/src/audit/chain.test.ts)

## CLM-0012

**Status:** verified — **source:** [`CLM-0012.yaml`](../claims/registry/CLM-0012.yaml)

Truncating, reordering, or deleting audit log entries fails verification.

**Enforced by:**

- [`packages/kernel/src/audit/chain.test.ts`](../packages/kernel/src/audit/chain.test.ts)
- [`packages/kernel/src/audit/chain.test.ts`](../packages/kernel/src/audit/chain.test.ts)
- [`packages/kernel/src/audit/chain.test.ts`](../packages/kernel/src/audit/chain.test.ts)

## CLM-0013

**Status:** verified — **source:** [`CLM-0013.yaml`](../claims/registry/CLM-0013.yaml)

Tamper evidence is property-tested: across seeded random chains, every sampled single-byte mutation of the audit log file fails verification.

**Enforced by:**

- [`packages/kernel/src/audit/property.test.ts`](../packages/kernel/src/audit/property.test.ts)
- [`packages/kernel/src/audit/property.test.ts`](../packages/kernel/src/audit/property.test.ts)

## CLM-0014

**Status:** verified — **source:** [`CLM-0014.yaml`](../claims/registry/CLM-0014.yaml)

The event bus delivers only the five frozen contracts: publishing a malformed or unknown message type is rejected at the boundary.

**Enforced by:**

- [`packages/kernel/src/bus/event-bus.test.ts`](../packages/kernel/src/bus/event-bus.test.ts)
- [`packages/kernel/src/bus/event-bus.test.ts`](../packages/kernel/src/bus/event-bus.test.ts)
- [`packages/kernel/src/bus/event-bus.test.ts`](../packages/kernel/src/bus/event-bus.test.ts)

## CLM-0015

**Status:** verified — **source:** [`CLM-0015.yaml`](../claims/registry/CLM-0015.yaml)

The manifest registry rejects invalid manifests at registration and is the single source of capability truth for lookup.

**Enforced by:**

- [`packages/kernel/src/registry/manifest-registry.test.ts`](../packages/kernel/src/registry/manifest-registry.test.ts)
- [`packages/kernel/src/registry/manifest-registry.test.ts`](../packages/kernel/src/registry/manifest-registry.test.ts)
- [`packages/kernel/src/registry/manifest-registry.test.ts`](../packages/kernel/src/registry/manifest-registry.test.ts)
- [`packages/kernel/src/registry/manifest-registry.test.ts`](../packages/kernel/src/registry/manifest-registry.test.ts)

## CLM-0016

**Status:** verified — **source:** [`CLM-0016.yaml`](../claims/registry/CLM-0016.yaml)

The ladder blocks any routed action whose required tier exceeds the manifest's tier or the task's authorityCeiling.

**Enforced by:**

- [`packages/kernel/src/ladder/ladder.test.ts`](../packages/kernel/src/ladder/ladder.test.ts)
- [`packages/kernel/src/ladder/ladder.test.ts`](../packages/kernel/src/ladder/ladder.test.ts)
- [`packages/kernel/src/ladder/ladder.test.ts`](../packages/kernel/src/ladder/ladder.test.ts)

## CLM-0017

**Status:** verified — **source:** [`CLM-0017.yaml`](../claims/registry/CLM-0017.yaml)

Every tier transition (promotion, demotion) is recorded to the audit chain; demotion on threshold breach is automatic.

**Enforced by:**

- [`packages/kernel/src/ladder/ladder.test.ts`](../packages/kernel/src/ladder/ladder.test.ts)
- [`packages/kernel/src/ladder/ladder.test.ts`](../packages/kernel/src/ladder/ladder.test.ts)
- [`packages/kernel/src/ladder/ladder.test.ts`](../packages/kernel/src/ladder/ladder.test.ts)
- [`packages/kernel/src/ladder/ladder.test.ts`](../packages/kernel/src/ladder/ladder.test.ts)

## CLM-0018

**Status:** verified — **source:** [`CLM-0018.yaml`](../claims/registry/CLM-0018.yaml)

The event bus applies backpressure when a subscriber's queue is full rather than dropping events silently.

**Enforced by:**

- [`packages/kernel/src/bus/event-bus.test.ts`](../packages/kernel/src/bus/event-bus.test.ts)
- [`packages/kernel/src/bus/event-bus.test.ts`](../packages/kernel/src/bus/event-bus.test.ts)
- [`packages/kernel/src/bus/event-bus.test.ts`](../packages/kernel/src/bus/event-bus.test.ts)

## CLM-0019

**Status:** verified — **source:** [`CLM-0019.yaml`](../claims/registry/CLM-0019.yaml)

Adapter subprocess calls capture stdout, stderr, and exit code, and enforce wall-clock timeouts.

**Enforced by:**

- [`packages/kernel/src/adapters/subprocess.test.ts`](../packages/kernel/src/adapters/subprocess.test.ts)
- [`packages/kernel/src/adapters/subprocess.test.ts`](../packages/kernel/src/adapters/subprocess.test.ts)
- [`packages/kernel/src/adapters/subprocess.test.ts`](../packages/kernel/src/adapters/subprocess.test.ts)
- [`packages/kernel/src/adapters/subprocess.test.ts`](../packages/kernel/src/adapters/subprocess.test.ts)
- [`packages/kernel/src/adapters/subprocess.test.ts`](../packages/kernel/src/adapters/subprocess.test.ts)
- [`packages/kernel/src/adapters/invoke.test.ts`](../packages/kernel/src/adapters/invoke.test.ts)
- CI `test`

## CLM-0020

**Status:** verified — **source:** [`CLM-0020.yaml`](../claims/registry/CLM-0020.yaml)

Every adapter call is metered — tokens, usd, and duration — and reported in the contracts Cost shape.

**Enforced by:**

- [`packages/kernel/src/adapters/invoke.test.ts`](../packages/kernel/src/adapters/invoke.test.ts)
- [`packages/kernel/src/adapters/definitions.test.ts`](../packages/kernel/src/adapters/definitions.test.ts)
- [`packages/kernel/src/adapters/definitions.test.ts`](../packages/kernel/src/adapters/definitions.test.ts)
- [`packages/kernel/src/adapters/definitions.test.ts`](../packages/kernel/src/adapters/definitions.test.ts)
- CI `test`

## CLM-0021

**Status:** verified — **source:** [`CLM-0021.yaml`](../claims/registry/CLM-0021.yaml)

Adapters expose one uniform interface across model CLIs; an unavailable CLI is reported as unavailable, never stubbed.

**Enforced by:**

- [`packages/kernel/src/adapters/definitions.test.ts`](../packages/kernel/src/adapters/definitions.test.ts)
- [`packages/kernel/src/adapters/definitions.test.ts`](../packages/kernel/src/adapters/definitions.test.ts)
- [`packages/kernel/src/adapters/invoke.test.ts`](../packages/kernel/src/adapters/invoke.test.ts)
- [`packages/kernel/src/adapters/invoke.test.ts`](../packages/kernel/src/adapters/invoke.test.ts)
- CI `test`

## CLM-0022

**Status:** verified — **source:** [`CLM-0022.yaml`](../claims/registry/CLM-0022.yaml)

Semantic memory rejects writes without provenance.

**Enforced by:**

- [`packages/faculty-memory/src/semantic.test.ts`](../packages/faculty-memory/src/semantic.test.ts)
- [`packages/faculty-memory/src/semantic.test.ts`](../packages/faculty-memory/src/semantic.test.ts)
- [`packages/faculty-memory/src/semantic.test.ts`](../packages/faculty-memory/src/semantic.test.ts)
- CI `test`

## CLM-0023

**Status:** verified — **source:** [`CLM-0023.yaml`](../claims/registry/CLM-0023.yaml)

Semantic recall ranks facts by relevance and recency with a decay clock — an unrefreshed older fact ranks below a fresher equally-relevant one; provenance is mandatory at write.

**Enforced by:**

- [`packages/faculty-memory/src/semantic.test.ts`](../packages/faculty-memory/src/semantic.test.ts)
- [`packages/faculty-memory/src/semantic.test.ts`](../packages/faculty-memory/src/semantic.test.ts)
- [`packages/faculty-memory/src/semantic.test.ts`](../packages/faculty-memory/src/semantic.test.ts)
- CI `test`

## CLM-0024

**Status:** verified — **source:** [`CLM-0024.yaml`](../claims/registry/CLM-0024.yaml)

Episodic memory persists each Outcome as a summary plus a pointer to the full trace, retrievable by task id.

**Enforced by:**

- [`packages/faculty-memory/src/episodic.test.ts`](../packages/faculty-memory/src/episodic.test.ts)
- [`packages/faculty-memory/src/episodic.test.ts`](../packages/faculty-memory/src/episodic.test.ts)
- [`packages/faculty-memory/src/episodic.test.ts`](../packages/faculty-memory/src/episodic.test.ts)
- [`packages/faculty-memory/src/episodic.ts#recordOutcome`](../packages/faculty-memory/src/episodic.ts)
- CI `test`

## CLM-0025

**Status:** verified — **source:** [`CLM-0025.yaml`](../claims/registry/CLM-0025.yaml)

Memory state is repo-local SQLite; deleting the database file leaves the system functional with empty memory. The store opens in WAL journal mode with a 5s busy timeout (#157), so a stateless CLI reader (status/observe/metrics) reads the last committed snapshot concurrently with the resident `serve` writer — even while the writer holds an open transaction — without a SQLITE_BUSY.

**Enforced by:**

- [`packages/faculty-memory/src/store.test.ts`](../packages/faculty-memory/src/store.test.ts)
- [`packages/faculty-memory/src/store.test.ts`](../packages/faculty-memory/src/store.test.ts)
- [`packages/faculty-memory/src/store.test.ts`](../packages/faculty-memory/src/store.test.ts)
- [`packages/faculty-memory/src/store.test.ts`](../packages/faculty-memory/src/store.test.ts)
- CI `test`

## CLM-0026

**Status:** verified — **source:** [`CLM-0026.yaml`](../claims/registry/CLM-0026.yaml)

The router matches a TaskContract to manifests by capability and budget, and returns the routing decision without executing when asked to plan only.

**Enforced by:**

- [`packages/kernel/src/router/router.test.ts`](../packages/kernel/src/router/router.test.ts)
- [`packages/kernel/src/router/router.test.ts`](../packages/kernel/src/router/router.test.ts)
- [`packages/kernel/src/router/router.test.ts`](../packages/kernel/src/router/router.test.ts)
- [`packages/kernel/src/router/router.test.ts`](../packages/kernel/src/router/router.test.ts)
- [`packages/kernel/src/router/router.test.ts`](../packages/kernel/src/router/router.test.ts)

## CLM-0027

**Status:** verified — **source:** [`CLM-0027.yaml`](../claims/registry/CLM-0027.yaml)

The router never routes to a manifest whose tier exceeds the task's authorityCeiling.

**Enforced by:**

- [`packages/kernel/src/router/router.test.ts`](../packages/kernel/src/router/router.test.ts)
- [`packages/kernel/src/router/exploration.test.ts`](../packages/kernel/src/router/exploration.test.ts)

## CLM-0028

**Status:** verified — **source:** [`CLM-0028.yaml`](../claims/registry/CLM-0028.yaml)

A floor of exploration traffic guarantees demoted-but-registered capabilities still receive routing consideration.

**Enforced by:**

- [`packages/kernel/src/router/exploration.test.ts`](../packages/kernel/src/router/exploration.test.ts)
- [`packages/kernel/src/router/exploration.test.ts`](../packages/kernel/src/router/exploration.test.ts)
- [`packages/kernel/src/router/router.ts#EXPLORATION_EPSILON`](../packages/kernel/src/router/router.ts)

## CLM-0029

**Status:** verified — **source:** [`CLM-0029.yaml`](../claims/registry/CLM-0029.yaml)

The context compiler is deterministic: identical inputs produce byte-identical Briefs under a pinned compiler version.

**Enforced by:**

- [`packages/faculty-compiler/src/compile.test.ts`](../packages/faculty-compiler/src/compile.test.ts)
- [`packages/faculty-compiler/src/compile.test.ts`](../packages/faculty-compiler/src/compile.test.ts)
- [`packages/faculty-compiler/src/compile.test.ts`](../packages/faculty-compiler/src/compile.test.ts)
- CI `test`

## CLM-0030

**Status:** verified — **source:** [`CLM-0030.yaml`](../claims/registry/CLM-0030.yaml)

Brief sections respect hard token budgets with priority-ordered drop, and every section carries provenance.

**Enforced by:**

- [`packages/faculty-compiler/src/budget.test.ts`](../packages/faculty-compiler/src/budget.test.ts)
- [`packages/faculty-compiler/src/budget.test.ts`](../packages/faculty-compiler/src/budget.test.ts)
- [`packages/faculty-compiler/src/budget.test.ts`](../packages/faculty-compiler/src/budget.test.ts)
- [`packages/faculty-compiler/src/compile.test.ts`](../packages/faculty-compiler/src/compile.test.ts)
- CI `test`

## CLM-0031

**Status:** verified — **source:** [`CLM-0031.yaml`](../claims/registry/CLM-0031.yaml)

The quality gate runs typecheck, lint, test, and coverage over a workspace and emits a structured Verdict with severity-tagged findings.

**Enforced by:**

- [`packages/faculty-gates/src/run.test.ts`](../packages/faculty-gates/src/run.test.ts)
- [`packages/faculty-gates/src/run.test.ts`](../packages/faculty-gates/src/run.test.ts)
- [`packages/faculty-gates/src/run.test.ts`](../packages/faculty-gates/src/run.test.ts)
- [`packages/faculty-gates/src/run.test.ts`](../packages/faculty-gates/src/run.test.ts)
- [`packages/faculty-gates/src/run.test.ts`](../packages/faculty-gates/src/run.test.ts)
- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/faculty-gates/src/integration.test.ts`](../packages/faculty-gates/src/integration.test.ts)
- CI `test`

## CLM-0032

**Status:** verified — **source:** [`CLM-0032.yaml`](../claims/registry/CLM-0032.yaml)

Every quality-gate Verdict appends to the audit chain.

**Enforced by:**

- [`packages/cli/src/tools/gate.test.ts`](../packages/cli/src/tools/gate.test.ts)
- [`packages/cli/src/tools/gate.test.ts`](../packages/cli/src/tools/gate.test.ts)
- [`packages/cli/src/tools/gate.test.ts`](../packages/cli/src/tools/gate.test.ts)
- CI `test`

## CLM-0033

**Status:** verified — **source:** [`CLM-0033.yaml`](../claims/registry/CLM-0033.yaml)

The MCP surface exposes exactly the kernel eleven — run, status, brief, gate, recall, remember, distill, forge, manifest, audit, observe — and nothing else.

**Enforced by:**

- [`packages/cli/src/mcp.test.ts`](../packages/cli/src/mcp.test.ts)
- [`packages/cli/src/mcp.test.ts`](../packages/cli/src/mcp.test.ts)
- [`packages/cli/src/mcp.test.ts`](../packages/cli/src/mcp.test.ts)
- [`packages/cli/src/mcp.test.ts`](../packages/cli/src/mcp.test.ts)
- CI `test`

## CLM-0034

**Status:** verified — **source:** [`CLM-0034.yaml`](../claims/registry/CLM-0034.yaml)

The run entry point routes a TaskContract via manifests and returns an Outcome, with every routing decision audited.

**Enforced by:**

- [`packages/cli/src/tools/run.test.ts`](../packages/cli/src/tools/run.test.ts)
- [`packages/cli/src/tools/run.test.ts`](../packages/cli/src/tools/run.test.ts)
- [`packages/cli/src/tools/run.test.ts`](../packages/cli/src/tools/run.test.ts)
- [`packages/cli/src/tools/run.test.ts`](../packages/cli/src/tools/run.test.ts)
- [`packages/cli/src/tools/run.test.ts`](../packages/cli/src/tools/run.test.ts)
- CI `test`

## CLM-0035

**Status:** verified — **source:** [`CLM-0035.yaml`](../claims/registry/CLM-0035.yaml)

The audit tool queries events and verifies the chain on demand.

**Enforced by:**

- [`packages/cli/src/tools/audit.test.ts`](../packages/cli/src/tools/audit.test.ts)
- [`packages/cli/src/tools/audit.test.ts`](../packages/cli/src/tools/audit.test.ts)
- [`packages/cli/src/tools/audit.test.ts`](../packages/cli/src/tools/audit.test.ts)
- [`packages/cli/src/tools/audit.test.ts`](../packages/cli/src/tools/audit.test.ts)
- CI `test`

## CLM-0036

**Status:** verified — **source:** [`CLM-0036.yaml`](../claims/registry/CLM-0036.yaml)

One real task runs end-to-end through the quality gate, producing a Verdict, an Outcome, and a verifiable audit chain.

**Enforced by:**

- [`packages/cli/src/e2e.test.ts`](../packages/cli/src/e2e.test.ts)
- [`packages/cli/src/e2e.test.ts`](../packages/cli/src/e2e.test.ts)
- CI `test`

## CLM-0037

**Status:** verified — **source:** [`CLM-0037.yaml`](../claims/registry/CLM-0037.yaml)

The vote gate aggregates a panel of voters into one Verdict under simple-majority, super-majority, or unanimous strategies — three voters by default, seven at plan ratification.

**Enforced by:**

- [`packages/faculty-gates/src/vote/strategies.test.ts`](../packages/faculty-gates/src/vote/strategies.test.ts)
- [`packages/faculty-gates/src/vote/strategies.test.ts`](../packages/faculty-gates/src/vote/strategies.test.ts)
- [`packages/faculty-gates/src/vote/strategies.test.ts`](../packages/faculty-gates/src/vote/strategies.test.ts)
- [`packages/faculty-gates/src/vote/strategies.test.ts`](../packages/faculty-gates/src/vote/strategies.test.ts)
- [`packages/faculty-gates/src/vote/strategies.test.ts`](../packages/faculty-gates/src/vote/strategies.test.ts)
- [`packages/faculty-gates/src/vote/run.test.ts`](../packages/faculty-gates/src/vote/run.test.ts)
- [`packages/faculty-gates/src/vote/run.test.ts`](../packages/faculty-gates/src/vote/run.test.ts)
- [`packages/faculty-gates/src/vote/run.test.ts`](../packages/faculty-gates/src/vote/run.test.ts)
- CI `test`

## CLM-0038

**Status:** verified — **source:** [`CLM-0038.yaml`](../claims/registry/CLM-0038.yaml)

Every voter's vote and reasoning is recorded as a VoterRecord, feeding the per-voter precision series.

**Enforced by:**

- [`packages/faculty-gates/src/vote/run.test.ts`](../packages/faculty-gates/src/vote/run.test.ts)
- [`packages/faculty-gates/src/vote/run.test.ts`](../packages/faculty-gates/src/vote/run.test.ts)
- [`packages/faculty-gates/src/vote/run.test.ts`](../packages/faculty-gates/src/vote/run.test.ts)
- CI `test`

## CLM-0039

**Status:** verified — **source:** [`CLM-0039.yaml`](../claims/registry/CLM-0039.yaml)

Voters on one gate panel share a single compiled Brief — one compile, n voters.

**Enforced by:**

- [`packages/faculty-gates/src/vote/run.test.ts`](../packages/faculty-gates/src/vote/run.test.ts)
- CI `test`

## CLM-0040

**Status:** verified — **source:** [`CLM-0040.yaml`](../claims/registry/CLM-0040.yaml)

Workforce agents are configuration, not generation: PM, Coder, Reviewer, Documenter, and Researcher templates instantiate as manifests, and new templates enter at suggest tier.

**Enforced by:**

- [`packages/faculty-workforce/src/instantiate.test.ts`](../packages/faculty-workforce/src/instantiate.test.ts)
- [`packages/faculty-workforce/src/instantiate.test.ts`](../packages/faculty-workforce/src/instantiate.test.ts)
- [`packages/faculty-workforce/src/instantiate.test.ts`](../packages/faculty-workforce/src/instantiate.test.ts)
- CI `test`

## CLM-0041

**Status:** verified — **source:** [`CLM-0041.yaml`](../claims/registry/CLM-0041.yaml)

The PM decomposes a ratified plan into child TaskContracts whose budgets must sum within the parent's budget — a static decompose-time invariant on the declared budget, independent of the run's budget-enforcement mode (the runtime enforce/unlimited halt is CLM-0077).

**Enforced by:**

- [`packages/faculty-workforce/src/decompose.test.ts`](../packages/faculty-workforce/src/decompose.test.ts)
- [`packages/faculty-workforce/src/decompose.test.ts`](../packages/faculty-workforce/src/decompose.test.ts)
- [`packages/faculty-workforce/src/decompose.test.ts`](../packages/faculty-workforce/src/decompose.test.ts)
- [`packages/faculty-workforce/src/decompose.test.ts`](../packages/faculty-workforce/src/decompose.test.ts)
- CI `test`

## CLM-0042

**Status:** verified — **source:** [`CLM-0042.yaml`](../claims/registry/CLM-0042.yaml)

The canonical loop is declared as data: every edge carries a contract and every gate node emits a Verdict.

**Enforced by:**

- [`packages/workflows/src/graph.test.ts`](../packages/workflows/src/graph.test.ts)
- [`packages/workflows/src/graph.test.ts`](../packages/workflows/src/graph.test.ts)
- [`packages/workflows/src/graph.test.ts`](../packages/workflows/src/graph.test.ts)
- [`packages/workflows/src/graph.test.ts`](../packages/workflows/src/graph.test.ts)
- [`packages/workflows/src/overrides.test.ts`](../packages/workflows/src/overrides.test.ts)
- [`packages/workflows/src/overrides.test.ts`](../packages/workflows/src/overrides.test.ts)
- [`packages/workflows/src/overrides.test.ts`](../packages/workflows/src/overrides.test.ts)
- [`packages/workflows/src/graph.ts#CANONICAL_LOOP`](../packages/workflows/src/graph.ts)
- CI `test`

## CLM-0043

**Status:** verified — **source:** [`CLM-0043.yaml`](../claims/registry/CLM-0043.yaml)

The vote-iterate cycle is bounded at K iterations (default 3) before escalating to the human; and the child fan-out re-runs implement on a quality reject, bounded by Kc (default 3), folding the gate findings into the coder prompt — at the Kc/budget bound the child escalates without failing the sibling children or the whole run, and each re-iteration is audited. A sub-gate that drives re-iteration (quality always; review/parsimony when promoted to enforce) re-runs the child BEFORE the cursor reaches the child's LATER sub-gates, so a rejected pass spends no downstream sub-gate model call (e.g. a review-driven reject skips the trailing parsimony gate on that pass, #427).

**Enforced by:**

- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- [`packages/workflows/src/resume.test.ts`](../packages/workflows/src/resume.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- [`packages/cli/src/loop-iteration.test.ts`](../packages/cli/src/loop-iteration.test.ts)
- [`packages/cli/src/loop.test.ts`](../packages/cli/src/loop.test.ts)
- CI `test`

## CLM-0044

**Status:** verified — **source:** [`CLM-0044.yaml`](../claims/registry/CLM-0044.yaml)

Per-node checkpoints make any run resumable: a run killed mid-loop resumes from its last checkpoint and completes.

**Enforced by:**

- [`packages/workflows/src/resume.test.ts`](../packages/workflows/src/resume.test.ts)
- [`packages/workflows/src/resume.test.ts`](../packages/workflows/src/resume.test.ts)
- [`packages/workflows/src/resume.test.ts`](../packages/workflows/src/resume.test.ts)
- [`packages/workflows/src/resume.test.ts`](../packages/workflows/src/resume.test.ts)
- [`packages/workflows/src/checkpoints.test.ts`](../packages/workflows/src/checkpoints.test.ts)
- [`packages/workflows/src/checkpoints.test.ts`](../packages/workflows/src/checkpoints.test.ts)
- CI `test`

## CLM-0045

**Status:** verified — **source:** [`CLM-0045.yaml`](../claims/registry/CLM-0045.yaml)

A repo overlay overrides gate thresholds, K, budgets, and loop nodes as data — never by duplicating the graph.

**Enforced by:**

- [`packages/workflows/src/overrides.test.ts`](../packages/workflows/src/overrides.test.ts)
- [`packages/workflows/src/overrides.test.ts`](../packages/workflows/src/overrides.test.ts)
- [`packages/workflows/src/overrides.test.ts`](../packages/workflows/src/overrides.test.ts)
- [`packages/workflows/src/overrides.test.ts`](../packages/workflows/src/overrides.test.ts)
- [`packages/workflows/src/overrides.test.ts`](../packages/workflows/src/overrides.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- CI `test`

## CLM-0046

**Status:** verified — **source:** [`CLM-0046.yaml`](../claims/registry/CLM-0046.yaml)

The full canonical loop has run on a real feature in a real repository, end to end through vote and quality gates.

**Enforced by:**

- [`evals/p2-live-run/audit.jsonl`](../evals/p2-live-run/audit.jsonl)
- [`evals/p2-live-run/checkpoints.jsonl`](../evals/p2-live-run/checkpoints.jsonl)
- [`scripts/__tests__/p3-exit-proof.test.mjs`](../scripts/__tests__/p3-exit-proof.test.mjs)
- [`packages/cli/src/loop.test.ts`](../packages/cli/src/loop.test.ts)
- [`packages/cli/src/loop.test.ts`](../packages/cli/src/loop.test.ts)
- [`packages/cli/src/loop.test.ts`](../packages/cli/src/loop.test.ts)
- [`packages/cli/src/loop.test.ts`](../packages/cli/src/loop.test.ts)
- CI `test`

## CLM-0047

**Status:** verified — **source:** [`CLM-0047.yaml`](../claims/registry/CLM-0047.yaml)

The review gate performs adversarial diff review at advisory tier, and every voter's precision is recorded into the fitness ledger.

**Enforced by:**

- [`packages/faculty-gates/src/review/run.test.ts`](../packages/faculty-gates/src/review/run.test.ts)
- [`packages/faculty-gates/src/review/run.test.ts`](../packages/faculty-gates/src/review/run.test.ts)
- [`packages/faculty-gates/src/review/run.test.ts`](../packages/faculty-gates/src/review/run.test.ts)
- [`packages/faculty-gates/src/review/run.test.ts`](../packages/faculty-gates/src/review/run.test.ts)
- [`packages/faculty-gates/src/review/manifest.test.ts`](../packages/faculty-gates/src/review/manifest.test.ts)
- CI `test`

## CLM-0048

**Status:** verified — **source:** [`CLM-0048.yaml`](../claims/registry/CLM-0048.yaml)

Review-gate calibration is measured against the labeled n=10 eval set ported from v1.

**Enforced by:**

- [`packages/faculty-gates/src/review/eval-set.test.ts`](../packages/faculty-gates/src/review/eval-set.test.ts)
- [`packages/faculty-gates/src/review/eval-set.test.ts`](../packages/faculty-gates/src/review/eval-set.test.ts)
- [`packages/faculty-gates/src/review/calibrate.test.ts`](../packages/faculty-gates/src/review/calibrate.test.ts)
- [`packages/faculty-gates/src/review/calibrate.test.ts`](../packages/faculty-gates/src/review/calibrate.test.ts)
- [`packages/faculty-gates/src/review/calibrate.test.ts`](../packages/faculty-gates/src/review/calibrate.test.ts)
- CI `test`

## CLM-0049

**Status:** verified — **source:** [`CLM-0049.yaml`](../claims/registry/CLM-0049.yaml)

Distill proposes a SKILL.md from an episodic trace, entering the ladder at suggest tier.

**Enforced by:**

- [`packages/cli/src/distill.test.ts`](../packages/cli/src/distill.test.ts)
- [`packages/cli/src/distill.test.ts`](../packages/cli/src/distill.test.ts)
- [`packages/cli/src/distill.test.ts`](../packages/cli/src/distill.test.ts)
- [`packages/cli/src/distill.test.ts`](../packages/cli/src/distill.test.ts)
- [`packages/cli/src/cli.test.ts`](../packages/cli/src/cli.test.ts)
- [`packages/cli/src/cli.test.ts`](../packages/cli/src/cli.test.ts)
- CI `test`

## CLM-0050

**Status:** verified — **source:** [`CLM-0050.yaml`](../claims/registry/CLM-0050.yaml)

Skills enter the procedural library only through the distill ratification path.

**Enforced by:**

- [`packages/cli/src/distill.test.ts`](../packages/cli/src/distill.test.ts)
- [`packages/cli/src/distill.test.ts`](../packages/cli/src/distill.test.ts)
- [`packages/cli/src/distill.test.ts`](../packages/cli/src/distill.test.ts)
- [`packages/cli/src/distill.test.ts`](../packages/cli/src/distill.test.ts)
- [`packages/cli/src/gather.test.ts`](../packages/cli/src/gather.test.ts)
- CI `test`

## CLM-0051

**Status:** verified — **source:** [`CLM-0051.yaml`](../claims/registry/CLM-0051.yaml)

Forge refuses to build a workshop tool unless its spec carries a claim entry, an acceptance test, and a manifest first.

**Enforced by:**

- [`packages/faculty-toolsmith/src/forge.test.ts`](../packages/faculty-toolsmith/src/forge.test.ts)
- [`packages/faculty-toolsmith/src/forge.test.ts`](../packages/faculty-toolsmith/src/forge.test.ts)
- [`packages/faculty-toolsmith/src/forge.test.ts`](../packages/faculty-toolsmith/src/forge.test.ts)
- [`packages/faculty-toolsmith/src/forge.test.ts`](../packages/faculty-toolsmith/src/forge.test.ts)
- [`packages/faculty-toolsmith/src/forge.test.ts`](../packages/faculty-toolsmith/src/forge.test.ts)
- [`packages/faculty-toolsmith/src/forge.test.ts`](../packages/faculty-toolsmith/src/forge.test.ts)
- CI `test`

## CLM-0052

**Status:** verified — **source:** [`CLM-0052.yaml`](../claims/registry/CLM-0052.yaml)

Workshop tools are generated and tested only inside the sandbox profile — no network by default, filesystem scoped to a scratch directory.

**Enforced by:**

- [`packages/faculty-toolsmith/src/sandbox.docker.test.ts`](../packages/faculty-toolsmith/src/sandbox.docker.test.ts)
- [`packages/faculty-toolsmith/src/sandbox.docker.test.ts`](../packages/faculty-toolsmith/src/sandbox.docker.test.ts)
- [`packages/faculty-toolsmith/src/sandbox.test.ts`](../packages/faculty-toolsmith/src/sandbox.test.ts)
- [`packages/faculty-toolsmith/src/sandbox.test.ts`](../packages/faculty-toolsmith/src/sandbox.test.ts)
- [`packages/faculty-toolsmith/src/forge.test.ts`](../packages/faculty-toolsmith/src/forge.test.ts)
- [`packages/faculty-toolsmith/src/forge.docker.test.ts`](../packages/faculty-toolsmith/src/forge.docker.test.ts)
- [`packages/faculty-toolsmith/src/forge.docker.test.ts`](../packages/faculty-toolsmith/src/forge.docker.test.ts)
- [`packages/faculty-toolsmith/src/sandbox.test.ts`](../packages/faculty-toolsmith/src/sandbox.test.ts)
- [`packages/faculty-toolsmith/src/sandbox.test.ts`](../packages/faculty-toolsmith/src/sandbox.test.ts)
- CI `test`

## CLM-0053

**Status:** verified — **source:** [`CLM-0053.yaml`](../claims/registry/CLM-0053.yaml)

Workshop tools live under the workshop namespace, cannot import kernel or faculty internals, and are capped at twelve per overlay — at cap, forging requires retiring.

**Enforced by:**

- [`packages/faculty-toolsmith/src/workshop.test.ts`](../packages/faculty-toolsmith/src/workshop.test.ts)
- [`packages/faculty-toolsmith/src/forge.docker.test.ts`](../packages/faculty-toolsmith/src/forge.docker.test.ts)
- [`packages/faculty-toolsmith/src/forge.test.ts`](../packages/faculty-toolsmith/src/forge.test.ts)
- [`packages/faculty-toolsmith/src/workshop.test.ts`](../packages/faculty-toolsmith/src/workshop.test.ts)
- [`packages/faculty-toolsmith/src/workshop.test.ts`](../packages/faculty-toolsmith/src/workshop.test.ts)
- CI `test`

## CLM-0054

**Status:** verified — **source:** [`CLM-0054.yaml`](../claims/registry/CLM-0054.yaml)

Workshop tools are born at suggest, reach advisory only after N clean audited runs, reach enforce only with human ratification, and decay toward removal when unused.

**Enforced by:**

- [`packages/faculty-toolsmith/src/lifecycle.test.ts`](../packages/faculty-toolsmith/src/lifecycle.test.ts)
- [`packages/faculty-toolsmith/src/lifecycle.test.ts`](../packages/faculty-toolsmith/src/lifecycle.test.ts)
- [`packages/faculty-toolsmith/src/lifecycle.test.ts`](../packages/faculty-toolsmith/src/lifecycle.test.ts)
- [`packages/faculty-toolsmith/src/lifecycle.test.ts`](../packages/faculty-toolsmith/src/lifecycle.test.ts)
- [`packages/faculty-toolsmith/src/lifecycle.test.ts`](../packages/faculty-toolsmith/src/lifecycle.test.ts)
- CI `test`

## CLM-0055

**Status:** verified — **source:** [`CLM-0055.yaml`](../claims/registry/CLM-0055.yaml)

The Observer maintains the fitness ledger — invocations, success correlation, cost, recency — and the per-voter precision series.

**Enforced by:**

- [`packages/faculty-observer/src/ledger.test.ts`](../packages/faculty-observer/src/ledger.test.ts)
- [`packages/faculty-observer/src/ledger.test.ts`](../packages/faculty-observer/src/ledger.test.ts)
- [`packages/faculty-observer/src/voters.test.ts`](../packages/faculty-observer/src/voters.test.ts)
- [`packages/faculty-observer/src/voters.test.ts`](../packages/faculty-observer/src/voters.test.ts)
- CI `test`

## CLM-0056

**Status:** verified — **source:** [`CLM-0056.yaml`](../claims/registry/CLM-0056.yaml)

The Observer PROPOSES self-issues about the system itself at suggest tier — persisted in its own observer_issues table, never auto-filed. FILING is a separate, human-ratified, enforce-tier-gated action routed through the tracker via the kernloop observer CLI (dry-run by default); the faculty stays pure (no subprocess, no gh seam) and only markIssueFiled records the tracker url back onto a proposal. Self-filed issues re-enter the canonical loop with no privileged path.

**Enforced by:**

- [`packages/faculty-observer/src/issues.test.ts`](../packages/faculty-observer/src/issues.test.ts)
- [`packages/faculty-observer/src/issues.test.ts`](../packages/faculty-observer/src/issues.test.ts)
- [`packages/faculty-observer/src/issues.test.ts`](../packages/faculty-observer/src/issues.test.ts)
- [`packages/faculty-observer/src/issues.test.ts`](../packages/faculty-observer/src/issues.test.ts)
- [`packages/faculty-observer/src/index.test.ts`](../packages/faculty-observer/src/index.test.ts)
- [`packages/cli/src/observer-commands.test.ts`](../packages/cli/src/observer-commands.test.ts)
- [`packages/cli/src/observer-commands.test.ts`](../packages/cli/src/observer-commands.test.ts)
- CI `test`

## CLM-0057

**Status:** verified — **source:** [`CLM-0057.yaml`](../claims/registry/CLM-0057.yaml)

A distilled skill and a forged workshop tool have both been born through gates.

**Enforced by:**

- [`scripts/__tests__/p3-exit-proof.test.mjs`](../scripts/__tests__/p3-exit-proof.test.mjs)
- [`scripts/__tests__/p3-exit-proof.test.mjs`](../scripts/__tests__/p3-exit-proof.test.mjs)
- [`scripts/__tests__/p3-exit-proof.test.mjs`](../scripts/__tests__/p3-exit-proof.test.mjs)
- [`scripts/__tests__/p3-exit-proof.test.mjs`](../scripts/__tests__/p3-exit-proof.test.mjs)
- [`.kernloop/workshop/loc-probe/tool.mjs`](../.kernloop/workshop/loc-probe/tool.mjs)
- [`skills/run-quality-gate-via-kernel/SKILL.md`](../skills/run-quality-gate-via-kernel/SKILL.md)
- [`evals/p3-exit/audit.jsonl`](../evals/p3-exit/audit.jsonl)
- [`scripts/__tests__/p3-exit-proof.test.mjs`](../scripts/__tests__/p3-exit-proof.test.mjs)
- [`scripts/__tests__/p3-exit-proof.test.mjs`](../scripts/__tests__/p3-exit-proof.test.mjs)

## CLM-0058

**Status:** verified — **source:** [`CLM-0058.yaml`](../claims/registry/CLM-0058.yaml)

Distill and forge complete the MCP surface at exactly the kernel eleven.

**Enforced by:**

- [`packages/cli/src/mcp.test.ts`](../packages/cli/src/mcp.test.ts)
- [`packages/cli/src/mcp.test.ts`](../packages/cli/src/mcp.test.ts)
- [`packages/cli/src/mcp.test.ts`](../packages/cli/src/mcp.test.ts)
- [`packages/cli/src/mcp.test.ts`](../packages/cli/src/mcp.test.ts)
- CI `test`

## CLM-0059

**Status:** verified — **source:** [`CLM-0059.yaml`](../claims/registry/CLM-0059.yaml)

Files written by the canonical loop cannot escape the workspace directory, including through a pre-existing symlink — whether the symlink is a parent directory component OR the TARGET file itself (the write opens with O_NOFOLLOW, so a symlinked leaf is refused, never followed, #161).

**Enforced by:**

- [`packages/cli/src/loop/invoke.test.ts`](../packages/cli/src/loop/invoke.test.ts)
- [`packages/cli/src/loop/invoke.test.ts`](../packages/cli/src/loop/invoke.test.ts)
- [`packages/cli/src/loop/invoke.test.ts`](../packages/cli/src/loop/invoke.test.ts)
- [`packages/cli/src/loop/invoke.test.ts`](../packages/cli/src/loop/invoke.test.ts)
- [`packages/cli/src/loop/invoke.test.ts`](../packages/cli/src/loop/invoke.test.ts)
- CI `test`

## CLM-0060

**Status:** verified — **source:** [`CLM-0060.yaml`](../claims/registry/CLM-0060.yaml)

No incompleteness marker — a TODO/FIXME/XXX/HACK comment, a "not implemented" string, or a stub-throwing literal — survives in shipped package source; the wiring-complete rule is gated by a marker scan, not just asserted.

**Enforced by:**

- [`scripts/__tests__/wiring-check.test.mjs`](../scripts/__tests__/wiring-check.test.mjs)
- [`scripts/__tests__/wiring-check.test.mjs`](../scripts/__tests__/wiring-check.test.mjs)
- [`scripts/__tests__/wiring-check.test.mjs`](../scripts/__tests__/wiring-check.test.mjs)
- [`scripts/__tests__/wiring-check.test.mjs`](../scripts/__tests__/wiring-check.test.mjs)
- [`scripts/__tests__/wiring-check.test.mjs`](../scripts/__tests__/wiring-check.test.mjs)
- CI `test`

## CLM-0061

**Status:** verified — **source:** [`CLM-0061.yaml`](../claims/registry/CLM-0061.yaml)

Kernel source outside the adapters module cannot originate a model call: a bare call, namespace member call, or named import of the adapter primitives (invokeAdapter, runSubprocess) is a lint error.

**Enforced by:**

- [`scripts/__tests__/kernel-no-intelligence-rule.test.mjs`](../scripts/__tests__/kernel-no-intelligence-rule.test.mjs)
- CI `test`

## CLM-0062

**Status:** verified — **source:** [`CLM-0062.yaml`](../claims/registry/CLM-0062.yaml)

No plugin imports another plugin: the isolation lint rejects static, deep, relative-escape, and dynamic-faculty-prefix cross-plugin imports.

**Enforced by:**

- [`scripts/__tests__/isolation-rule.test.mjs`](../scripts/__tests__/isolation-rule.test.mjs)
- CI `test`

## CLM-0063

**Status:** verified — **source:** [`CLM-0063.yaml`](../claims/registry/CLM-0063.yaml)

File, function, and per-package LOC budgets are CI-enforced: an over-budget package and an over-length file both fail the gate.

**Enforced by:**

- [`scripts/__tests__/loc-check.test.mjs`](../scripts/__tests__/loc-check.test.mjs)
- [`scripts/__tests__/loc-check.test.mjs`](../scripts/__tests__/loc-check.test.mjs)
- [`scripts/__tests__/loc-check.test.mjs`](../scripts/__tests__/loc-check.test.mjs)
- [`scripts/__tests__/file-loc-gate.test.mjs`](../scripts/__tests__/file-loc-gate.test.mjs)
- [`scripts/__tests__/file-loc-gate.test.mjs`](../scripts/__tests__/file-loc-gate.test.mjs)
- CI `test`

## CLM-0064

**Status:** verified — **source:** [`CLM-0064.yaml`](../claims/registry/CLM-0064.yaml)

The canonical loop runs a review gate per child after the quality gate (implement then quality then review). BY DEFAULT the review Verdict is advisory, audited, and does not drive re-iteration or block integration; it drives child re-iteration ONLY when the review gate is promoted to enforce via a ratified ladder transition (per-overlay, never a default).

**Enforced by:**

- [`packages/workflows/src/graph.test.ts`](../packages/workflows/src/graph.test.ts)
- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- [`packages/cli/src/kernel.test.ts`](../packages/cli/src/kernel.test.ts)
- CI `test`

## CLM-0066

**Status:** verified — **source:** [`CLM-0066.yaml`](../claims/registry/CLM-0066.yaml)

A research skill pack ships in the global skill library, so the Researcher template's research skill reference resolves.

**Enforced by:**

- [`scripts/__tests__/research-skill.test.mjs`](../scripts/__tests__/research-skill.test.mjs)
- [`scripts/__tests__/research-skill.test.mjs`](../scripts/__tests__/research-skill.test.mjs)
- [`skills/research/SKILL.md`](../skills/research/SKILL.md)
- CI `test`

## CLM-0067

**Status:** verified — **source:** [`CLM-0067.yaml`](../claims/registry/CLM-0067.yaml)

The loop's research node invokes the Researcher template through the model seam, folding gathered findings into the Brief as a provenance-tagged section.

**Enforced by:**

- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- CI `test`

## CLM-0069

**Status:** verified — **source:** [`CLM-0069.yaml`](../claims/registry/CLM-0069.yaml)

Semantic facts and episodic trace summaries export to a portable JSON document and re-import loss-free, so an overlay's memory can travel with the repo.

**Enforced by:**

- [`packages/faculty-memory/src/export.test.ts`](../packages/faculty-memory/src/export.test.ts)
- [`packages/faculty-memory/src/export.test.ts`](../packages/faculty-memory/src/export.test.ts)
- [`packages/faculty-memory/src/export.test.ts`](../packages/faculty-memory/src/export.test.ts)
- [`packages/faculty-memory/src/export.test.ts`](../packages/faculty-memory/src/export.test.ts)
- [`packages/cli/src/tools/portability.test.ts`](../packages/cli/src/tools/portability.test.ts)
- [`packages/cli/src/tools/portability.test.ts`](../packages/cli/src/tools/portability.test.ts)
- CI `test`

## CLM-0070

**Status:** verified — **source:** [`CLM-0070.yaml`](../claims/registry/CLM-0070.yaml)

Learned routing priors export to a reviewable .kernloop/priors.yaml from the Observer fitness ledger.

**Enforced by:**

- [`packages/faculty-observer/src/priors.test.ts`](../packages/faculty-observer/src/priors.test.ts)
- [`packages/faculty-observer/src/priors.test.ts`](../packages/faculty-observer/src/priors.test.ts)
- [`packages/faculty-observer/src/priors.test.ts`](../packages/faculty-observer/src/priors.test.ts)
- [`packages/cli/src/tools/portability.test.ts`](../packages/cli/src/tools/portability.test.ts)
- [`packages/cli/src/tools/portability.test.ts`](../packages/cli/src/tools/portability.test.ts)
- CI `test`

## CLM-0071

**Status:** verified — **source:** [`CLM-0071.yaml`](../claims/registry/CLM-0071.yaml)

A born workshop tool is invocable: it runs in the ratified sandbox against a stdin contract JSON, emits a stdout contract JSON, and every invocation is audited.

**Enforced by:**

- [`packages/faculty-toolsmith/src/run.docker.test.ts`](../packages/faculty-toolsmith/src/run.docker.test.ts)
- [`packages/faculty-toolsmith/src/run.test.ts`](../packages/faculty-toolsmith/src/run.test.ts)
- [`packages/faculty-toolsmith/src/run.test.ts`](../packages/faculty-toolsmith/src/run.test.ts)
- [`packages/cli/src/tools/workshop.test.ts`](../packages/cli/src/tools/workshop.test.ts)
- [`packages/cli/src/cli.workshop.docker.test.ts`](../packages/cli/src/cli.workshop.docker.test.ts)
- CI `test`

## CLM-0072

**Status:** verified — **source:** [`CLM-0072.yaml`](../claims/registry/CLM-0072.yaml)

Workshop tools earn promotion through use: N clean audited invocations move a tool from suggest to advisory, and `kernloop workshop sweep` decays unused tools toward removal.

**Enforced by:**

- [`packages/faculty-toolsmith/src/run.docker.test.ts`](../packages/faculty-toolsmith/src/run.docker.test.ts)
- [`packages/faculty-toolsmith/src/run.docker.test.ts`](../packages/faculty-toolsmith/src/run.docker.test.ts)
- [`packages/cli/src/tools/workshop.test.ts`](../packages/cli/src/tools/workshop.test.ts)
- [`packages/cli/src/tools/workshop.test.ts`](../packages/cli/src/tools/workshop.test.ts)
- CI `test`

## CLM-0073

**Status:** verified — **source:** [`CLM-0073.yaml`](../claims/registry/CLM-0073.yaml)

Every run is recorded in a persisted job registry, and status resolves a job id to its state — running, done, or failed — cross-session from a fresh process over the same overlay.

**Enforced by:**

- [`packages/cli/src/jobs.test.ts`](../packages/cli/src/jobs.test.ts)
- [`packages/cli/src/jobs.test.ts`](../packages/cli/src/jobs.test.ts)
- [`packages/cli/src/tools/status.test.ts`](../packages/cli/src/tools/status.test.ts)
- [`packages/cli/src/tools/status.test.ts`](../packages/cli/src/tools/status.test.ts)
- [`packages/cli/src/tools/run.test.ts`](../packages/cli/src/tools/run.test.ts)
- CI `test`

## CLM-0074

**Status:** verified — **source:** [`CLM-0074.yaml`](../claims/registry/CLM-0074.yaml)

run --async returns a job id immediately and runs the work in the resident process, recording the terminal state to the job registry — a failed background run is recorded as failed, never an unhandled rejection.

**Enforced by:**

- [`packages/cli/src/tools/run.test.ts`](../packages/cli/src/tools/run.test.ts)
- [`packages/cli/src/tools/run.test.ts`](../packages/cli/src/tools/run.test.ts)
- CI `test`

## CLM-0076

**Status:** verified — **source:** [`CLM-0076.yaml`](../claims/registry/CLM-0076.yaml)

A component's model demand is a two-axis ModelRequirement — model tier (frontier > large > medium > small) and reasoning effort (low < medium < high < xhigh) plus required capabilities — with sensible defaults, strict about unknown axes, declared on the Manifest and the five workforce templates, superseding the shipped cheap|frontier tiering.

**Enforced by:**

- [`packages/contracts/src/model.test.ts`](../packages/contracts/src/model.test.ts)
- [`packages/contracts/src/model.test.ts`](../packages/contracts/src/model.test.ts)
- [`packages/contracts/src/model.test.ts`](../packages/contracts/src/model.test.ts)
- [`packages/contracts/src/model.test.ts`](../packages/contracts/src/model.test.ts)
- [`packages/contracts/src/model.test.ts`](../packages/contracts/src/model.test.ts)
- [`packages/contracts/src/model.test.ts`](../packages/contracts/src/model.test.ts)
- [`packages/contracts/src/manifest.test.ts`](../packages/contracts/src/manifest.test.ts)
- [`packages/faculty-workforce/src/templates.test.ts`](../packages/faculty-workforce/src/templates.test.ts)
- [`packages/faculty-workforce/src/templates.test.ts`](../packages/faculty-workforce/src/templates.test.ts)
- CI `test`

## CLM-0077

**Status:** verified — **source:** [`CLM-0077.yaml`](../claims/registry/CLM-0077.yaml)

Budget enforcement is a run-level MODE, not a contract change: in enforce mode (default) a run whose metered spend exceeds its parent budget escalates and halts (resumable) rather than silently continuing; in unlimited mode the budget never halts the run, but usage and cost are STILL metered and reported identically, and the run is recorded honestly as having run without budget enforcement. HONESTY at the metering boundary (#462): a `usd` budget can only be enforced on an adapter that reports per-call dollar cost (`metersUsd: true` — claude via `total_cost_usd`); a CLI adapter that reports only tokens or nothing (codex/agy/opencode/ollama, `metersUsd: false`) would read $0 spend, so an enforce-mode run with a usd budget on such an adapter has a SILENTLY-INERT cap. Rather than lie, the run AUDITS `cli.budget.usd-unenforceable` (rule 7) — surfacing the degradation, not failing closed. The audit reason reflects REALITY per adapter via the companion `metersTokens` fact: codex/opencode meter TOKENS (so the token budget still bounds the run), but agy/ollama meter NEITHER usd NOR tokens (`metersTokens: false`) — for those, BOTH budgets are inert and only wallClock + the Kc iteration cap bound the run, which the audit states honestly rather than falsely claiming a token budget applies. `metersUsd`/`metersTokens` are single-sourced per-adapter facts on the kernel adapter definition. The SAME inert-cap class is surfaced for a registered ENDPOINT (#470): an endpoint with `metersUsd: false` (the default) reports $0 and applies no ceiling, so a usd budget on it is equally inert — the audit fires with `metersTokens: null` (an endpoint meters tokens only when its 2xx returns OpenAI-compatible `usage.*`, which is runtime-dependent, so the reason says so honestly rather than asserting a static fact); a `metersUsd: true` endpoint keeps its own fail-closed handling (#393). The audit is GATED to the `workflow.canonical` capability (#469): only the canonical loop wires the runtime budget guard and makes adapter model calls, so only there is a usd budget actually consulted — a non-loop capability (memory read / gate.quality / brief.compile) consults no budget, and auditing it inert would be a misleading record, exactly the lie this audit exists to prevent. Beyond the durable audit, the degradation is ALSO surfaced as a VISIBLE `warn` finding on the run result (#463) — prepended to the canonical-loop Outcome/escalation findings — so an operator who set a $-cap sees at decision time that it is not enforced, rather than only on later inspection of the audit log. The endpoint membership check is structurally sound (#474): the registered-endpoint map is NULL-PROTOTYPE, so a prototype-inherited adapter name (`constructor`, `toString`, …) reads `undefined` rather than an inherited member and is treated as an unknown adapter — it does NOT emit a false inert-cap audit for a nonexistent endpoint. The static metersUsd/metersTokens facts are guarded against silent DRIFT (#464): the opt-in `adapters:smoke` harness compares each adapter's static facts to a real call's RUNTIME metered flags and FAILS on divergence — so a CLI output-format change (e.g. claude dropping cost, agy starting to report tokens) cannot leave the static fact stale while cost silently reads $0; the pure `meteringDrift` comparator is unit-tested.

**Enforced by:**

- [`scripts/__tests__/metering-drift.test.mjs`](../scripts/__tests__/metering-drift.test.mjs)
- [`scripts/__tests__/metering-drift.test.mjs`](../scripts/__tests__/metering-drift.test.mjs)
- [`scripts/__tests__/metering-drift.test.mjs`](../scripts/__tests__/metering-drift.test.mjs)
- [`packages/cli/src/tools/run-budget-honesty.test.ts`](../packages/cli/src/tools/run-budget-honesty.test.ts)
- [`packages/cli/src/endpoints.test.ts`](../packages/cli/src/endpoints.test.ts)
- [`packages/cli/src/tools/run-budget-honesty.test.ts`](../packages/cli/src/tools/run-budget-honesty.test.ts)
- [`packages/cli/src/tools/run-budget-honesty.test.ts`](../packages/cli/src/tools/run-budget-honesty.test.ts)
- [`packages/cli/src/tools/run-budget-honesty.test.ts`](../packages/cli/src/tools/run-budget-honesty.test.ts)
- [`packages/kernel/src/adapters/definitions.test.ts`](../packages/kernel/src/adapters/definitions.test.ts)
- [`packages/kernel/src/adapters/definitions.test.ts`](../packages/kernel/src/adapters/definitions.test.ts)
- [`packages/cli/src/tools/run-budget-honesty.test.ts`](../packages/cli/src/tools/run-budget-honesty.test.ts)
- [`packages/cli/src/tools/run-budget-honesty.test.ts`](../packages/cli/src/tools/run-budget-honesty.test.ts)
- [`packages/cli/src/tools/run-budget-honesty.test.ts`](../packages/cli/src/tools/run-budget-honesty.test.ts)
- [`packages/cli/src/loop-iteration.test.ts`](../packages/cli/src/loop-iteration.test.ts)
- [`packages/cli/src/tools/run-budget-honesty.test.ts`](../packages/cli/src/tools/run-budget-honesty.test.ts)
- [`packages/cli/src/tools/run-budget-honesty.test.ts`](../packages/cli/src/tools/run-budget-honesty.test.ts)
- [`packages/workflows/src/child-budget.test.ts`](../packages/workflows/src/child-budget.test.ts)
- [`packages/workflows/src/child-budget.test.ts`](../packages/workflows/src/child-budget.test.ts)
- [`packages/workflows/src/child-budget.test.ts`](../packages/workflows/src/child-budget.test.ts)
- [`packages/cli/src/loop-iteration.test.ts`](../packages/cli/src/loop-iteration.test.ts)
- [`packages/cli/src/loop-iteration.test.ts`](../packages/cli/src/loop-iteration.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/cli/src/cli.test.ts`](../packages/cli/src/cli.test.ts)
- [`packages/cli/src/cli.test.ts`](../packages/cli/src/cli.test.ts)
- CI `test`

## CLM-0078

**Status:** verified — **source:** [`CLM-0078.yaml`](../claims/registry/CLM-0078.yaml)

Each model-calling loop node derives its ModelRequirement from the single template/manifest it routes to — no parallel map — and the composition root resolves that to the served adapter, model alias, effort arg, and per-call invoke TIMEOUT (via the overlay's per-tier adapter map and invokeTimeoutMs base — defaulting to the run adapter and a 15-min generative budget, capped shorter for the lighter nodes, #127). This binding holds on BOTH seam paths — the default CLI/api seam and the INJECTED seam the MCP-sampling run uses (#142), so a slow host model gets the node's real budget, not the MCP SDK's 60s request default. Then it names the served model+effort and any degradation in the node's Brief/Outcome provenance, and ATTRIBUTES that node's metered spend to the serving adapter in the run cost's `byAdapter` breakdown, so a tiered run's spend is observable per adapter (#44).

**Enforced by:**

- [`packages/cli/src/loop/node-model.test.ts`](../packages/cli/src/loop/node-model.test.ts)
- [`packages/cli/src/loop/node-model.test.ts`](../packages/cli/src/loop/node-model.test.ts)
- [`packages/cli/src/loop/node-model.test.ts`](../packages/cli/src/loop/node-model.test.ts)
- [`packages/cli/src/loop/node-model.test.ts`](../packages/cli/src/loop/node-model.test.ts)
- [`packages/cli/src/loop/node-model.test.ts`](../packages/cli/src/loop/node-model.test.ts)
- [`packages/cli/src/loop/node-resolve.test.ts`](../packages/cli/src/loop/node-resolve.test.ts)
- [`packages/cli/src/loop/node-resolve.test.ts`](../packages/cli/src/loop/node-resolve.test.ts)
- [`packages/cli/src/loop/node-resolve.test.ts`](../packages/cli/src/loop/node-resolve.test.ts)
- [`packages/cli/src/loop/node-resolve.test.ts`](../packages/cli/src/loop/node-resolve.test.ts)
- [`packages/cli/src/loop/node-seam.test.ts`](../packages/cli/src/loop/node-seam.test.ts)
- [`packages/cli/src/loop/node-seam.test.ts`](../packages/cli/src/loop/node-seam.test.ts)
- [`packages/cli/src/loop/invoke.test.ts`](../packages/cli/src/loop/invoke.test.ts)
- [`packages/cli/src/loop.test.ts`](../packages/cli/src/loop.test.ts)
- [`packages/cli/src/loop/node-seam.test.ts`](../packages/cli/src/loop/node-seam.test.ts)
- [`packages/cli/src/loop/node-resolve.test.ts`](../packages/cli/src/loop/node-resolve.test.ts)
- [`packages/cli/src/loop/node-resolve.test.ts`](../packages/cli/src/loop/node-resolve.test.ts)
- [`packages/cli/src/loop/node-model.test.ts`](../packages/cli/src/loop/node-model.test.ts)
- [`packages/cli/src/loop/node-model.test.ts`](../packages/cli/src/loop/node-model.test.ts)
- [`packages/cli/src/loop/node-seam.test.ts`](../packages/cli/src/loop/node-seam.test.ts)
- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- CI `test`

## CLM-0079

**Status:** verified — **source:** [`CLM-0079.yaml`](../claims/registry/CLM-0079.yaml)

The kernel translates a ModelRequirement against an adapter's declarative profile by a PURE fail-closed lookup — tier resolves to the bound model, degrading DOWNWARD only to the nearest populated tier and recording it; effort maps to the adapter's literal, clamping to the nearest supported level or dropping honestly when the adapter has none — synthesizing nothing.

**Enforced by:**

- [`packages/kernel/src/adapters/translate.test.ts`](../packages/kernel/src/adapters/translate.test.ts)
- [`packages/kernel/src/adapters/translate.test.ts`](../packages/kernel/src/adapters/translate.test.ts)
- [`packages/kernel/src/adapters/translate.test.ts`](../packages/kernel/src/adapters/translate.test.ts)
- [`packages/kernel/src/adapters/translate.test.ts`](../packages/kernel/src/adapters/translate.test.ts)
- [`packages/kernel/src/adapters/translate.test.ts`](../packages/kernel/src/adapters/translate.test.ts)
- [`packages/kernel/src/adapters/translate.test.ts`](../packages/kernel/src/adapters/translate.test.ts)
- [`packages/kernel/src/adapters/translate.test.ts`](../packages/kernel/src/adapters/translate.test.ts)
- [`packages/kernel/src/adapters/translate.test.ts`](../packages/kernel/src/adapters/translate.test.ts)
- [`packages/kernel/src/adapters/translate.test.ts`](../packages/kernel/src/adapters/translate.test.ts)
- [`packages/kernel/src/adapters/definitions.test.ts`](../packages/kernel/src/adapters/definitions.test.ts)
- CI `test`

## CLM-0080

**Status:** verified — **source:** [`CLM-0080.yaml`](../claims/registry/CLM-0080.yaml)

resolveIdentity normalizes a served model alias/id into a ModelIdentity by a pure, layered, honest lookup against a vendored offline catalog — a table hit yields full metadata, a well-formed uncatalogued id is rule-parsed with null metadata, and garbage or the empty string resolves to unknown with its tier defaulted DOWN to small — never throwing, never guessing metadata, and treating generation as an opaque label with no cross-provider arithmetic.

**Enforced by:**

- [`packages/faculty-models/src/resolve.test.ts`](../packages/faculty-models/src/resolve.test.ts)
- [`packages/faculty-models/src/resolve.test.ts`](../packages/faculty-models/src/resolve.test.ts)
- [`packages/faculty-models/src/resolve.test.ts`](../packages/faculty-models/src/resolve.test.ts)
- [`packages/faculty-models/src/resolve.test.ts`](../packages/faculty-models/src/resolve.test.ts)
- [`packages/faculty-models/src/resolve.test.ts`](../packages/faculty-models/src/resolve.test.ts)
- [`packages/faculty-models/src/resolve.test.ts`](../packages/faculty-models/src/resolve.test.ts)
- [`packages/faculty-models/src/resolve.test.ts`](../packages/faculty-models/src/resolve.test.ts)
- [`packages/faculty-models/src/resolve.test.ts`](../packages/faculty-models/src/resolve.test.ts)
- [`packages/faculty-models/src/resolve.test.ts`](../packages/faculty-models/src/resolve.test.ts)
- [`packages/faculty-models/src/catalog.test.ts`](../packages/faculty-models/src/catalog.test.ts)
- [`packages/faculty-models/src/catalog.test.ts`](../packages/faculty-models/src/catalog.test.ts)
- [`packages/faculty-models/src/manifest.test.ts`](../packages/faculty-models/src/manifest.test.ts)
- CI `test`

## CLM-0081

**Status:** verified — **source:** [`CLM-0081.yaml`](../claims/registry/CLM-0081.yaml)

The canonical loop records the NORMALIZED served model identity — the real model class behind the served alias, named family, generation, tier, and resolvedBy — in each model-calling node's provenance alongside the raw served ref, admitting an honest unknown for a harness-default node where kernloop pinned no model.

**Enforced by:**

- [`packages/cli/src/loop/node-seam.test.ts`](../packages/cli/src/loop/node-seam.test.ts)
- [`packages/cli/src/loop/node-seam.test.ts`](../packages/cli/src/loop/node-seam.test.ts)
- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- CI `test`

## CLM-0082

**Status:** verified — **source:** [`CLM-0082.yaml`](../claims/registry/CLM-0082.yaml)

The OpenAI-compatible HTTP adapter POSTs a single assembled prompt to a configured endpoint's /chat/completions, reads choices[0].message.content as the output, and meters honestly from the response usage — prompt+completion tokens when present, usage.cost or usage.total_cost as usd when present, else metered false — never fabricating a figure.

**Enforced by:**

- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- CI `test`

## CLM-0083

**Status:** verified — **source:** [`CLM-0083.yaml`](../claims/registry/CLM-0083.yaml)

An api endpoint's secret is held env-only: the adapter reads the key from process.env[apiKeyEnv] at call time and fails closed with an ApiKeyMissingError naming the env var (never the value) when it is unset or empty, the key NEVER appears in any error, output, or raw field, and the overlay config boundary rejects a literal apiKeyEnv — only the NAME of an env var may be stored. The kernel writes the authorization/content-type headers last (a config header cannot clobber them) and rejects reserved header NAMES at parse; the looks-like-a-secret guard over header VALUES is defence-in-depth only (bypassable for short keys), not the primary control.

**Enforced by:**

- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api-security.test.ts`](../packages/kernel/src/adapters/api-security.test.ts)
- [`packages/cli/src/endpoints.test.ts`](../packages/cli/src/endpoints.test.ts)
- [`packages/cli/src/endpoints.test.ts`](../packages/cli/src/endpoints.test.ts)
- [`packages/cli/src/endpoints.test.ts`](../packages/cli/src/endpoints.test.ts)
- [`packages/cli/src/endpoints.test.ts`](../packages/cli/src/endpoints.test.ts)
- [`packages/cli/src/endpoints.test.ts`](../packages/cli/src/endpoints.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- CI `test`

## CLM-0084

**Status:** verified — **source:** [`CLM-0084.yaml`](../claims/registry/CLM-0084.yaml)

The api adapter validates the operator-configured baseUrl before any network egress — requiring https except for an explicit localhost/loopback/private host, rejecting any other scheme and any embedded credentials — appends only the fixed /chat/completions path (never user-templated), refuses cross-host redirects, caps the response read with a streamed size limit that aborts past the cap, and enforces a wall-clock timeout via one AbortController spanning both the request and the body read on every call. The guard trusts the overlay as operator config (an https baseUrl may reach any host the operator points it at) — it is NOT SSRF immunity against a hostile overlay.

**Enforced by:**

- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api-security.test.ts`](../packages/kernel/src/adapters/api-security.test.ts)
- [`packages/kernel/src/adapters/api-security.test.ts`](../packages/kernel/src/adapters/api-security.test.ts)
- [`packages/kernel/src/adapters/api-security.test.ts`](../packages/kernel/src/adapters/api-security.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api-security.test.ts`](../packages/kernel/src/adapters/api-security.test.ts)
- CI `test`

## CLM-0085

**Status:** verified — **source:** [`CLM-0085.yaml`](../claims/registry/CLM-0085.yaml)

When a loop node's tier resolves to a registered api endpoint, the composition root invokes it via the kernel api adapter, resolving the served concrete model and reasoning_effort through the same pure translation seam, recording the endpoint as the served adapter in provenance, and metering the call's reported tokens and usd into the run budget — and a per-endpoint maxUsdPerCall fails closed. An endpoint declaring metersUsd:true that returns a 2xx with no cost also fails closed rather than meter $0, so a report never implies $0 spend when spend is unknown.

**Enforced by:**

- [`packages/cli/src/loop/api-loop.test.ts`](../packages/cli/src/loop/api-loop.test.ts)
- [`packages/cli/src/loop/api-loop.test.ts`](../packages/cli/src/loop/api-loop.test.ts)
- [`packages/cli/src/loop/api-loop.test.ts`](../packages/cli/src/loop/api-loop.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api-security.test.ts`](../packages/kernel/src/adapters/api-security.test.ts)
- [`packages/kernel/src/adapters/api-security.test.ts`](../packages/kernel/src/adapters/api-security.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- CI `test`

## CLM-0086

**Status:** verified — **source:** [`CLM-0086.yaml`](../claims/registry/CLM-0086.yaml)

Model discovery enumerates the models an endpoint serves via its stable PUBLIC contract — an OpenAI-compatible GET /v1/models (bearer key read env-only at call time) and ollama GET /api/tags (local, no secret) — reusing the api adapter's security primitives: the baseUrl scheme/credential guard runs before any egress, only the FIXED discovery path is appended, cross-host redirects are refused, the body is read under the same streamed size cap, and one AbortController bounds the request and the body read. The response is zod-validated defensively, so a non-2xx or malformed body is a typed error rather than a guessed model, and the key appears in no error, body, or surfaced string. The returned id set is also COUNT-bounded (#266): a pathological listing that fits under the byte cap is truncated to a fixed maximum after de-duplication, symmetric with the CLI probe, so it cannot blow up the discovered-cache write.

**Enforced by:**

- [`packages/kernel/src/adapters/discover.test.ts`](../packages/kernel/src/adapters/discover.test.ts)
- [`packages/kernel/src/adapters/discover.test.ts`](../packages/kernel/src/adapters/discover.test.ts)
- [`packages/kernel/src/adapters/discover.test.ts`](../packages/kernel/src/adapters/discover.test.ts)
- [`packages/kernel/src/adapters/discover.test.ts`](../packages/kernel/src/adapters/discover.test.ts)
- [`packages/kernel/src/adapters/discover.test.ts`](../packages/kernel/src/adapters/discover.test.ts)
- [`packages/kernel/src/adapters/discover.test.ts`](../packages/kernel/src/adapters/discover.test.ts)
- [`packages/kernel/src/adapters/discover.test.ts`](../packages/kernel/src/adapters/discover.test.ts)
- [`packages/kernel/src/adapters/discover.test.ts`](../packages/kernel/src/adapters/discover.test.ts)
- [`packages/kernel/src/adapters/discover.test.ts`](../packages/kernel/src/adapters/discover.test.ts)
- [`packages/kernel/src/adapters/discover.test.ts`](../packages/kernel/src/adapters/discover.test.ts)
- [`packages/kernel/src/adapters/discover.test.ts`](../packages/kernel/src/adapters/discover.test.ts)
- CI `test`

## CLM-0087

**Status:** verified — **source:** [`CLM-0087.yaml`](../claims/registry/CLM-0087.yaml)

Discovered model ids normalize through faculty-models' unchanged resolveIdentity — a vendored table hit yields full metadata, a well-formed uncatalogued id is rule-parsed, garbage is an honest unknown — and persist to a machine-local discovered cache keyed by source, each source carrying its own sync timestamp. The cache is validated by zod at load and a missing or corrupt cache degrades to empty rather than crashing or fabricating a model, a re-sync REPLACES a source's set so a model that vanished does not persist, and resolveWithDiscovered consults the cache (vendored table → discovered cache → rule → unknown) so the loop's provenance normalizes a discovered served model by the cache rather than a bare rule parse.

**Enforced by:**

- [`packages/faculty-models/src/discovered.test.ts`](../packages/faculty-models/src/discovered.test.ts)
- [`packages/faculty-models/src/discovered.test.ts`](../packages/faculty-models/src/discovered.test.ts)
- [`packages/faculty-models/src/discovered.test.ts`](../packages/faculty-models/src/discovered.test.ts)
- [`packages/faculty-models/src/discovered.test.ts`](../packages/faculty-models/src/discovered.test.ts)
- [`packages/faculty-models/src/discovered.test.ts`](../packages/faculty-models/src/discovered.test.ts)
- [`packages/faculty-models/src/discovered.test.ts`](../packages/faculty-models/src/discovered.test.ts)
- [`packages/faculty-models/src/discovered.test.ts`](../packages/faculty-models/src/discovered.test.ts)
- [`packages/faculty-models/src/discovered.test.ts`](../packages/faculty-models/src/discovered.test.ts)
- [`packages/cli/src/loop/node-seam.test.ts`](../packages/cli/src/loop/node-seam.test.ts)
- CI `test`

## CLM-0088

**Status:** verified — **source:** [`CLM-0088.yaml`](../claims/registry/CLM-0088.yaml)

kernloop models sync discovers every registered overlay endpoint plus a local ollama daemon plus each agent-CLI adapter's DECLARED tier-bindings (a cli:<name> source — a pure static read of the harness's own routing, no network and no subprocess, #131: a harness-routed adapter contributes its per-tier served aliases deduped, a concrete-id adapter with no bindings honestly contributes an empty set, never a fabricated list), normalizes the served ids through faculty-models, REPLACES each source's set in the machine-local discovered cache, and audits a cli.models.sync event carrying per-source counts but NEVER the key — honestly: a source that fails (no key, unreachable, malformed) is reported as failed for that source with a key-free reason while the others proceed and its prior set is left untouched, and the key never reaches the result, the audit, or stdout. kernloop models list prints the merged vendored plus discovered catalog with each row's id, family, generation, tier, and resolvedBy, stating the discovered cache's freshness per source. These are CLI verbs, not a twelfth MCP tool.

**Enforced by:**

- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- CI `test`

## CLM-0089

**Status:** verified — **source:** [`CLM-0089.yaml`](../claims/registry/CLM-0089.yaml)

A claim may anchor to a function and its doc-comment via code:path#symbol[@doc:/regex/] — the symbol must exist and, with @doc, its doc-comment must assert the claim; this is ADDITIVE evidence and claims:check still requires a test ref for verified.

**Enforced by:**

- [`claims/src/symbols.test.ts`](../claims/src/symbols.test.ts)
- [`claims/src/symbols.test.ts`](../claims/src/symbols.test.ts)
- [`claims/src/resolve.test.ts`](../claims/src/resolve.test.ts)
- [`claims/src/resolve.test.ts`](../claims/src/resolve.test.ts)
- [`claims/src/resolve.test.ts`](../claims/src/resolve.test.ts)
- [`claims/src/check.test.ts`](../claims/src/check.test.ts)
- [`claims/src/resolve.ts#resolveCodeRef`](../claims/src/resolve.ts)
- CI `test`

## CLM-0090

**Status:** verified — **source:** [`CLM-0090.yaml`](../claims/registry/CLM-0090.yaml)

docs/API.md is DERIVED, never hand-written: render-api-docs mines each gated package's public API surface — following its index.ts barrel re-exports to the definition files — and emits per exported symbol only STRUCTURE already present in the code (the symbol name, its kind, the FIRST sentence of its existing JSDoc, and any [CLM-] / spec § references the comment already carries), synthesizing no new capability prose. The block is drift-checked in CI the way the README enforcement table is: `docs:render -- --check` regenerates it in memory under a whitespace-normalized compare and fails the build if the committed doc has gone stale relative to the source comments. It is DERIVED documentation, not claim evidence — a mined sentence proves a symbol is documented, never that it behaves.

**Enforced by:**

- [`scripts/__tests__/render-api-docs.test.mjs`](../scripts/__tests__/render-api-docs.test.mjs)
- [`scripts/__tests__/render-api-docs.test.mjs`](../scripts/__tests__/render-api-docs.test.mjs)
- [`scripts/__tests__/render-api-docs.test.mjs`](../scripts/__tests__/render-api-docs.test.mjs)
- [`scripts/__tests__/render-api-docs.test.mjs`](../scripts/__tests__/render-api-docs.test.mjs)
- [`scripts/__tests__/render-api-docs.test.mjs`](../scripts/__tests__/render-api-docs.test.mjs)
- [`scripts/__tests__/render-api-docs.test.mjs`](../scripts/__tests__/render-api-docs.test.mjs)
- [`claims/src/symbols.test.ts`](../claims/src/symbols.test.ts)
- [`scripts/render-api-docs.mjs#renderApiTable`](../scripts/render-api-docs.mjs)
- CI `test`

## CLM-0091

**Status:** verified — **source:** [`CLM-0091.yaml`](../claims/registry/CLM-0091.yaml)

The doc-coverage gate (#64) requires every VALUE export — function, const, class, enum — on a gated package's public API surface to carry a real, non-placeholder doc-comment, rejecting trivially-empty docs and docs that merely restate the symbol name. The public-API resolver chases the barrel graph RECURSIVELY (#72): it follows named re-exports through NESTED barrels to the real declaration that carries the doc-comment, resolves a RENAME re-export (`export { X as Y }`) by its local name while surfacing the alias (#214), surfaces a BARE local re-export (`export { foo }` with no `from`, #213), and EXPANDS relative `export *` into its named symbols (breaking any cycle, memoizing each file). Only an EXTERNAL `export *` stays opaque — gated in its owning package — and is surfaced as a count, never hidden. So fourteen packages are gated (contracts, kernel, cli, docscan, parsimony, workflows, faculty-compiler, faculty-gates, faculty-memory, faculty-observer, faculty-scrum, faculty-toolsmith, faculty-workforce, tracker) — the nested-barrel and `export *` packages (cli/workflows/kernel) included, no longer under-reported. A gap exits 1 with a per-package report and the gate runs in CI. The exclusion is by KIND, recorded permanently (never a silent weakening): type aliases/interfaces (incl. z.infer companions) declare no runtime value, so they are not gated — but a VALUE re-exported via `export type` still is (#215). It is a QUALITY gate, not claim evidence — a doc-comment proves a symbol is documented, never that it behaves; tests remain the verified bar.

**Enforced by:**

- [`scripts/__tests__/docs-coverage.test.mjs`](../scripts/__tests__/docs-coverage.test.mjs)
- [`scripts/__tests__/docs-coverage.test.mjs`](../scripts/__tests__/docs-coverage.test.mjs)
- [`scripts/__tests__/docs-coverage.test.mjs`](../scripts/__tests__/docs-coverage.test.mjs)
- [`scripts/__tests__/docs-coverage.test.mjs`](../scripts/__tests__/docs-coverage.test.mjs)
- [`scripts/__tests__/docs-coverage.test.mjs`](../scripts/__tests__/docs-coverage.test.mjs)
- [`scripts/__tests__/docs-coverage.test.mjs`](../scripts/__tests__/docs-coverage.test.mjs)
- [`scripts/__tests__/docs-coverage.test.mjs`](../scripts/__tests__/docs-coverage.test.mjs)
- [`scripts/__tests__/docs-coverage.test.mjs`](../scripts/__tests__/docs-coverage.test.mjs)
- [`scripts/__tests__/public-api.test.mjs`](../scripts/__tests__/public-api.test.mjs)
- [`scripts/__tests__/public-api.test.mjs`](../scripts/__tests__/public-api.test.mjs)
- [`scripts/__tests__/public-api.test.mjs`](../scripts/__tests__/public-api.test.mjs)
- [`scripts/__tests__/public-api.test.mjs`](../scripts/__tests__/public-api.test.mjs)
- [`scripts/__tests__/public-api.test.mjs`](../scripts/__tests__/public-api.test.mjs)
- [`scripts/__tests__/public-api.test.mjs`](../scripts/__tests__/public-api.test.mjs)
- [`scripts/__tests__/public-api.test.mjs`](../scripts/__tests__/public-api.test.mjs)
- [`scripts/__tests__/public-api.test.mjs`](../scripts/__tests__/public-api.test.mjs)
- [`scripts/__tests__/docs-coverage.test.mjs`](../scripts/__tests__/docs-coverage.test.mjs)
- [`scripts/docs-coverage.mjs#gapsForPackage`](../scripts/docs-coverage.mjs)
- CI `test`

## CLM-0092

**Status:** verified — **source:** [`CLM-0092.yaml`](../claims/registry/CLM-0092.yaml)

The Observer turns its fitness ledger and drift signals into suggest-tier deprecation and distill proposals, surfaced through the observe tool, and never auto-acts: computing them files no issue, demotes nothing, distills nothing, and leaves every proposal for human ratification.

**Enforced by:**

- [`packages/faculty-observer/src/lifecycle.test.ts`](../packages/faculty-observer/src/lifecycle.test.ts)
- [`packages/faculty-observer/src/lifecycle.test.ts`](../packages/faculty-observer/src/lifecycle.test.ts)
- [`packages/faculty-observer/src/lifecycle.test.ts`](../packages/faculty-observer/src/lifecycle.test.ts)
- [`packages/faculty-observer/src/lifecycle.test.ts`](../packages/faculty-observer/src/lifecycle.test.ts)
- [`packages/faculty-observer/src/lifecycle.test.ts`](../packages/faculty-observer/src/lifecycle.test.ts)
- [`packages/faculty-observer/src/lifecycle.test.ts`](../packages/faculty-observer/src/lifecycle.test.ts)
- [`packages/faculty-observer/src/lifecycle.test.ts`](../packages/faculty-observer/src/lifecycle.test.ts)
- [`packages/cli/src/tools/observe.test.ts`](../packages/cli/src/tools/observe.test.ts)
- [`packages/faculty-observer/src/lifecycle.ts#lifecycleProposals`](../packages/faculty-observer/src/lifecycle.ts)
- CI `test`

## CLM-0093

**Status:** verified — **source:** [`CLM-0093.yaml`](../claims/registry/CLM-0093.yaml)

The provider-agnostic TrackerProvider abstraction and its GitHub provider build gh invocations securely — args-array with no shell, the body via a bounded temp file, captured output bounded (a gh op past the size cap is killed and surfaced as a typed io-failed, so it cannot balloon host memory), flag injection guarded, the close reason allowlisted, the gh subcommand allowlisted, the repo scoped from validated config, and every issue ref bound to that repo (a URL ref must be a github.com URL in the configured repo and only its number, never the URL, reaches gh — no cross-repo action, no SSRF) — publish an honest capability descriptor (which also declares the READ op getIssue, hardened identically and covered by CLM-0101), and gate every WRITE mutation — createIssue, closeIssue, comment, addLabels, and the body-replace op editBody (the allowlisted gh issue edit subcommand, used by program emit to write an epic's sub-issue task-list, #84) — to the enforce tier (dry-run is the default and spawns nothing) through the audited kernloop tracker CLI; errors are always data.

**Enforced by:**

- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider-editbody.test.ts`](../packages/tracker/src/provider-editbody.test.ts)
- [`packages/tracker/src/provider-editbody.test.ts`](../packages/tracker/src/provider-editbody.test.ts)
- [`packages/tracker/src/provider-editbody.test.ts`](../packages/tracker/src/provider-editbody.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/exec.test.ts`](../packages/tracker/src/exec.test.ts)
- [`packages/tracker/src/exec.test.ts`](../packages/tracker/src/exec.test.ts)
- [`packages/tracker/src/exec.test.ts`](../packages/tracker/src/exec.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/cli/src/tracker-commands.test.ts`](../packages/cli/src/tracker-commands.test.ts)
- [`packages/cli/src/tracker-commands.test.ts`](../packages/cli/src/tracker-commands.test.ts)
- [`packages/cli/src/tracker-commands.test.ts`](../packages/cli/src/tracker-commands.test.ts)
- [`packages/cli/src/tracker-commands.test.ts`](../packages/cli/src/tracker-commands.test.ts)
- [`packages/tracker/src/provider.ts#githubProvider`](../packages/tracker/src/provider.ts)
- CI `test`

## CLM-0094

**Status:** verified — **source:** [`CLM-0094.yaml`](../claims/registry/CLM-0094.yaml)

The kernloop observer CLI turns lifecycle proposals into tracker issues through a dry-run-default, enforce-tier-gated, audited path: proposals are a pure read, propose snapshots one into observer_issues (de-duped by title), and file builds the tracker CreateIssueInput and acts ONLY at the enforce tier with --execute — at suggest an --execute is refused and stays dry-run (never defaults upward). A real execute files via the tracker and records the returned url onto the proposal (markIssueFiled); the audit event for every op omits the body verbatim (only a bounded char count). The self-filed issue's task-shaped payload re-enters via the ordinary run loop — no auto-action.

**Enforced by:**

- [`packages/cli/src/observer-commands.test.ts`](../packages/cli/src/observer-commands.test.ts)
- [`packages/cli/src/observer-commands.test.ts`](../packages/cli/src/observer-commands.test.ts)
- [`packages/cli/src/observer-commands.test.ts`](../packages/cli/src/observer-commands.test.ts)
- [`packages/cli/src/observer-commands.test.ts`](../packages/cli/src/observer-commands.test.ts)
- [`packages/cli/src/observer-commands.test.ts`](../packages/cli/src/observer-commands.test.ts)
- [`packages/cli/src/observer-commands.test.ts`](../packages/cli/src/observer-commands.test.ts)
- [`packages/cli/src/observer-commands.test.ts`](../packages/cli/src/observer-commands.test.ts)
- [`packages/cli/src/observer-commands.ts#observerCommand`](../packages/cli/src/observer-commands.ts)
- CI `test`

## CLM-0095

**Status:** verified — **source:** [`CLM-0095.yaml`](../claims/registry/CLM-0095.yaml)

TaskContract constraint-tags (altitude/track/sprint) are a typed reader over the existing constraints string[] — parsed and validated (an altitude value outside epic|story|task or a duplicate altitude is rejected, and a track/sprint value with spaces or metacharacters or a duplicate is rejected so it is safe as a later label) — never a new contract and never a new TaskContract field.

**Enforced by:**

- [`packages/contracts/src/constraints.test.ts`](../packages/contracts/src/constraints.test.ts)
- [`packages/contracts/src/constraints.test.ts`](../packages/contracts/src/constraints.test.ts)
- [`packages/contracts/src/constraints.test.ts`](../packages/contracts/src/constraints.test.ts)
- [`packages/contracts/src/constraints.test.ts`](../packages/contracts/src/constraints.test.ts)
- [`packages/contracts/src/constraints.test.ts`](../packages/contracts/src/constraints.test.ts)
- [`packages/contracts/src/constraints.test.ts`](../packages/contracts/src/constraints.test.ts)
- [`packages/contracts/src/constraints.test.ts`](../packages/contracts/src/constraints.test.ts)
- [`packages/contracts/src/constraints.ts#parseConstraintTags`](../packages/contracts/src/constraints.ts)
- CI `test`

## CLM-0096

**Status:** verified — **source:** [`CLM-0096.yaml`](../claims/registry/CLM-0096.yaml)

faculty-scrum decomposes a goal into an epic/story TaskContract tree with the parent-chain, the budget-sum invariant (per tokens/usd/wallClockMin), altitude/track/sprint constraint tags, and altitude-descent enforcement (an altitude-bearing parent decomposes exactly one rung down — epic→story, story→task — a task parent is a leaf that cannot decompose, and the program root with no altitude is the unconstrained entry), surfaced through the suggest-tier kernloop program decompose CLI as a preview that mutates nothing (no GitHub).

**Enforced by:**

- [`packages/faculty-scrum/src/decompose.test.ts`](../packages/faculty-scrum/src/decompose.test.ts)
- [`packages/faculty-scrum/src/decompose.test.ts`](../packages/faculty-scrum/src/decompose.test.ts)
- [`packages/faculty-scrum/src/decompose.test.ts`](../packages/faculty-scrum/src/decompose.test.ts)
- [`packages/faculty-scrum/src/decompose.test.ts`](../packages/faculty-scrum/src/decompose.test.ts)
- [`packages/faculty-scrum/src/decompose.test.ts`](../packages/faculty-scrum/src/decompose.test.ts)
- [`packages/faculty-scrum/src/decompose.test.ts`](../packages/faculty-scrum/src/decompose.test.ts)
- [`packages/faculty-scrum/src/decompose.test.ts`](../packages/faculty-scrum/src/decompose.test.ts)
- [`packages/faculty-scrum/src/decompose.test.ts`](../packages/faculty-scrum/src/decompose.test.ts)
- [`packages/faculty-scrum/src/decompose.test.ts`](../packages/faculty-scrum/src/decompose.test.ts)
- [`packages/faculty-scrum/src/decompose.test.ts`](../packages/faculty-scrum/src/decompose.test.ts)
- [`packages/faculty-scrum/src/decompose.test.ts`](../packages/faculty-scrum/src/decompose.test.ts)
- [`packages/cli/src/program-decompose-commands.test.ts`](../packages/cli/src/program-decompose-commands.test.ts)
- [`packages/cli/src/program-decompose-commands.test.ts`](../packages/cli/src/program-decompose-commands.test.ts)
- [`packages/cli/src/program-decompose-commands.test.ts`](../packages/cli/src/program-decompose-commands.test.ts)
- [`packages/cli/src/program-decompose-commands.test.ts`](../packages/cli/src/program-decompose-commands.test.ts)
- [`packages/faculty-scrum/src/decompose.ts#decomposeGoal`](../packages/faculty-scrum/src/decompose.ts)
- CI `test`

## CLM-0097

**Status:** verified — **source:** [`CLM-0097.yaml`](../claims/registry/CLM-0097.yaml)

faculty-scrum prepares the pure, GitHub-free half of program emission. programLabels maps a TaskContract's constraint tags to GitHub labels through one map — the single source of truth (assign:agent.<t> → agent:<t>, with altitude/track/sprint passing through) so the GitHub view and future loop routing never diverge; the reverse direction (label → tag) is Increment 4. It emits only tracker-label-safe values: free-form constraints produce no label, the output is deduped, and every emitted label satisfies the tracker LabelSchema charset (asserted inline, as a typed error, so faculty-scrum never imports the tracker). programIssueBody renders the node goal plus the replayable task-shaped payload.

**Enforced by:**

- [`packages/faculty-scrum/src/labels.test.ts`](../packages/faculty-scrum/src/labels.test.ts)
- [`packages/faculty-scrum/src/labels.test.ts`](../packages/faculty-scrum/src/labels.test.ts)
- [`packages/faculty-scrum/src/labels.test.ts`](../packages/faculty-scrum/src/labels.test.ts)
- [`packages/faculty-scrum/src/labels.test.ts`](../packages/faculty-scrum/src/labels.test.ts)
- [`packages/faculty-scrum/src/labels.test.ts`](../packages/faculty-scrum/src/labels.test.ts)
- [`packages/faculty-scrum/src/labels.test.ts`](../packages/faculty-scrum/src/labels.test.ts)
- [`packages/faculty-scrum/src/labels.ts#programLabels`](../packages/faculty-scrum/src/labels.ts)
- CI `test`

## CLM-0098

**Status:** verified — **source:** [`CLM-0098.yaml`](../claims/registry/CLM-0098.yaml)

kernloop program emit files each decomposed child node as a labeled GitHub issue through the hardened tracker — dry-run by default, enforce-tier-gated (an --execute at suggest is refused and stays dry-run), issue-spam-guarded (a child count beyond the limit needs an explicit --confirm-count matching it), and audited once as cli.program.emit without the node goal/body verbatim. It mutates nothing in dry-run and re-uses the existing hardened tracker (the ledger path's sub-issue linking adds the editBody op on the already-allowlisted gh issue edit subcommand — no new gh subcommand, CLM-0106); an execute-mode createIssue failure is errors-as-data → a clean nonzero exit. emit has TWO mutually-exclusive modes: the ad-hoc --goal/--spec path re-decomposes and files; the LEDGER-DRIVEN --program <id> path files a persisted program's planned nodes from the STORED rows through the same gated tracker and AUTO-RECORDS each filed ref into the ledger (planned → emitted) on a real execute — idempotent (a re-emit skips already-emitted/done nodes and files nothing), still dry-run-default + enforce-gated + spam-guarded, an execute failure leaving the node planned, and a filed issue whose returned ref is unrecordable surfaced per-node WITH its ref (exit 1, node left planned) so a retry is a deliberate operator act, never a silent double-file. A pure dry-run preview needs NO tracker block (#94): with none configured the preview renders the would-be proposals against a placeholder repo and spawns nothing; only an --execute requires a configured tracker (a clean input error without one).

**Enforced by:**

- [`packages/cli/src/program-commands.test.ts`](../packages/cli/src/program-commands.test.ts)
- [`packages/cli/src/program-commands.test.ts`](../packages/cli/src/program-commands.test.ts)
- [`packages/cli/src/program-commands.test.ts`](../packages/cli/src/program-commands.test.ts)
- [`packages/cli/src/program-commands.test.ts`](../packages/cli/src/program-commands.test.ts)
- [`packages/cli/src/program-commands.test.ts`](../packages/cli/src/program-commands.test.ts)
- [`packages/cli/src/program-commands.test.ts`](../packages/cli/src/program-commands.test.ts)
- [`packages/cli/src/program-commands.test.ts`](../packages/cli/src/program-commands.test.ts)
- [`packages/cli/src/program-commands.test.ts`](../packages/cli/src/program-commands.test.ts)
- [`packages/cli/src/program-emit-ledger.test.ts`](../packages/cli/src/program-emit-ledger.test.ts)
- [`packages/cli/src/program-emit-ledger.test.ts`](../packages/cli/src/program-emit-ledger.test.ts)
- [`packages/cli/src/program-emit-ledger.test.ts`](../packages/cli/src/program-emit-ledger.test.ts)
- [`packages/cli/src/program-emit-ledger.test.ts`](../packages/cli/src/program-emit-ledger.test.ts)
- [`packages/cli/src/program-emit-ledger.test.ts`](../packages/cli/src/program-emit-ledger.test.ts)
- [`packages/cli/src/program-emit.ts#emitOp`](../packages/cli/src/program-emit.ts)
- CI `test`

## CLM-0099

**Status:** verified — **source:** [`CLM-0099.yaml`](../claims/registry/CLM-0099.yaml)

the program ledger persists a decomposed program + its nodes in a cross-session .kernloop/programs.sqlite (parameterized queries only), advancing each node ONE rung forward at a time through planned → emitted → done with the filed issue ref — never inventing a program, rejecting a duplicate program id and a backward, rung-skipping, or ref-less transition (so a node cannot reach done unemitted).

**Enforced by:**

- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.ts#createProgramStore`](../packages/cli/src/program-store.ts)
- CI `test`

## CLM-0100

**Status:** verified — **source:** [`CLM-0100.yaml`](../claims/registry/CLM-0100.yaml)

kernloop program create|list|status|advance persists a decomposed plan to the resumable .kernloop/programs.sqlite ledger, lists the persisted programs, reports a program's planned/emitted/done rollup, and advances a node one poll-driven step at a time (no daemon) — a duplicate id, an unknown program/node, a backward transition, an out-of-range --state, and an emitted-without-ref each exit 1 cleanly, and each op is audited (cli.program.{create,list,status,advance}) without the goal verbatim.

**Enforced by:**

- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-commands.ts#programCommand`](../packages/cli/src/program-commands.ts)
- CI `test`

## CLM-0101

**Status:** verified — **source:** [`CLM-0101.yaml`](../claims/registry/CLM-0101.yaml)

The GitHub tracker exposes a hardened READ op getIssue — gh issue view with a HARD-CODED --json allowlist (number,state, never from input), the ref bound to the configured repo (a cross-repo URL is rejected without spawning) and passed as the sole positional behind --, the gh OPEN/CLOSED state normalized to lowercase open|closed, errors as data (a nonzero exit, a spawn failure, and malformed/unexpected JSON each a typed, scrubbed TrackerFailure, never thrown) — and it is READ-ONLY and mode-INDEPENDENT (a read is not a mutation, so a dry-run provider still reads); the capability descriptor declares getIssue.

**Enforced by:**

- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.test.ts`](../packages/tracker/src/provider.test.ts)
- [`packages/tracker/src/provider.ts#githubProvider`](../packages/tracker/src/provider.ts)
- CI `test`

## CLM-0102

**Status:** verified — **source:** [`CLM-0102.yaml`](../claims/registry/CLM-0102.yaml)

kernloop program reconcile reads each emitted node's GitHub issue via the tracker getIssue op and, GitHub being authoritative, advances the node emitted → done when its issue is closed — dry-run-default (the gh READ happens at any tier since a read is not a mutation; only the LOCAL ledger write is gated by --execute), audited once (cli.program.reconcile) with counts only, an open issue left unchanged, and a getIssue read failure surfaced as exit 1 with the node left unchanged; an absent program / no tracker exits 1 cleanly.

**Enforced by:**

- [`packages/cli/src/program-reconcile.test.ts`](../packages/cli/src/program-reconcile.test.ts)
- [`packages/cli/src/program-reconcile.test.ts`](../packages/cli/src/program-reconcile.test.ts)
- [`packages/cli/src/program-reconcile.test.ts`](../packages/cli/src/program-reconcile.test.ts)
- [`packages/cli/src/program-reconcile.test.ts`](../packages/cli/src/program-reconcile.test.ts)
- [`packages/cli/src/program-reconcile.test.ts`](../packages/cli/src/program-reconcile.test.ts)
- [`packages/cli/src/program-reconcile.test.ts`](../packages/cli/src/program-reconcile.test.ts)
- [`packages/cli/src/program-reconcile.test.ts`](../packages/cli/src/program-reconcile.test.ts)
- [`packages/cli/src/program-reconcile.test.ts`](../packages/cli/src/program-reconcile.test.ts)
- [`packages/cli/src/program-reconcile.ts#reconcileOp`](../packages/cli/src/program-reconcile.ts)
- CI `test`

## CLM-0103

**Status:** verified — **source:** [`CLM-0103.yaml`](../claims/registry/CLM-0103.yaml)

kernloop program author invokes a model to PROPOSE an epic/story decomposition from a goal, validates the model's output against StorySpecSchema, and runs it through the same decomposeGoal (deterministic budget-sum invariant + identity/ altitude/assign derivation) — suggest-tier, mutating nothing (no ledger write, no GitHub, no loop run; one cli.program.author audit event with goalChars, never the goal or model output verbatim); malformed / non-array / schema-invalid / budget-breaching model output is a clean exit 1, never fabricated or auto-acted, and the model is invoked with a prompt containing the goal.

**Enforced by:**

- [`packages/cli/src/program-author.test.ts`](../packages/cli/src/program-author.test.ts)
- [`packages/cli/src/program-author.test.ts`](../packages/cli/src/program-author.test.ts)
- [`packages/cli/src/program-author.test.ts`](../packages/cli/src/program-author.test.ts)
- [`packages/cli/src/program-author.test.ts`](../packages/cli/src/program-author.test.ts)
- [`packages/cli/src/program-author.test.ts`](../packages/cli/src/program-author.test.ts)
- [`packages/cli/src/program-author.test.ts`](../packages/cli/src/program-author.test.ts)
- [`packages/cli/src/program-author.test.ts`](../packages/cli/src/program-author.test.ts)
- [`packages/cli/src/program-author.test.ts`](../packages/cli/src/program-author.test.ts)
- [`packages/cli/src/program-author.test.ts`](../packages/cli/src/program-author.test.ts)
- [`packages/cli/src/program-author.ts#authorOp`](../packages/cli/src/program-author.ts)
- CI `test`

## CLM-0104

**Status:** verified — **source:** [`CLM-0104.yaml`](../claims/registry/CLM-0104.yaml)

The quality gate runs an in-process, language-aware doc-comment scan over the workspace: every exported top-level TypeScript/JavaScript declaration (via the TS compiler API) and every public declaration in twelve tree-sitter languages — Python/Go/Rust/Java/C/PHP/Ruby (#108/#122) and C++/C#/Kotlin/Swift/Scala (#120), via in-process web-tree-sitter WASM grammars — lacking a non-empty leading doc-comment is an error finding (failing the Verdict, so the per-child iteration loop re-runs the coder). Each language's OWN visibility/doc rule is applied (Go uppercase-initial, Rust `pub`, Java/C# `public`, C/C++ non-`static` incl. typedefs/prototypes minus bodyless forward declarations, PHP/Ruby/Kotlin/Scala public-by-default, Swift `public`/`open` only) and, for Java/PHP/C#/C++/Kotlin/ Scala/Swift/Ruby, each type's PUBLIC nested members (private/protected/internal skipped, #121/#120/#150) — Ruby tracking its STATEFUL private/protected directives down the class body AND reconciling the arg-form visibility calls (`private :x` / `private def x` / `public :x`, #165); C#/C++/PHP descend named/braced namespaces INTO the nested types' public members too (#170); and member descent RECURSES, so a type nested inside another type's body and its own members are reached (member-of-member, C++/C#/Kotlin/Java, #181), including a Kotlin `companion object`'s members (public surface on the enclosing type, #187) and a public Swift protocol's requirements (which inherit the protocol's visibility, #184). Each REMAINING known source language it cannot yet parse contributes one non-blocking info finding (so an uncovered-language deliverable gets no doc enforcement — recorded, never silently passed); the scan bounds its own per-file and total bytes AND each single tree-sitter parse by a wall-clock budget (#123) so untrusted workspace code cannot hang the in-process loop — a budget-exceeding parse aborts, resets the cached parser, and degrades to a recorded info, never a hang. A throwing scan becomes an error finding, the parsed tree is always freed, and it verifies doc-comment PRESENCE, never accuracy.

**Enforced by:**

- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-ruby.test.ts`](../packages/docscan/src/treesitter-ruby.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-ruby.test.ts`](../packages/docscan/src/treesitter-ruby.test.ts)
- [`packages/docscan/src/treesitter-large-langs.test.ts`](../packages/docscan/src/treesitter-large-langs.test.ts)
- [`packages/docscan/src/treesitter-large-langs.test.ts`](../packages/docscan/src/treesitter-large-langs.test.ts)
- [`packages/docscan/src/treesitter-large-langs.test.ts`](../packages/docscan/src/treesitter-large-langs.test.ts)
- [`packages/docscan/src/treesitter-large-langs.test.ts`](../packages/docscan/src/treesitter-large-langs.test.ts)
- [`packages/docscan/src/treesitter-large-langs.test.ts`](../packages/docscan/src/treesitter-large-langs.test.ts)
- [`packages/docscan/src/treesitter-cpp.test.ts`](../packages/docscan/src/treesitter-cpp.test.ts)
- [`packages/docscan/src/treesitter-cpp.test.ts`](../packages/docscan/src/treesitter-cpp.test.ts)
- [`packages/docscan/src/treesitter-cpp.test.ts`](../packages/docscan/src/treesitter-cpp.test.ts)
- [`packages/docscan/src/treesitter-cpp.test.ts`](../packages/docscan/src/treesitter-cpp.test.ts)
- [`packages/docscan/src/treesitter-cpp.test.ts`](../packages/docscan/src/treesitter-cpp.test.ts)
- [`packages/docscan/src/treesitter-csharp.test.ts`](../packages/docscan/src/treesitter-csharp.test.ts)
- [`packages/docscan/src/treesitter-kotlin.test.ts`](../packages/docscan/src/treesitter-kotlin.test.ts)
- [`packages/docscan/src/treesitter-kotlin.test.ts`](../packages/docscan/src/treesitter-kotlin.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-csharp.test.ts`](../packages/docscan/src/treesitter-csharp.test.ts)
- [`packages/docscan/src/treesitter-csharp.test.ts`](../packages/docscan/src/treesitter-csharp.test.ts)
- [`packages/docscan/src/treesitter-ruby.test.ts`](../packages/docscan/src/treesitter-ruby.test.ts)
- [`packages/docscan/src/treesitter-ruby.test.ts`](../packages/docscan/src/treesitter-ruby.test.ts)
- [`packages/docscan/src/treesitter-ruby.test.ts`](../packages/docscan/src/treesitter-ruby.test.ts)
- [`packages/docscan/src/treesitter-ruby.test.ts`](../packages/docscan/src/treesitter-ruby.test.ts)
- [`packages/docscan/src/treesitter-ruby.test.ts`](../packages/docscan/src/treesitter-ruby.test.ts)
- [`packages/docscan/src/treesitter-ruby.test.ts`](../packages/docscan/src/treesitter-ruby.test.ts)
- [`packages/docscan/src/treesitter-ruby.test.ts`](../packages/docscan/src/treesitter-ruby.test.ts)
- [`packages/docscan/src/treesitter-ruby.test.ts`](../packages/docscan/src/treesitter-ruby.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/docscan/src/treesitter-scan.test.ts`](../packages/docscan/src/treesitter-scan.test.ts)
- [`packages/faculty-gates/src/run.test.ts`](../packages/faculty-gates/src/run.test.ts)
- [`packages/faculty-gates/src/run.test.ts`](../packages/faculty-gates/src/run.test.ts)
- [`packages/docscan/src/doc-scan.ts#scanDocComments`](../packages/docscan/src/doc-scan.ts)
- [`packages/docscan/src/treesitter-scan.ts#scanTreeSitterFiles`](../packages/docscan/src/treesitter-scan.ts)
- [`packages/docscan/src/treesitter-langs.ts#LANGS`](../packages/docscan/src/treesitter-langs.ts)
- [`packages/faculty-gates/src/checks.ts#docCommentCheck`](../packages/faculty-gates/src/checks.ts)
- [`packages/docscan/src/treesitter-swift.test.ts`](../packages/docscan/src/treesitter-swift.test.ts)
- [`packages/docscan/src/treesitter-swift.test.ts`](../packages/docscan/src/treesitter-swift.test.ts)
- CI `test`

## CLM-0105

**Status:** verified — **source:** [`CLM-0105.yaml`](../claims/registry/CLM-0105.yaml)

When a canonical-loop run reaches retrospect (status completed) — whether the work's Outcome was success or failure — kernloop derives a deterministic API-doc artifact (API.generated.md, files sorted by path) from the deliverable's own exported TS/JS doc-comments — model-free, reusing the doc-comment scanner — marking undocumented exports, writing nothing when there are no symbols, and auditing the counts once; the mine bounds its own cumulative bytes, skipping and COUNTING (surfaced as skippedForBudget, never silent — #114) any covered files past the budget; a run that escalated or failed before retrospect produces no artifact, and it reflects doc-comment PRESENCE, never accuracy.

**Enforced by:**

- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/cli/src/loop/doc-artifact.test.ts`](../packages/cli/src/loop/doc-artifact.test.ts)
- [`packages/cli/src/loop/doc-artifact.test.ts`](../packages/cli/src/loop/doc-artifact.test.ts)
- [`packages/cli/src/loop/doc-artifact.test.ts`](../packages/cli/src/loop/doc-artifact.test.ts)
- [`packages/cli/src/loop/doc-artifact.test.ts`](../packages/cli/src/loop/doc-artifact.test.ts)
- [`packages/cli/src/loop/doc-artifact.test.ts`](../packages/cli/src/loop/doc-artifact.test.ts)
- [`packages/cli/src/loop.test.ts`](../packages/cli/src/loop.test.ts)
- [`packages/cli/src/loop.test.ts`](../packages/cli/src/loop.test.ts)
- [`packages/cli/src/loop.test.ts`](../packages/cli/src/loop.test.ts)
- [`packages/cli/src/loop/doc-artifact.ts#writeDocArtifact`](../packages/cli/src/loop/doc-artifact.ts)
- [`packages/docscan/src/doc-scan.ts#mineExportedSymbols`](../packages/docscan/src/doc-scan.ts)
- CI `test`

## CLM-0106

**Status:** verified — **source:** [`CLM-0106.yaml`](../claims/registry/CLM-0106.yaml)

kernloop program stores a decomposed program as a parentId TREE — program create persists the program ROOT umbrella as a node (parentId null) alongside its decomposed children pointing at it, and a pre-parentId ledger is forward-migrated in place — so program emit files the program as a real GitHub epic with body-ref-linked sub-issues: it files PARENTS-FIRST (the umbrella before its children), injects each child's filed-parent #N back-link into the child body, and once a parent's children are filed REPLACES the parent body (via the hardened editBody tracker op — the allowlisted gh issue edit subcommand, NO GraphQL) with a "- [ ] #child" task-list GitHub renders as tracked sub-issues. Linking runs only on a real execute (dry-run reports the would-be tree edges and edits nothing); a failed umbrella file leaves its children unlinked and edits no epic; an editBody failure is errors-as-data → a clean nonzero exit; a filed ref whose issue number cannot be resolved skips that edge rather than faking it.

**Enforced by:**

- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-emit-ledger.test.ts`](../packages/cli/src/program-emit-ledger.test.ts)
- [`packages/cli/src/program-emit-ledger.test.ts`](../packages/cli/src/program-emit-ledger.test.ts)
- [`packages/cli/src/program-emit-ledger.test.ts`](../packages/cli/src/program-emit-ledger.test.ts)
- [`packages/cli/src/program-emit-ledger.test.ts`](../packages/cli/src/program-emit-ledger.test.ts)
- [`packages/cli/src/program-emit-tree.test.ts`](../packages/cli/src/program-emit-tree.test.ts)
- [`packages/cli/src/program-emit-tree.test.ts`](../packages/cli/src/program-emit-tree.test.ts)
- [`packages/cli/src/program-emit-tree.test.ts`](../packages/cli/src/program-emit-tree.test.ts)
- [`packages/cli/src/program-emit-tree.test.ts`](../packages/cli/src/program-emit-tree.test.ts)
- [`packages/cli/src/program-emit-tree.test.ts`](../packages/cli/src/program-emit-tree.test.ts)
- [`packages/cli/src/program-emit-tree.test.ts`](../packages/cli/src/program-emit-tree.test.ts)
- [`packages/cli/src/program-emit-tree.test.ts`](../packages/cli/src/program-emit-tree.test.ts)
- [`packages/tracker/src/provider-editbody.test.ts`](../packages/tracker/src/provider-editbody.test.ts)
- [`packages/tracker/src/provider-editbody.test.ts`](../packages/tracker/src/provider-editbody.test.ts)
- [`packages/cli/src/program-emit-tree.ts#orderParentsFirst`](../packages/cli/src/program-emit-tree.ts)
- [`packages/cli/src/program-emit-tree.ts#epicBodyWithTaskList`](../packages/cli/src/program-emit-tree.ts)
- [`packages/cli/src/program-emit-ledger.ts#emitInOrder`](../packages/cli/src/program-emit-ledger.ts)
- CI `test`

## CLM-0107

**Status:** verified — **source:** [`CLM-0107.yaml`](../claims/registry/CLM-0107.yaml)

The canonical loop tolerates an AGENTIC coder CLI's prose-wrapped output (#130): the JSON extractor returns the first BALANCED object that PARSES — stepping over brace-bearing prose/code snippets a headless agent narrates around the contract object, not merely the first `{` — and the implement node RETRIES its model call ONCE on a files-contract parse failure (an intermittent prose wrap usually resolves on a second roll), metering BOTH attempts' cost. This parse-failure retry is distinct from and independent of the Kc quality-iteration (CLM-0043); a PERSISTENT contract violation still fails HONESTLY — the raw output is preserved under checkpoints/, no files are fabricated, and there is no coercion.

**Enforced by:**

- [`packages/cli/src/loop/invoke.test.ts`](../packages/cli/src/loop/invoke.test.ts)
- [`packages/cli/src/loop/invoke.test.ts`](../packages/cli/src/loop/invoke.test.ts)
- [`packages/cli/src/loop/invoke.test.ts`](../packages/cli/src/loop/invoke.test.ts)
- [`packages/cli/src/loop/executors.test.ts`](../packages/cli/src/loop/executors.test.ts)
- [`packages/cli/src/loop/executors.test.ts`](../packages/cli/src/loop/executors.test.ts)
- [`packages/cli/src/loop/invoke.ts#extractJsonObject`](../packages/cli/src/loop/invoke.ts)
- [`packages/cli/src/loop/executors-nodes.ts#coderEmissionWithRetry`](../packages/cli/src/loop/executors-nodes.ts)
- CI `test`

## CLM-0108

**Status:** verified — **source:** [`CLM-0108.yaml`](../claims/registry/CLM-0108.yaml)

When kernloop runs as an MCP server (kernloop serve) and the connected HOST declared the `sampling` capability, the canonical loop obtains every completion from the host via MCP `sampling/createMessage` (#135): the host serves the model from its OWN provider — kernloop holds no model CLI, key, or model choice — the per-node requested TIER rides up as MCP `modelPreferences` cost/speed/intelligence priorities (#140) so the host routes its OWN high/med/low model, with the resolved model alias as an advisory name hint alongside; both are ADVISORY (the host picks). The per-call timeout bounds the round-trip, and cost is metered honest-ZERO (the host owns usage; the binding constraint is the host plan's context limits, not per-run USD). A host WITHOUT sampling is a typed SamplingUnsupportedError — no silent fallback to a model kernloop does not hold. The run tool injects this seam ONLY when the host supports it; otherwise the run uses its --adapter CLI.

**Enforced by:**

- [`packages/cli/src/loop/mcp-sampling.test.ts`](../packages/cli/src/loop/mcp-sampling.test.ts)
- [`packages/cli/src/loop/mcp-sampling.test.ts`](../packages/cli/src/loop/mcp-sampling.test.ts)
- [`packages/cli/src/loop/mcp-sampling.test.ts`](../packages/cli/src/loop/mcp-sampling.test.ts)
- [`packages/cli/src/loop/mcp-sampling.test.ts`](../packages/cli/src/loop/mcp-sampling.test.ts)
- [`packages/cli/src/loop/mcp-sampling.test.ts`](../packages/cli/src/loop/mcp-sampling.test.ts)
- [`packages/cli/src/loop/mcp-sampling.test.ts`](../packages/cli/src/loop/mcp-sampling.test.ts)
- [`packages/cli/src/loop/node-resolve.test.ts`](../packages/cli/src/loop/node-resolve.test.ts)
- [`packages/cli/src/loop/mcp-sampling.ts#samplingPreferences`](../packages/cli/src/loop/mcp-sampling.ts)
- [`packages/cli/src/loop/mcp-sampling.test.ts`](../packages/cli/src/loop/mcp-sampling.test.ts)
- [`packages/cli/src/loop/mcp-sampling.test.ts`](../packages/cli/src/loop/mcp-sampling.test.ts)
- [`packages/cli/src/loop/mcp-sampling.ts#samplingInvoke`](../packages/cli/src/loop/mcp-sampling.ts)
- [`packages/cli/src/loop/mcp-sampling.ts#hostSupportsSampling`](../packages/cli/src/loop/mcp-sampling.ts)
- CI `test`

## CLM-0109

**Status:** verified — **source:** [`CLM-0109.yaml`](../claims/registry/CLM-0109.yaml)

A model-CLI adapter subprocess runs in a caller-given working directory, not the parent's cwd: when the canonical loop drives an adapter it passes the task WORKSPACE as that cwd (#146), so an agentic CLI (claude/codex/opencode/agy) is grounded in — and confined to — the workspace, never the directory kernloop was launched from. Omitting cwd inherits the parent cwd (the documented default, exercised); the loop never omits it.

**Enforced by:**

- [`packages/kernel/src/adapters/subprocess.test.ts`](../packages/kernel/src/adapters/subprocess.test.ts)
- [`packages/kernel/src/adapters/subprocess.test.ts`](../packages/kernel/src/adapters/subprocess.test.ts)
- [`packages/kernel/src/adapters/invoke.test.ts`](../packages/kernel/src/adapters/invoke.test.ts)
- CI `test`

## CLM-0110

**Status:** verified — **source:** [`CLM-0110.yaml`](../claims/registry/CLM-0110.yaml)

`kernloop metrics` emits governance metrics in Prometheus text-exposition format (#125), DERIVED from real recorded data only: run outcomes (`kernloop_runs_total{capability,status}`) and gate verdicts (`kernloop_gate_verdicts_total{gate,result}`) and router decisions are counted off the audit chain, and metered cost (`kernloop_cost_tokens_total` / `kernloop_cost_usd_total`), per-gate decision cost, and per-voter running precision are read from the Observer ledger — nothing estimated or fabricated. Every family carries `# HELP`/`# TYPE` and is discoverable even when empty; label values are escaped; the text ends in a single trailing newline. The SAME families are also pushable over OTLP — `--otlp <endpoint>` records each counter's total and gauge's value into an OpenTelemetry meter (labels become attributes) and force-flushes once (#155); Prometheus stays the dependency-free default. It is a CLI-only view (NOT a twelfth MCP tool), read-only over the chain + ledger.

**Enforced by:**

- [`packages/cli/src/tools/metrics.test.ts`](../packages/cli/src/tools/metrics.test.ts)
- [`packages/cli/src/tools/metrics.test.ts`](../packages/cli/src/tools/metrics.test.ts)
- [`packages/cli/src/tools/metrics.test.ts`](../packages/cli/src/tools/metrics.test.ts)
- [`packages/cli/src/tools/metrics.test.ts`](../packages/cli/src/tools/metrics.test.ts)
- [`packages/cli/src/tools/metrics-otlp.test.ts`](../packages/cli/src/tools/metrics-otlp.test.ts)
- [`packages/cli/src/tools/metrics-otlp.test.ts`](../packages/cli/src/tools/metrics-otlp.test.ts)
- [`packages/cli/src/tools/metrics.ts#metricsExport`](../packages/cli/src/tools/metrics.ts)
- CI `test`

## CLM-0111

**Status:** verified — **source:** [`CLM-0111.yaml`](../claims/registry/CLM-0111.yaml)

`kernloop watch` live-tails the audit chain (#126) and renders a run's canonical-loop progression — routing, gate verdicts, child re-iterations, the document step, and the terminal Outcome — as readable `HH:MM:SS #seq` lines, optionally filtered to one id (`--task-id`, matching its task/run/child/job events). It is a CLI-only view (NOT a twelfth MCP tool) and READ-ONLY over `.kernloop/audit.jsonl`. The reader is LENIENT: a missing file is empty and a partial (mid-append) or corrupt line is skipped, so it never throws on a file being written. `--once` prints a snapshot and exits; the default FOLLOWS, printing events as they land and — with a task filter — exiting when that run reaches a terminal Outcome, always bounded by `--timeout-ms`.

**Enforced by:**

- [`packages/cli/src/tools/watch.test.ts`](../packages/cli/src/tools/watch.test.ts)
- [`packages/cli/src/tools/watch.test.ts`](../packages/cli/src/tools/watch.test.ts)
- [`packages/cli/src/tools/watch.test.ts`](../packages/cli/src/tools/watch.test.ts)
- [`packages/cli/src/tools/watch.test.ts`](../packages/cli/src/tools/watch.test.ts)
- [`packages/cli/src/tools/watch.test.ts`](../packages/cli/src/tools/watch.test.ts)
- [`packages/cli/src/tools/watch.test.ts`](../packages/cli/src/tools/watch.test.ts)
- [`packages/cli/src/tools/watch.ts#watchSnapshot`](../packages/cli/src/tools/watch.ts)
- CI `test`

## CLM-0112

**Status:** verified — **source:** [`CLM-0112.yaml`](../claims/registry/CLM-0112.yaml)

The Observer's four append-only logs (`observer_outcome_log`, `observer_verdict_log`, `observer_voter_series`, `observer_voter_labels`) are bounded by a retention window on open (#159): `createObserver` runs a single prune that deletes log rows older than `retentionMs` (default 90 days) before the NEWEST log row, off the ingest hot path. The reference "now" is the data's own newest timestamp — no clock read — so a deterministic write-clock is never disturbed and an empty database is a no-op. The KEYED aggregates (the fitness ledger and the issues table) are NOT logs and are never pruned, so no active subject loses its standing. Table names come from a fixed in-code allowlist, not caller input.

**Enforced by:**

- [`packages/faculty-observer/src/store.test.ts`](../packages/faculty-observer/src/store.test.ts)
- [`packages/faculty-observer/src/store.test.ts`](../packages/faculty-observer/src/store.test.ts)
- [`packages/faculty-observer/src/store.ts#pruneLogs`](../packages/faculty-observer/src/store.ts)
- CI `test`

## CLM-0113

**Status:** verified — **source:** [`CLM-0113.yaml`](../claims/registry/CLM-0113.yaml)

Drift-prone repository COUNTS are DERIVED from the canonical code const that defines each, never hand-typed (#189): `pnpm stats` derives the frozen-contract count (CONTRACT_NAMES), the kernel-tool count (KERNEL_TOOL_NAMES), the doc-gate language count (the vendored tree-sitter .wasm grammars), the doc-coverage gated-package count (GATED_PACKAGES), the workforce-template count (SHIPPED_TEMPLATE_NAMES), and the claim count (the CLM-*.yaml glob) — the const arrays parsed from source, never imported (the fast CI job has no build), and injects an at-a-glance block into README.md. `pnpm stats:check` (a CI gate) fails if that generated block is stale OR if any WATCHED prose count — in the charter, the spec, or a claim statement — diverges from the derived value (digits and English number words both parsed), so a protected/canonical file is CHECKED for drift without being machine-rewritten. An absent watched file is skipped; a watched phrase that has moved is reported, never silently ignored.

**Enforced by:**

- [`scripts/__tests__/stats.test.mjs`](../scripts/__tests__/stats.test.mjs)
- [`scripts/__tests__/stats.test.mjs`](../scripts/__tests__/stats.test.mjs)
- [`scripts/__tests__/stats.test.mjs`](../scripts/__tests__/stats.test.mjs)
- [`scripts/__tests__/stats.test.mjs`](../scripts/__tests__/stats.test.mjs)
- [`scripts/__tests__/stats.test.mjs`](../scripts/__tests__/stats.test.mjs)
- [`scripts/__tests__/stats.test.mjs`](../scripts/__tests__/stats.test.mjs)
- [`scripts/__tests__/stats.test.mjs`](../scripts/__tests__/stats.test.mjs)
- CI `test`

## CLM-0114

**Status:** verified — **source:** [`CLM-0114.yaml`](../claims/registry/CLM-0114.yaml)

kernloop program decompose-node grows a persisted program tree DEEPER than the one-shot `create` (#118): it loads stored node N from program P, runs the scrum faculty's `decomposeGoal` with N's stored TaskContract as the parent plus the `--spec` subtasks, and inserts the children as NEW ledger nodes pointing at N (`parentId = N`) — at `planned`, stored only, never filing anything (a later gated `program emit` files them parents-first and body-ref-links each to N). `decomposeGoal` enforces altitude descent (epic→story→task; a `task` leaf cannot decompose → a clean AltitudeDescentError exit), so depth is bounded. The store's addNodes is one transaction that REFUSES a node-id collision (DuplicateProgramNodeError — re-decomposing the same node never double-inserts) and a missing program (UnknownProgramError); an unknown node is a clean ProgramInputError. Audited once as cli.program.decompose-node (op + ids + childCount, never the goals verbatim).

**Enforced by:**

- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-ledger-commands.test.ts`](../packages/cli/src/program-ledger-commands.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-store.test.ts`](../packages/cli/src/program-store.test.ts)
- [`packages/cli/src/program-ledger-commands.ts#decomposeNodeOp`](../packages/cli/src/program-ledger-commands.ts)
- CI `test`

## CLM-0115

**Status:** verified — **source:** [`CLM-0115.yaml`](../claims/registry/CLM-0115.yaml)

The canonical loop attributes metered model spend PER fan-out child (#56), and enforces each child's OWN sliced budget independently of its siblings. Because children run sequentially, the engine slices the run-global meter by the child boundary: it snapshots an injected `meteredSpend` readout when it first steps into a child, sums spend across all the child's Kc iterations, and records the delta onto that child's result and into the run's `childSpend` — surfaced by the CLI as `report.childSpend`, one entry per metered child, each a slice of (never more than) the run total. Attribution is per-PROCESS, like the meter it reads (#212): a resume re-attributes from the fresh meter and DROPS any pre-resume child spend, so a child finished before a resume reports none and the sum stays within the (also per-process) run cost. The attribution is always-on: tracked in BOTH budget modes, the restriction is what `unlimited` lifts, never the metering; an unmetered run (no `meteredSpend` seam) attributes nothing. On top of attribution, in ENFORCE mode a child whose attributed spend exceeds ITS slice escalates on the next quality reject BEFORE Kc — bounded like the run-level guard but scoped to one child, so an over-slice child escalates without halting the run or its within-slice siblings; a zero-slice specialist (adds work, not budget) is never gated this way. In `unlimited` mode the per-child halt is lifted (an over-slice child re-iterates to Kc), mirroring the run-level discipline.

**Enforced by:**

- [`packages/workflows/src/child-spend.test.ts`](../packages/workflows/src/child-spend.test.ts)
- [`packages/workflows/src/child-spend.test.ts`](../packages/workflows/src/child-spend.test.ts)
- [`packages/workflows/src/child-spend.test.ts`](../packages/workflows/src/child-spend.test.ts)
- [`packages/workflows/src/child-spend.test.ts`](../packages/workflows/src/child-spend.test.ts)
- [`packages/workflows/src/child-spend.test.ts`](../packages/workflows/src/child-spend.test.ts)
- [`packages/cli/src/loop-attribution.test.ts`](../packages/cli/src/loop-attribution.test.ts)
- [`packages/workflows/src/budget.ts#childOverOwnBudget`](../packages/workflows/src/budget.ts)
- CI `test`

## CLM-0116

**Status:** verified — **source:** [`CLM-0116.yaml`](../claims/registry/CLM-0116.yaml)

`kernloop program close` (EPIC #50, the SAFE half) is the LEDGER-authoritative inverse of `reconcile`: for each node the program ledger already holds in `done` state with a filed `issueRef` it READS the GitHub issue via the hardened tracker `getIssue` (a read runs at any tier, like reconcile) and CLOSES the OPEN ones via `closeIssue` — reflecting "done per the ledger" to the tracker. It targets ONLY `done` nodes (an emitted/planned node is never closed); an already-closed issue is a no-op; the default close reason is `completed`, overridable with `--reason` (`completed`|`not planned`, validated by the tracker), and `--node` narrows to one node. The CLOSE mutation is DOUBLE-gated — `--execute` AND `tracker.tier: enforce` (resolveMode) — otherwise it stays a dry-run that proposes the would-be closes and spawns nothing, spelling out the enforce promotion when `--execute` is refused. It NEVER auto-merges and a success Outcome cannot trigger it (the canonical loop carries no issue ref — that link is deferred, needs a contract change + ratification; the ledger `done` state is the honest present proxy). A failed read or close leaves the issue untouched and exits 1; audited once as `cli.program.close` with counts only, never a goal.

**Enforced by:**

- [`packages/cli/src/program-close.test.ts`](../packages/cli/src/program-close.test.ts)
- [`packages/cli/src/program-close.test.ts`](../packages/cli/src/program-close.test.ts)
- [`packages/cli/src/program-close.test.ts`](../packages/cli/src/program-close.test.ts)
- [`packages/cli/src/program-close.test.ts`](../packages/cli/src/program-close.test.ts)
- [`packages/cli/src/program-close.test.ts`](../packages/cli/src/program-close.test.ts)
- [`packages/cli/src/program-close.test.ts`](../packages/cli/src/program-close.test.ts)
- [`packages/cli/src/program-close.test.ts`](../packages/cli/src/program-close.test.ts)
- [`packages/cli/src/program-close.test.ts`](../packages/cli/src/program-close.test.ts)
- [`packages/cli/src/program-close.test.ts`](../packages/cli/src/program-close.test.ts)
- [`packages/cli/src/program-close.ts#closeOp`](../packages/cli/src/program-close.ts)
- CI `test`

## CLM-0117

**Status:** verified — **source:** [`CLM-0117.yaml`](../claims/registry/CLM-0117.yaml)

`kernloop observer distill --subject S` (EPIC #50, the SAFE half) is a FITNESS-GATED distill: it distills a subject's recent successful trace into a suggest-tier skill proposal ONLY when the Observer's lifecycle pass already deems that subject distill-worthy — i.e. a `distill` LifecycleProposal exists for it (sustained lifetime success at/above the high-fitness bar over the minimum invocations, citing a real recent successful trace via the observer outcome log, CLM-0092). The proposal now carries that trace id, so the verb acts on it without re-parsing prose; a subject that has NOT earned it (no such proposal) is REFUSED with a clear message, never distilled — so distillation is governed by earned fitness, not invoked ad hoc. The distill reuses the existing `distill` tool (CLM-0049/0050): it writes the SKILL.md + PROPOSAL.yaml under `skills/proposed/`, NEVER the live library, so a human-reviewed PR is the only path live — this NEVER auto-merges. The act is audited once as `cli.observer.distill` (subject, trace, skill name, tier). It is a CLI verb, not a 12th MCP tool.

**Enforced by:**

- [`packages/cli/src/observer-distill.test.ts`](../packages/cli/src/observer-distill.test.ts)
- [`packages/cli/src/observer-distill.test.ts`](../packages/cli/src/observer-distill.test.ts)
- [`packages/cli/src/observer-distill.test.ts`](../packages/cli/src/observer-distill.test.ts)
- [`packages/cli/src/observer-commands.ts#distillReport`](../packages/cli/src/observer-commands.ts)
- CI `test`

## CLM-0118

**Status:** verified — **source:** [`CLM-0118.yaml`](../claims/registry/CLM-0118.yaml)

`kernloop run --closes-issue N` closes a GitHub issue when (and only when) the canonical-loop run it names SUCCEEDS (#211, EPIC #50's last piece) — the run-success-driven counterpart to `program close`'s ledger-driven closure. The run is the success signal: on a success Outcome the issue is closed through the SAME hardened, shared gated primitive (closeOneIssue/buildGatedCloseProvider, also used by `program close`), double-gated by `tracker.tier: enforce` (the `--closes-issue` flag is the explicit opt-in); a run that ESCALATED, FAILED, or produced a failure Outcome SKIPS the close and touches GitHub not at all — an issue is closed only by EARNED success, never optimistically. At suggest tier it reports `would-close` (refused); an already-closed issue is a no-op; a missing tracker block is a clean error. Audited once as `cli.run.close`. It NEVER auto-merges — it only closes a tracker issue the run earned. No Frozen-Five contract change: the issue ref rides on the CLI invocation, not the TaskContract.

**Enforced by:**

- [`packages/cli/src/run-close.test.ts`](../packages/cli/src/run-close.test.ts)
- [`packages/cli/src/run-close.test.ts`](../packages/cli/src/run-close.test.ts)
- [`packages/cli/src/run-close.test.ts`](../packages/cli/src/run-close.test.ts)
- [`packages/cli/src/run-close.test.ts`](../packages/cli/src/run-close.test.ts)
- [`packages/cli/src/run-close.test.ts`](../packages/cli/src/run-close.test.ts)
- [`packages/cli/src/run-close.ts#closeIssueAfterRun`](../packages/cli/src/run-close.ts)
- CI `test`

## CLM-0119

**Status:** verified — **source:** [`CLM-0119.yaml`](../claims/registry/CLM-0119.yaml)

Budget-aware model DOWNGRADE (#194, spec §8.4 cost lever): when an overlay declares `downgrade.atSpendFraction` and a run's metered spend reaches that fraction of the parent budget (the MAX of the token/usd fractions), the model-calling nodes that run AFTER that point route ONE model tier lower along MODEL_TIER_ORDER (frontier→large→medium→small) — a cheaper finish rather than only halting at the cap (CLM-0077). It is purely a cost lever: it only ever moves DOWN (never an upgrade), floors at `small`, changes only the tier (effort/capabilities untouched), and the lower served model is recorded honestly in the node's provenance plus a `cli.loop.downgrade` audit event (deduped once per node). Fail-safe and backward-compatible: with no `downgrade` config (or no budget) binding is byte-identical to before, and the per-node seam cache is bypassed ONLY when a downgrade is active, so the tier is re-resolved against live spend instead of frozen at first build.

**Enforced by:**

- [`packages/cli/src/loop/downgrade.test.ts`](../packages/cli/src/loop/downgrade.test.ts)
- [`packages/cli/src/loop/downgrade.test.ts`](../packages/cli/src/loop/downgrade.test.ts)
- [`packages/cli/src/loop/downgrade.test.ts`](../packages/cli/src/loop/downgrade.test.ts)
- [`packages/cli/src/loop/downgrade.test.ts`](../packages/cli/src/loop/downgrade.test.ts)
- [`packages/cli/src/loop/downgrade.test.ts`](../packages/cli/src/loop/downgrade.test.ts)
- [`packages/cli/src/loop/downgrade.test.ts`](../packages/cli/src/loop/downgrade.test.ts)
- [`packages/cli/src/loop/downgrade.test.ts`](../packages/cli/src/loop/downgrade.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/cli/src/loop/downgrade.ts#applyDowngrade`](../packages/cli/src/loop/downgrade.ts)
- CI `test`

## CLM-0120

**Status:** verified — **source:** [`CLM-0120.yaml`](../claims/registry/CLM-0120.yaml)

Every `[CLM-NNNN]` tag in README.md is a clickable link to a DERIVED, human-readable claims catalog, drift-checked and hand-edit-free (#219). render-claims generates two artifacts from the registry: (1) `docs/CLAIMS.md` — one anchored `## CLM-NNNN` section per claim carrying its status, statement, evidence (as resolving links), and a back-link to the YAML source; and (2) a block of markdown reference-link DEFINITIONS between the README's `claim-links` markers (`[CLM-NNNN]: docs/CLAIMS.md#clm-nnnn`), one per distinct claim the README's prose cites — so each existing bare `[CLM-NNNN]` shorthand becomes a link to its catalog section WITHOUT touching the 200+ inline tags. Both are regenerated by `pnpm claims:render` and a stale README block OR a stale `docs/CLAIMS.md` fails `--check` in CI. It also enforces honesty: a README that cites a `[CLM-NNNN]` with no registry file is a dangling tag (a doc that lies) and fails the gate. The link block is optional (a README without the markers is left untouched) and ids inside the generated block are excluded from the reference scan, so generation is stable and single-pass.

**Enforced by:**

- [`scripts/__tests__/render-claims.test.mjs`](../scripts/__tests__/render-claims.test.mjs)
- [`scripts/__tests__/render-claims.test.mjs`](../scripts/__tests__/render-claims.test.mjs)
- [`scripts/__tests__/render-claims.test.mjs`](../scripts/__tests__/render-claims.test.mjs)
- [`scripts/__tests__/render-claims.test.mjs`](../scripts/__tests__/render-claims.test.mjs)
- [`scripts/__tests__/render-claims.test.mjs`](../scripts/__tests__/render-claims.test.mjs)
- [`scripts/render-claims.mjs#renderCatalog`](../scripts/render-claims.mjs)
- [`scripts/render-claims.mjs#danglingClaimIds`](../scripts/render-claims.mjs)
- CI `test`

## CLM-0121

**Status:** verified — **source:** [`CLM-0121.yaml`](../claims/registry/CLM-0121.yaml)

The quality gate runs the task's OWN machine-checkable acceptance criteria (#226, EPIC #47·P1): `executeQualityGate` maps each `TaskContract.definitionOfDone` Check to a subprocess check (`checksFromDefinitionOfDone`) and runs them ALONGSIDE the base checks, so a child passes only when its own definition-of-done passes — not merely the repo's generic `pnpm typecheck/lint/test`. Wired at BOTH entry points the gate has a contract at: the `gate.quality` capability executor (the task's DoD) and the canonical loop's quality node (the child's DoD via `ctx.child.definitionOfDone`). Mapping is SECURE-by-default: each Check's `command` string is tokenized on whitespace into an executable + args and spawned WITH NO SHELL, so a model/spec-supplied command cannot inject shell metacharacters (`;`/`&&`/`$()` become literal argv). Exit 0 is the pass authority; a nonzero exit yields a `dod:<name>` error finding that fails the verdict; a blank command fails to start (fail CLOSED — a check that cannot run never silently passes). An empty/absent definitionOfDone adds no checks (byte-identical to before). Specs already carry `definitionOfDone` (StorySpec/SubtaskSpec), so this is end-to-end with no contract change. Env-scoping the check subprocess so a task command cannot read host secrets hardens this and the default `pnpm test` path alike, tracked in #227.

**Enforced by:**

- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/faculty-gates/src/run.test.ts`](../packages/faculty-gates/src/run.test.ts)
- [`packages/faculty-gates/src/run.test.ts`](../packages/faculty-gates/src/run.test.ts)
- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/faculty-gates/src/checks.ts#checksFromDefinitionOfDone`](../packages/faculty-gates/src/checks.ts)
- CI `test`

## CLM-0122

**Status:** verified — **source:** [`CLM-0122.yaml`](../claims/registry/CLM-0122.yaml)

A spawned model-CLI adapter child receives a LEAST-PRIVILEGE environment, not the parent's whole `process.env` (#227, EPIC #47·P1): `scopedChildEnv` hands the child only the kernel's benign base allowlist (`SAFE_ENV_KEYS` — PATH/HOME/locale/tmp/XDG, proxy + CA-cert operational vars, and `LC_*` by prefix) UNION the caller's declared extras, dropping everything else — so other providers' API keys, `GH_TOKEN`/`GITHUB_TOKEN`, and cloud credentials in kernloop's own env are NOT exposed to a third-party agentic binary for exfiltration. `invokeAdapter` scopes the child env on every CLI spawn while still PATH-probing on the full env (a read, never a hand-off). The escape hatch is the overlay's `adapterEnvAllow` (env-var NAMES only — a stray literal value is inert, matching no var and dropped, never a stored secret), threaded by the CLI through every adapter-spawn path — the canonical loop's base + per-node seams and the author/distill/gate/forge tools — defaulting to `[]` (a login-authed CLI works on HOME alone; a key-authed one names its key var). The redaction is audited, never silent: a real run appends a `cli.run.env-scoped` event recording how many host vars were withheld. The api-endpoint (OpenAI-compatible HTTP) adapter is UNAFFECTED — it `fetch`es with one configured key and never spawns.

**Enforced by:**

- [`packages/kernel/src/adapters/env.test.ts`](../packages/kernel/src/adapters/env.test.ts)
- [`packages/kernel/src/adapters/env.test.ts`](../packages/kernel/src/adapters/env.test.ts)
- [`packages/kernel/src/adapters/env.test.ts`](../packages/kernel/src/adapters/env.test.ts)
- [`packages/kernel/src/adapters/env.test.ts`](../packages/kernel/src/adapters/env.test.ts)
- [`packages/kernel/src/adapters/env.test.ts`](../packages/kernel/src/adapters/env.test.ts)
- [`packages/cli/src/loop/invoke.test.ts`](../packages/cli/src/loop/invoke.test.ts)
- [`packages/cli/src/loop/invoke.test.ts`](../packages/cli/src/loop/invoke.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/kernel/src/adapters/env.ts#scopedChildEnv`](../packages/kernel/src/adapters/env.ts)
- CI `test`

## CLM-0123

**Status:** verified — **source:** [`CLM-0123.yaml`](../claims/registry/CLM-0123.yaml)

The Docker sandbox primitive is a SHARED KERNEL primitive (#234, EPIC #47·P2 / #227 item 2): `runInSandbox`/`buildDockerArgs` and the sandbox errors live in `packages/kernel/src/sandbox/`, so any faculty can run model-supplied content under isolation by depending on `@kernloop/kernel` (faculty→kernel is permitted; rule 5 only bars faculty→faculty) — without duplicating the primitive. The kernel holds no intelligence (rule 4): this is process-isolation mechanism, no model call, and the docker binary is injectable (`dockerBin`) so the refusal path and every kernel unit test run hermetically (no daemon). The relocation is BEHAVIOR-PRESERVING and does NOT reopen the toolsmith's 6-1 ratification: the kernel validates only the generic EXECUTION knobs (a `SandboxExecProfile` — image/network='none'/user/workdir/memory/cpus/pidsLimit/timeoutMs), stripping a richer caller profile's governance fields, while `RATIFIED_SANDBOX_PROFILE` and its `RATIFIED_PROFILE_HASH` stay frozen in faculty-toolsmith with a byte-identical hash. The primitive still REFUSES (typed `SandboxUnavailableError`) when docker is absent — never an unsandboxed fallback — and the toolsmith's ratified profile drives the relocated primitive end-to-end.

**Enforced by:**

- [`packages/kernel/src/sandbox/sandbox.test.ts`](../packages/kernel/src/sandbox/sandbox.test.ts)
- [`packages/kernel/src/sandbox/sandbox.test.ts`](../packages/kernel/src/sandbox/sandbox.test.ts)
- [`packages/kernel/src/sandbox/sandbox.test.ts`](../packages/kernel/src/sandbox/sandbox.test.ts)
- [`packages/kernel/src/sandbox/sandbox.test.ts`](../packages/kernel/src/sandbox/sandbox.test.ts)
- [`packages/kernel/src/sandbox/errors.test.ts`](../packages/kernel/src/sandbox/errors.test.ts)
- [`packages/faculty-toolsmith/src/sandbox.test.ts`](../packages/faculty-toolsmith/src/sandbox.test.ts)
- [`packages/faculty-toolsmith/src/profile.test.ts`](../packages/faculty-toolsmith/src/profile.test.ts)
- [`packages/kernel/src/sandbox/sandbox.ts#runInSandbox`](../packages/kernel/src/sandbox/sandbox.ts)
- CI `test`

## CLM-0124

**Status:** verified — **source:** [`CLM-0124.yaml`](../claims/registry/CLM-0124.yaml)

A spawned quality-gate check runs under a LEAST-PRIVILEGE environment, not the host env (#235, EPIC #47·P2 / #227 item 2): the quality gate executes model-supplied and model-GENERATED code — `pnpm test` runs model-written test files, and `dod:*` checks run model-supplied commands — so `executeCheck` spawns each check with `scopedChildEnv(process.env, envAllow)` (the kernel allowlist from CLM-0122: `SAFE_ENV_KEYS` ∪ the caller's extras), withholding host secrets (other providers' API keys, `GH_TOKEN`/`GITHUB_TOKEN`, cloud credentials) from the check. The escape hatch is the overlay's `gates.quality.envAllow` (env-var NAMES only), threaded through both gate entry points — the `gate.quality` executor and the canonical loop's quality node — defaulting to `[]`; the composition root audits the redaction with a `cli.gate.env-scoped` event (rule 7, never silent). This is reliable, always-available containment (it needs no Docker or unprivileged user namespaces); the per-check wall-clock timeout already bounds runtime, and stronger network/filesystem isolation is the separately-tracked sandbox tier (#236).

**Enforced by:**

- [`packages/faculty-gates/src/run.test.ts`](../packages/faculty-gates/src/run.test.ts)
- [`packages/faculty-gates/src/run.test.ts`](../packages/faculty-gates/src/run.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/faculty-gates/src/run.ts#executeCheck`](../packages/faculty-gates/src/run.ts)
- CI `test`

## CLM-0125

**Status:** verified — **source:** [`CLM-0125.yaml`](../claims/registry/CLM-0125.yaml)

The Observer keeps an ADDITIVE per-model-call fitness series keyed on the normalized ModelIdentity tuple (provider, family, generation, tier), bucketing an `unknown` identity separately and never inventing a class, wired from each loop node's served identity via the seam's `onModelCall` hook, while the subject-keyed ledger (and the priors/router that read it) are unchanged.

**Enforced by:**

- [`packages/faculty-observer/src/identity-ledger.test.ts`](../packages/faculty-observer/src/identity-ledger.test.ts)
- [`packages/faculty-observer/src/identity-ledger.test.ts`](../packages/faculty-observer/src/identity-ledger.test.ts)
- [`packages/faculty-observer/src/identity-ledger.test.ts`](../packages/faculty-observer/src/identity-ledger.test.ts)
- [`packages/faculty-observer/src/identity-ledger.test.ts`](../packages/faculty-observer/src/identity-ledger.test.ts)
- [`packages/cli/src/loop/api-loop.test.ts`](../packages/cli/src/loop/api-loop.test.ts)
- [`packages/cli/src/loop/api-loop.test.ts`](../packages/cli/src/loop/api-loop.test.ts)
- [`packages/faculty-observer/src/identity-ledger.ts#ingestModelFitness`](../packages/faculty-observer/src/identity-ledger.ts)
- CI `test`

## CLM-0126

**Status:** verified — **source:** [`CLM-0126.yaml`](../claims/registry/CLM-0126.yaml)

The Router is seeded from the reviewed .kernloop/priors.yaml at the run composition root under an explicit router.seedPriors opt-in, with Laplace-smoothed scores so a thin sample cannot dominate, the priors BIASING not eliminating candidates (the exploration floor and neutral fallback stay intact), degrading to neutral routing on a missing or malformed file, and appending one audit event recording the per-subject discounted scores plus the file sha256 for reproducibility.

**Enforced by:**

- [`packages/cli/src/tools/priors-seed.test.ts`](../packages/cli/src/tools/priors-seed.test.ts)
- [`packages/cli/src/tools/priors-seed.test.ts`](../packages/cli/src/tools/priors-seed.test.ts)
- [`packages/cli/src/tools/priors-seed.test.ts`](../packages/cli/src/tools/priors-seed.test.ts)
- [`packages/cli/src/tools/priors-seed.test.ts`](../packages/cli/src/tools/priors-seed.test.ts)
- [`packages/cli/src/tools/priors-seed.test.ts`](../packages/cli/src/tools/priors-seed.test.ts)
- [`packages/cli/src/tools/priors-seed-influence.test.ts`](../packages/cli/src/tools/priors-seed-influence.test.ts)
- [`packages/cli/src/tools/priors-seed-influence.test.ts`](../packages/cli/src/tools/priors-seed-influence.test.ts)
- [`packages/cli/src/tools/priors-seed-influence.test.ts`](../packages/cli/src/tools/priors-seed-influence.test.ts)
- [`packages/cli/src/tools/priors-seed-influence.test.ts`](../packages/cli/src/tools/priors-seed-influence.test.ts)
- [`packages/cli/src/tools/priors-seed-influence.test.ts`](../packages/cli/src/tools/priors-seed-influence.test.ts)
- [`packages/cli/src/tools/priors-seed.ts#loadSeedPriors`](../packages/cli/src/tools/priors-seed.ts)
- CI `test`

## CLM-0127

**Status:** verified — **source:** [`CLM-0127.yaml`](../claims/registry/CLM-0127.yaml)

The audit chain stays gap-free and verifiable under CONCURRENT multi-process appends to one overlay, because appendEvent serializes via a better-sqlite3 BEGIN IMMEDIATE lock and sources seq/prevHash from a sidecar tip reconciled against the JSONL record-of-truth, the log remaining append-only JSONL with verifyChain unchanged.

**Enforced by:**

- [`packages/kernel/src/audit/concurrent.test.ts`](../packages/kernel/src/audit/concurrent.test.ts)
- [`packages/kernel/src/audit/chain.test.ts`](../packages/kernel/src/audit/chain.test.ts)
- [`packages/kernel/src/audit/chain.test.ts`](../packages/kernel/src/audit/chain.test.ts)
- [`packages/kernel/src/audit/chain.test.ts`](../packages/kernel/src/audit/chain.test.ts)
- [`packages/kernel/src/audit/store.ts#appendEvent`](../packages/kernel/src/audit/store.ts)
- CI `test`

## CLM-0128

**Status:** verified — **source:** [`CLM-0128.yaml`](../claims/registry/CLM-0128.yaml)

Under an explicit router.liveFitness opt-in (default off, separate from seedPriors), the Router's fitnessPriors are computed at the CLI composition root from the Observer's live ModelIdentity-fitness ledger over the seeded baseline and keyed on name@version to match the Router's own lookup: the exact (provider,family,generation,tier) score strictly overrides the class aggregate once it crosses a min-sample threshold; otherwise a recency-decayed, provider-scoped (provider,family,tier) aggregate bootstraps a new generation so learning TRANSFERS across a model-version bump; the live score overrides the seeded baseline only when its class has sufficient data; a malformed ledger row is dropped and a null/unknown identity degrades to the baseline; live scores are clamped to a bounded window, and together with the kernel exploration floor a regressing favorite is abandoned within a bounded horizon while no class is starved (shown by a contiguous-seed simulation, not a cherry-picked set); the ledger read is bounded (recency-ordered, fail-closed on an invalid bound) so a growing ledger cannot OOM the hot path; each candidate's source (live-exact/live-class-fallback/seeded-file/ neutral) and score are audited. The kernel Router is unchanged, so with one manifest per capability this is selection-inert in production and changes the selected manifest only when candidates compete.

**Enforced by:**

- [`packages/cli/src/tools/live-fitness.test.ts`](../packages/cli/src/tools/live-fitness.test.ts)
- [`packages/cli/src/tools/live-fitness.test.ts`](../packages/cli/src/tools/live-fitness.test.ts)
- [`packages/cli/src/tools/live-fitness.test.ts`](../packages/cli/src/tools/live-fitness.test.ts)
- [`packages/cli/src/tools/live-fitness.test.ts`](../packages/cli/src/tools/live-fitness.test.ts)
- [`packages/cli/src/tools/live-fitness.test.ts`](../packages/cli/src/tools/live-fitness.test.ts)
- [`packages/cli/src/tools/live-fitness.test.ts`](../packages/cli/src/tools/live-fitness.test.ts)
- [`packages/cli/src/tools/live-fitness.test.ts`](../packages/cli/src/tools/live-fitness.test.ts)
- [`packages/cli/src/tools/live-fitness.test.ts`](../packages/cli/src/tools/live-fitness.test.ts)
- [`packages/cli/src/tools/live-fitness.test.ts`](../packages/cli/src/tools/live-fitness.test.ts)
- [`packages/cli/src/tools/live-fitness.test.ts`](../packages/cli/src/tools/live-fitness.test.ts)
- [`packages/cli/src/tools/live-fitness.test.ts`](../packages/cli/src/tools/live-fitness.test.ts)
- [`packages/cli/src/tools/live-fitness.sim.test.ts`](../packages/cli/src/tools/live-fitness.sim.test.ts)
- [`packages/cli/src/tools/live-fitness.sim.test.ts`](../packages/cli/src/tools/live-fitness.sim.test.ts)
- [`packages/cli/src/tools/live-fitness-wiring.test.ts`](../packages/cli/src/tools/live-fitness-wiring.test.ts)
- [`packages/cli/src/tools/live-fitness-wiring.test.ts`](../packages/cli/src/tools/live-fitness-wiring.test.ts)
- [`packages/cli/src/tools/live-fitness-wiring.test.ts`](../packages/cli/src/tools/live-fitness-wiring.test.ts)
- [`packages/faculty-observer/src/identity-ledger.test.ts`](../packages/faculty-observer/src/identity-ledger.test.ts)
- [`packages/faculty-observer/src/identity-ledger.test.ts`](../packages/faculty-observer/src/identity-ledger.test.ts)
- [`packages/cli/src/tools/live-fitness.ts#liveFitnessPriors`](../packages/cli/src/tools/live-fitness.ts)
- CI `test`

## CLM-0129

**Status:** verified — **source:** [`CLM-0129.yaml`](../claims/registry/CLM-0129.yaml)

The Docker gate sandbox is DEFAULT-ON (#227: gates.quality.sandbox defaults enabled:true, enforce:false) — generated code is sandboxed when Docker is available and falls back to the env-scoped host spawn when it is not; set enabled:false for the legacy always-host behavior or enforce:true to fail closed. When enabled, the quality gate runs each subprocess check inside the kernel Docker sandbox: the workspace is copied into an ephemeral scratch — excluding .git and credential-bearing files and never dereferencing escaping symlinks — together with its node_modules, and the check runs under a DIGEST-PINNED, content-hash-pinned (ratified profile only; no overlay override), non-root, --network none, memory/cpu/pids-capped profile via runInSandbox; pnpm/yarn script commands are translated to npm run so they execute offline against the copied node_modules. A FUNCTIONAL Docker probe selects the tier; with the sandbox enabled and Docker unavailable the enforce path FAILS CLOSED (refuses to run generated checks unsandboxed) while an explicit opt-out degrades to the env-scoped host spawn, and the achieved isolation tier is surfaced in the Verdict (tier-reported == tier-applied). Disabled, the gate is byte-identical to the env-scoped host spawn. Real-docker tests prove network egress is blocked, host filesystem outside the scratch is unreadable, a fork-bomb is capped, and a glibc native dependency still loads.

**Enforced by:**

- [`packages/faculty-gates/src/sandbox/profile.test.ts`](../packages/faculty-gates/src/sandbox/profile.test.ts)
- [`packages/faculty-gates/src/sandbox/profile.test.ts`](../packages/faculty-gates/src/sandbox/profile.test.ts)
- [`packages/faculty-gates/src/sandbox/profile.test.ts`](../packages/faculty-gates/src/sandbox/profile.test.ts)
- [`packages/faculty-gates/src/sandbox/copy.test.ts`](../packages/faculty-gates/src/sandbox/copy.test.ts)
- [`packages/faculty-gates/src/sandbox/copy.test.ts`](../packages/faculty-gates/src/sandbox/copy.test.ts)
- [`packages/faculty-gates/src/sandbox/run-check.test.ts`](../packages/faculty-gates/src/sandbox/run-check.test.ts)
- [`packages/faculty-gates/src/sandbox/run-check.test.ts`](../packages/faculty-gates/src/sandbox/run-check.test.ts)
- [`packages/faculty-gates/src/sandbox/run-check.test.ts`](../packages/faculty-gates/src/sandbox/run-check.test.ts)
- [`packages/faculty-gates/src/sandbox/gate-tier.test.ts`](../packages/faculty-gates/src/sandbox/gate-tier.test.ts)
- [`packages/faculty-gates/src/sandbox/gate-tier.test.ts`](../packages/faculty-gates/src/sandbox/gate-tier.test.ts)
- [`packages/faculty-gates/src/sandbox/gate-tier.test.ts`](../packages/faculty-gates/src/sandbox/gate-tier.test.ts)
- [`packages/faculty-gates/src/sandbox/gate-tier.test.ts`](../packages/faculty-gates/src/sandbox/gate-tier.test.ts)
- [`packages/faculty-gates/src/sandbox/run-check.docker.test.ts`](../packages/faculty-gates/src/sandbox/run-check.docker.test.ts)
- [`packages/faculty-gates/src/sandbox/run-check.docker.test.ts`](../packages/faculty-gates/src/sandbox/run-check.docker.test.ts)
- [`packages/faculty-gates/src/sandbox/run-check.docker.test.ts`](../packages/faculty-gates/src/sandbox/run-check.docker.test.ts)
- [`packages/faculty-gates/src/sandbox/run-check.docker.test.ts`](../packages/faculty-gates/src/sandbox/run-check.docker.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/faculty-gates/src/run.ts#runQualityGate`](../packages/faculty-gates/src/run.ts)
- CI `test`

## CLM-0130

**Status:** verified — **source:** [`CLM-0130.yaml`](../claims/registry/CLM-0130.yaml)

Under an explicit gates-adjacent adapterFitness.enabled opt-in (default off, epsilon default 0.1), node-bind's per-tier adapter binding selects among a tier's candidate adapters by live ModelIdentity fitness: overlay.adapters[tier] accepts a single name (unchanged) or a non-empty candidate list, and with >=2 candidates the higher-fitness candidate is chosen via the CLM-0128 liveFitnessPriors scoring over a NEUTRAL (live-only) baseline with an exploration floor (epsilon=0 is pure exploit; a lower-fitness candidate stays selectable so a better-but-untried one is not starved). Each candidate's served identity is predicted by the SAME deterministic resolution node-bind uses at call time, so predicted == served for BOTH transports: a CLI candidate via resolveServed, a registered ENDPOINT candidate via the api path (resolveServedApi over its apiDefinitionFor), both normalized through servedIdentity (#260) — a name that resolves to neither scores neutral. That predicted==served invariant is guarded STRUCTURALLY by a single shared resolveServedFor helper both the selector and node-bind call, not two hand-kept copies (#271). The choice, candidates, predicted identities, scores, sources, and the rng draw are audited (reproducible). With the flag off or a single adapter the first candidate is bound, byte-identical to the prior behavior. Unlike the selection-inert Router priors path (CLM-0128), this changes a real production decision whenever a tier lists competing CLI adapters. A contiguous-seed simulation proves a regressing favorite is abandoned within a bounded horizon AND that the exploration floor discovers a better-but-untried adapter (so neither is starved).

**Enforced by:**

- [`packages/cli/src/loop/adapter-fitness.test.ts`](../packages/cli/src/loop/adapter-fitness.test.ts)
- [`packages/cli/src/loop/adapter-fitness.test.ts`](../packages/cli/src/loop/adapter-fitness.test.ts)
- [`packages/cli/src/loop/adapter-fitness.test.ts`](../packages/cli/src/loop/adapter-fitness.test.ts)
- [`packages/cli/src/loop/adapter-fitness.test.ts`](../packages/cli/src/loop/adapter-fitness.test.ts)
- [`packages/cli/src/loop/adapter-fitness.test.ts`](../packages/cli/src/loop/adapter-fitness.test.ts)
- [`packages/cli/src/loop/adapter-fitness.test.ts`](../packages/cli/src/loop/adapter-fitness.test.ts)
- [`packages/cli/src/loop/adapter-fitness.test.ts`](../packages/cli/src/loop/adapter-fitness.test.ts)
- [`packages/cli/src/loop/adapter-fitness.test.ts`](../packages/cli/src/loop/adapter-fitness.test.ts)
- [`packages/cli/src/loop/resolve-served.test.ts`](../packages/cli/src/loop/resolve-served.test.ts)
- [`packages/cli/src/loop/resolve-served.test.ts`](../packages/cli/src/loop/resolve-served.test.ts)
- [`packages/cli/src/loop/resolve-served.test.ts`](../packages/cli/src/loop/resolve-served.test.ts)
- [`packages/cli/src/loop/resolve-served.ts#resolveServedFor`](../packages/cli/src/loop/resolve-served.ts)
- [`packages/cli/src/loop/adapter-fitness.sim.test.ts`](../packages/cli/src/loop/adapter-fitness.sim.test.ts)
- [`packages/cli/src/loop/adapter-fitness.sim.test.ts`](../packages/cli/src/loop/adapter-fitness.sim.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/cli/src/overlay-schemas.test.ts`](../packages/cli/src/overlay-schemas.test.ts)
- [`packages/cli/src/overlay-schemas.test.ts`](../packages/cli/src/overlay-schemas.test.ts)
- [`packages/cli/src/loop/adapter-fitness.ts#chooseAdapter`](../packages/cli/src/loop/adapter-fitness.ts)
- CI `test`

## CLM-0131

**Status:** verified — **source:** [`CLM-0131.yaml`](../claims/registry/CLM-0131.yaml)

`models sync` discovers an agent-CLI adapter's ENUMERABLE model list (#131): for a list-exposing CLI (opencode) it spawns the FIXED `<adapter> models` command under a bounded subprocess (static argv, no shell, a neutral cwd so the agentic CLI never inherits the launch dir, a per-stream capture cap, and a wall-clock timeout), parses stdout as DATA ONLY (one id per line, trimmed, length-bounded, de-duplicated, count-capped — a model id is never executed; one that fails identity normalization just resolves to unknown), normalizes the ids through the vendored catalog, and REPLACES the `cli-live:<adapter>` source in the machine-local discovered cache. The third-party CLI's child env is SCOPED (the benign operational allowlist ∪ the overlay's `adapterEnvAllow`) so the host secrets — other providers' keys, GH_TOKEN, cloud creds — never reach it, and a hostile-discovered id that collides with an Object.prototype member (`__proto__`, `constructor`) is NOT a table hit (own-property guard), so it cannot DoS the source. An adapter with no list command yields no live source (its declared `cli:<adapter>` tier-bindings cover it, #171); an absent/failed/timed-out CLI is an honest typed per-source failure (AdapterExecutionError/AdapterTimeoutError), never a fabricated list. The live probe is skippable (skipCliLive) and the runner is injectable.

**Enforced by:**

- [`packages/kernel/src/adapters/discover-cli.test.ts`](../packages/kernel/src/adapters/discover-cli.test.ts)
- [`packages/kernel/src/adapters/discover-cli.test.ts`](../packages/kernel/src/adapters/discover-cli.test.ts)
- [`packages/kernel/src/adapters/discover-cli.test.ts`](../packages/kernel/src/adapters/discover-cli.test.ts)
- [`packages/kernel/src/adapters/discover-cli.test.ts`](../packages/kernel/src/adapters/discover-cli.test.ts)
- [`packages/kernel/src/adapters/discover-cli.test.ts`](../packages/kernel/src/adapters/discover-cli.test.ts)
- [`packages/kernel/src/adapters/discover-cli.test.ts`](../packages/kernel/src/adapters/discover-cli.test.ts)
- [`packages/kernel/src/adapters/discover-cli.test.ts`](../packages/kernel/src/adapters/discover-cli.test.ts)
- [`packages/kernel/src/adapters/discover-cli.test.ts`](../packages/kernel/src/adapters/discover-cli.test.ts)
- [`packages/faculty-models/src/resolve.test.ts`](../packages/faculty-models/src/resolve.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/cli/src/tools/models.test.ts`](../packages/cli/src/tools/models.test.ts)
- [`packages/kernel/src/adapters/discover.ts#discoverCliModels`](../packages/kernel/src/adapters/discover.ts)
- CI `test`

## CLM-0132

**Status:** verified — **source:** [`CLM-0132.yaml`](../claims/registry/CLM-0132.yaml)

The quality gate ships a built-in MODEL-FREE security check over generated deliverable code (#277, #227 item 3, spec §5.3) — an always-on in-process scan (no external binary, so it never degrades to no-signal) wired into the DEFAULT check set as `security`, at the faculty's advisory tier. It is a CURATED high-confidence, low-false-positive smell detector, NOT exhaustive SAST: it flags dynamic code execution (`eval`/`new Function` with a NON-literal argument — a string literal is the safe form and is NOT flagged), shell-command injection (the SHELL-invoking `exec`/`execSync` with a non-literal command in a file that imports child_process — the argv-array `spawn`/`execFile` are safe and NEVER flagged), and known-FORMAT hardcoded secrets (AWS/GitHub/Google/Slack keys, PEM private keys), each as an advisory `error` Finding. It reads source as DATA (AST + regex, never executed), never throws on unparseable OR deeply-nested input (a depth-bounded AST visit + a defensive catch, so a crafted file cannot overflow the in-process gate), and reuses the shared no-symlink-follow walk + byte budgets so an untrusted workspace cannot escape the tree or OOM the loop — the walk STREAMS paths lazily as a generator (#278), so even a millions-of-files tree builds no unbounded path array before the byte budgets engage. It is HONEST about its evasions: the code rules match a BARE eval/Function/exec name, so indirection (globalThis['ev'+'al'], an aliased eval) and any call nested past the depth cap are NOT flagged, and the secret scan reports the first match of each format per file — acceptable because it is advisory and claims no completeness. The broader external-tool (semgrep/secret-scan) tier is deferred (#276) until the binaries can be bundled into the gate sandbox.

**Enforced by:**

- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/fs-walk.test.ts`](../packages/docscan/src/fs-walk.test.ts)
- [`packages/docscan/src/fs-walk.test.ts`](../packages/docscan/src/fs-walk.test.ts)
- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/docscan/src/security-scan.ts#scanSecuritySmells`](../packages/docscan/src/security-scan.ts)
- CI `test`

## CLM-0133

**Status:** verified — **source:** [`CLM-0133.yaml`](../claims/registry/CLM-0133.yaml)

The canonical loop SURFACES an advisory review gate's correctness REJECT as a non-blocking `needs-review` Outcome signal (#226 item 5, EPIC #47·P1): the review gate is advisory and its Verdict was published to the audit chain but otherwise invisible to the operator, so a child whose review rejected appeared in a plain `success` Outcome with no residual-doubt flag. The integrate node now appends a `needs-review` Signal (passed:false, naming the child id and the concrete review finding) for each rejecting child — computed from `ChildResult.reviewVerdict` — so it rides the run's Outcome (JSON on stdout, spec §3.4) and is recorded to memory. Status is decided by the BLOCKING child signals ALONE, so the advisory reject is SURFACED, NEVER auto-failing an otherwise-passing run; an approving or abstaining review adds no signal.

**Enforced by:**

- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/cli/src/loop/aggregate.ts#reviewConcernSignals`](../packages/cli/src/loop/aggregate.ts)
- CI `test`

## CLM-0134

**Status:** verified — **source:** [`CLM-0134.yaml`](../claims/registry/CLM-0134.yaml)

The quality gate flags generated code a child WROTE that the test suite never exercises (#226 item 2, EPIC #47·P1) — the rubber-stamp that AGGREGATE per-package coverage thresholds miss when a child adds untested code to a large package. A MODEL-FREE in-process `diff-coverage` check (ratified Option A) reads ONLY the child's written files (`b.refs.writtenByChild`) and the workspace's Istanbul/v8 `coverage/coverage-final.json` — no git, no snapshot: an EXECUTABLE written source file ABSENT from the report (no test even loads it) is an `error`, uncovered statements in a covered file are a `warn`, and a missing report FAILS CLOSED with an `error` (the scanner runs only under the explicit opt-in, so a graceful pass would let an agent disable the reporter to bypass the gate). A `.d.ts`, a test file, or a pure type/re-export module is LEGITIMATELY absent from coverage, so a written file is judged only when its extension is executable source AND a TS-AST check (`hasExecutableCode`) confirms it carries runtime-coverable code — never a false error on a type-only module. Coverage keys match by absolute path OR path suffix (so a sandbox-relocated report still resolves). It is wired into the loop quality node under an explicit opt-in `gates.quality.diffCoverage` (default OFF — a new gate behavior that changes loop outcomes, promoted to default-on on evidence); the stricter new-file-only / git-diff-changed-line granularity is deferred (#282).

**Enforced by:**

- [`packages/docscan/src/coverage-scan.test.ts`](../packages/docscan/src/coverage-scan.test.ts)
- [`packages/docscan/src/coverage-scan.test.ts`](../packages/docscan/src/coverage-scan.test.ts)
- [`packages/docscan/src/coverage-scan.test.ts`](../packages/docscan/src/coverage-scan.test.ts)
- [`packages/docscan/src/coverage-scan.test.ts`](../packages/docscan/src/coverage-scan.test.ts)
- [`packages/docscan/src/coverage-scan.test.ts`](../packages/docscan/src/coverage-scan.test.ts)
- [`packages/docscan/src/coverage-scan.test.ts`](../packages/docscan/src/coverage-scan.test.ts)
- [`packages/docscan/src/coverage-scan.test.ts`](../packages/docscan/src/coverage-scan.test.ts)
- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/docscan/src/coverage-scan.ts#scanWrittenCoverage`](../packages/docscan/src/coverage-scan.ts)
- CI `test`

## CLM-0135

**Status:** verified — **source:** [`CLM-0135.yaml`](../claims/registry/CLM-0135.yaml)

The review gate can judge GOAL-FIDELITY, not only code defects (#226 item 3, EPIC #47·P1): under an explicit OPT-IN `gates.review.groundedness` (default OFF — an UNPROVEN model-judge, off ⇒ byte-identical to before) the canonical loop threads the child's task GOAL + its definitionOfDone acceptance criteria into the review CONTEXT shared with every reviewer, and — when a goal/context exists — convenes a GROUNDEDNESS reviewer lens whose rubric judges whether the diff achieves the goal and cites which acceptance criteria it satisfies/violates. It is ADVISORY: a goal-mismatch reject surfaces as a non-blocking needs-review Outcome signal (CLM-0133), never auto-failing the run. A model judging goal-fidelity is self-grading-prone, so this claims ONLY the WIRING — the goal is threaded, the groundedness lens is convened, and a reject is surfaced — NOT that the reviewer RELIABLY detects goal-mismatch; the real precision is measured by a separate live eval and never trusted blind (#287). The hermetic golden eval (#286) asserts the wiring (a groundedness reject flows to a needs-review signal), not the model's judgment.

**Enforced by:**

- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/faculty-gates/src/review/reviewers.ts#REVIEWER_GROUNDEDNESS`](../packages/faculty-gates/src/review/reviewers.ts)
- CI `test`

## CLM-0136

**Status:** verified — **source:** [`CLM-0136.yaml`](../claims/registry/CLM-0136.yaml)

The review gate bounds its UNTRUSTED reviewer input before the model prompt (#288, EPIC #47·P1 security round). The diff is the child's full written content and (opt-in) the context is its goal + every DoD command — either of which a runaway or adversarial child can self-inflate into a multi-megabyte blob that would otherwise be sent verbatim to every reviewer (3-4 concurrent model calls), a cost / latency / context-window denial. `reviewerPrompt` clamps the diff and the context to fixed per-field char caps, keeping the HEAD and appending a visible truncation marker so each reviewer judges honestly on a bounded, partial input rather than silently losing content. To close the review-EVASION risk (a child padding benign content to push a payload past the cut), when — and only when — the gate ACTUALLY truncated it also emits a TRUSTED, gate-authored notice (keyed on the gate's own knowledge, never on child-controlled text, so a forged marker can only make review stricter) that the reviewer is seeing only the HEAD and must not clean-approve a partial diff. This claims the BOUND and the anti-evasion notice and their wiring into the assembled prompt, exercised through the real reviewer seam — not that any particular cap is optimal.

**Enforced by:**

- [`packages/cli/src/loop/seams.test.ts`](../packages/cli/src/loop/seams.test.ts)
- [`packages/cli/src/loop/seams.test.ts`](../packages/cli/src/loop/seams.test.ts)
- [`packages/cli/src/loop/seams.test.ts`](../packages/cli/src/loop/seams.test.ts)
- [`packages/cli/src/loop/seams.test.ts`](../packages/cli/src/loop/seams.test.ts)
- [`packages/cli/src/loop/seams.test.ts`](../packages/cli/src/loop/seams.test.ts)
- CI `test`

## CLM-0137

**Status:** verified — **source:** [`CLM-0137.yaml`](../claims/registry/CLM-0137.yaml)

The canonical loop emits IN-FLIGHT spend: every node executor is wrapped so it appends a `loop.spend` audit event WHENEVER that node actually spent (delta > 0), carrying the per-node token/usd delta AND the cumulative run total (EPIC #47·P5 #230). An operator tailing the audit log (or `watch`, which now renders the event) sees cost accumulate as the run progresses instead of only in the final report. The event is appended in a `finally`, so a node that spends then THROWS still records spend-to-failure before the error propagates. A zero-spend node appends NOTHING — the design vote's load-bearing condition: the financial audit chain is not polluted with heartbeat noise. It is observe-tier telemetry (it records, it never acts) and reuses the existing free-form kernel audit append, so no contract or kernel change was needed.

**Enforced by:**

- [`packages/cli/src/loop/spend-audit.test.ts`](../packages/cli/src/loop/spend-audit.test.ts)
- [`packages/cli/src/loop/spend-audit.test.ts`](../packages/cli/src/loop/spend-audit.test.ts)
- [`packages/cli/src/loop/spend-audit.test.ts`](../packages/cli/src/loop/spend-audit.test.ts)
- [`packages/cli/src/loop/spend-audit.test.ts`](../packages/cli/src/loop/spend-audit.test.ts)
- [`packages/cli/src/tools/watch.test.ts`](../packages/cli/src/tools/watch.test.ts)
- [`packages/cli/src/loop/executors-nodes.ts#withSpendAudit`](../packages/cli/src/loop/executors-nodes.ts)
- CI `test`

## CLM-0138

**Status:** verified — **source:** [`CLM-0138.yaml`](../claims/registry/CLM-0138.yaml)

kernloop estimates a run's model-CALL-COUNT before it runs (EPIC #47·P5 #303): a PURE function over the frozen CANONICAL_LOOP shape × the overlay K/Kc/panel config returns a [min,max] band — min the first-pass happy path, max assuming every gate iterates to its cap (plan ×(K+1), implement ×(Kc+1)) and the CLM-0107 parse-retry fires — broken down per node (quality contributes ZERO, being mechanical). `kernloop doctor` surfaces it with its assumptions stated, including that the child count is an explicit assumed input (decompose decides it at runtime). It is HONEST about what it cannot know: it NEVER fabricates a dollar figure (per-call cost is metered at runtime, not declared) — a $ projection is only the caller's own explicit rate × this count. The arithmetic is BOUND TO ACTUAL loop behavior: a real hermetic canonical-loop run counts its model calls and they equal the estimate's min (the happy path) and never exceed its max — proving the estimate tracks the loop, not only itself. The same estimator is surfaced per-invocation by `kernloop run --estimate` (#305), which prints the band for THIS overlay's loop shape (its K/Kc, vote panel, review groundedness, the live review-drives-iteration tier, and parsimony intensity) and exits WITHOUT running.

**Enforced by:**

- [`packages/cli/src/run-command.test.ts`](../packages/cli/src/run-command.test.ts)
- [`packages/cli/src/run-command.test.ts`](../packages/cli/src/run-command.test.ts)
- [`packages/cli/src/run-command.test.ts`](../packages/cli/src/run-command.test.ts)
- [`packages/cli/src/cost-estimate.test.ts`](../packages/cli/src/cost-estimate.test.ts)
- [`packages/cli/src/cost-estimate.test.ts`](../packages/cli/src/cost-estimate.test.ts)
- [`packages/cli/src/cost-estimate.test.ts`](../packages/cli/src/cost-estimate.test.ts)
- [`packages/cli/src/doctor.test.ts`](../packages/cli/src/doctor.test.ts)
- [`packages/cli/src/cost-estimate.ts#estimateLoopCalls`](../packages/cli/src/cost-estimate.ts)
- CI `test`

## CLM-0139

**Status:** verified — **source:** [`CLM-0139.yaml`](../claims/registry/CLM-0139.yaml)

A ratified skill's PROCEDURE reaches a later brief (EPIC #47·P3 #228 constituent 1 — the first slice that closes the learning loop). `gatherSkillBodies` loads the full body of every LIVE `skills/<name>/SKILL.md` whose name + one-liner shares a non-stop-word token with the task goal, ranked by lexical overlap count with a code-unit name tie-break, capped at the top 3; the compiler injects them as a lowest-priority, per-section-token-capped `skillBodies` brief section carrying `skill:<name>:body` provenance, so under budget pressure the heavy bodies drop FIRST (the cheap one-liner index survives as a fallback). `skills/proposed/**` is NEVER a body (CLM-0050 — already-ratified content only). It is DETERMINISTIC (no model call, no clock — CLM-0029) and reuses the item-granular budget drop (CLM-0030). HONESTY BOUNDARY: the relevance gate is LEXICAL, not semantic — this claims the WIRING (a live body is loaded, relevance-filtered, deterministically ranked, proposed-excluded, budget-bounded, and reaches the brief), NOT that it finds the "right" skills nor that injection IMPROVES outcomes (efficacy is the separate artifact-level fitness attribution, #228 constituent 2, never asserted here).

**Enforced by:**

- [`packages/cli/src/gather.test.ts`](../packages/cli/src/gather.test.ts)
- [`packages/cli/src/gather.test.ts`](../packages/cli/src/gather.test.ts)
- [`packages/cli/src/gather.test.ts`](../packages/cli/src/gather.test.ts)
- [`packages/cli/src/gather.test.ts`](../packages/cli/src/gather.test.ts)
- [`packages/cli/src/gather.test.ts`](../packages/cli/src/gather.test.ts)
- [`packages/cli/src/gather.ts#gatherSkillBodies`](../packages/cli/src/gather.ts)
- CI `test`

## CLM-0140

**Status:** verified — **source:** [`CLM-0140.yaml`](../claims/registry/CLM-0140.yaml)

The canonical loop ATTRIBUTES its outcome to the skills it reused (EPIC #47·P3 #228 constituent 2 — the MEASURE half of the learning loop #309 wired). On retrospect the loop reads the skills whose BODY survived the token budget into the brief (the `skillBodies` section's `skill:<name>:body` provenance) and, for each, records the run's Outcome against a `skill:<name>` subject in the observer fitness ledger, appending one `loop.skill.attributed` audit event. A body the budget DROPPED (never presented to the model) is NOT attributed; a `proposed/` skill is never injected so never attributed (CLM-0050); attribution fires EXACTLY ONCE per run (idempotent across a resume that re-runs retrospect). It is records-ONLY and safe for the no-auto-promote ladder: `ingestOutcome` only UPSERTs aggregate stats, a `skill:<name>` subject feeds only the SUGGEST-tier lifecycle (human-ratified) and is INERT for routing (it is never a registered manifest, so never a routing candidate). HONESTY BOUNDARY: this is a CORRELATIONAL signal — "a run whose brief carried skill X had outcome O" — NOT a causal claim; when several skills survive, the single whole-loop Outcome is credited to EACH (a co-occurrence confound), so a per-skill rate is "rate of runs that carried the skill", read by a human, never auto-acted. This claims the ATTRIBUTION WIRING, not that the signal proves a skill's value.

**Enforced by:**

- [`packages/cli/src/loop/skill-attribution.test.ts`](../packages/cli/src/loop/skill-attribution.test.ts)
- [`packages/cli/src/loop/skill-attribution.test.ts`](../packages/cli/src/loop/skill-attribution.test.ts)
- [`packages/cli/src/loop/skill-attribution.test.ts`](../packages/cli/src/loop/skill-attribution.test.ts)
- [`packages/cli/src/loop/skill-attribution.test.ts`](../packages/cli/src/loop/skill-attribution.test.ts)
- [`packages/cli/src/loop/skill-attribution.test.ts`](../packages/cli/src/loop/skill-attribution.test.ts)
- [`packages/cli/src/loop/skill-attribution.ts#attributeSkillFitness`](../packages/cli/src/loop/skill-attribution.ts)
- CI `test`

## CLM-0141

**Status:** verified — **source:** [`CLM-0141.yaml`](../claims/registry/CLM-0141.yaml)

The loop SURFACES the tools the system forged for itself (EPIC #47·P3 #228 constituent 3 — the 2nd of the three learning-loop breaks). `gatherWorkshopIndex` reads the overlay's workshop tools and surfaces only the advisory-or-above, LIVE ones as a lowest-priority `workshopIndex` brief section of capability HINTS — each "<name> (<tier>): a forged tool — run via `kernloop workshop run <name>`" with `workshop:<name>` provenance. A born/decayed `suggest` tool is UNPROVEN and excluded; a `removal_proposed` tool is excluded — the RECORDED post-sweep lifecycle tier is authoritative (CLM-0054), so decay is respected without this read applying a clock. DETERMINISTIC: same overlay ⇒ the same name-sorted hints (CLM-0029). HONESTY BOUNDARY: this surfaces AWARENESS — the loop learns the tool exists and its documented CLI run target — it is a HINT, NEVER a 12th MCP tool (spec §3.4), and gives the loop NO callable path (the loop runs the kernel eleven, not `workshop run`; awareness ≠ closure, and suggest→advisory promotion remains manual by design). It claims the WIRING (advisory+ live tools surface deterministically, below-advisory/removal_proposed excluded, the registry gains no tool), NOT that surfacing improves outcomes.

**Enforced by:**

- [`packages/cli/src/gather.test.ts`](../packages/cli/src/gather.test.ts)
- [`packages/cli/src/gather.test.ts`](../packages/cli/src/gather.test.ts)
- [`packages/cli/src/gather.test.ts`](../packages/cli/src/gather.test.ts)
- [`packages/cli/src/gather.test.ts`](../packages/cli/src/gather.test.ts)
- [`packages/cli/src/gather.ts#gatherWorkshopIndex`](../packages/cli/src/gather.ts)
- CI `test`

## CLM-0142

**Status:** verified — **source:** [`CLM-0142.yaml`](../claims/registry/CLM-0142.yaml)

`Outcome.distillCandidates` has an OPERATIONAL consumer (EPIC #47·P3 #228 constituent 4 — the last, closing the learning-loop epic). The loop writes `distillCandidates = [traceRef]` on a successful run; previously its only reader was a memo printed INSIDE the distill prompt (shown after a trace was already chosen). `listDistillCandidates` now surfaces the loop-FLAGGED distill-worthy traces — every recent episodic trace whose `distillCandidates` is non-empty — newest-first and bounded, exposed as `kernloop distill --list`. It is the pre-selection NOMINATION surface a human reviews BEFORE running `distill --trace <taskId>`; skills still go live only via the human-PR ratification path (CLM-0050), and the candidate heuristic stays MECHANICAL (a successful loop trace — recency-ranked, not fitness-scored; a smarter ranker is deferred #313). HONESTY BOUNDARY: this claims the WIRING — the field now drives a queryable nomination list a human acts on — NOT that the heuristic is sophisticated. It is reads-only: `--list` distills nothing, writes no skill, and makes no model call; it is not a frozen-Outcome change (it reads the existing field).

**Enforced by:**

- [`packages/cli/src/distill.test.ts`](../packages/cli/src/distill.test.ts)
- [`packages/cli/src/distill.test.ts`](../packages/cli/src/distill.test.ts)
- [`packages/cli/src/distill.test.ts`](../packages/cli/src/distill.test.ts)
- [`packages/cli/src/tools/distill.ts#listDistillCandidates`](../packages/cli/src/tools/distill.ts)
- CI `test`

## CLM-0143

**Status:** verified — **source:** [`CLM-0143.yaml`](../claims/registry/CLM-0143.yaml)

The canonical loop supports COOPERATIVE mid-run abort (EPIC #47·P5 #304). When an AbortSignal threaded into the run fires, the engine halts at the NEXT node boundary (CLM-0044) and the run is reported as a CLEAN, resumable CANCEL — the run-tool Outcome status is `cancelled` (the previously-unused frozen enum value, no contract change), the LoopReport status is `escalated` with `haltReason: 'aborted'`, and the in-memory spend meter is FLUSHED into the Outcome cost rather than lost to a dirty failure. The flushed cost RECONCILES exactly with the sum of the per-node `loop.spend` audit deltas (CLM-0137) — the two meters never diverge — the audit chain still verifies, and the checkpoint is resumable. A vote/budget escalate (no `haltReason`) is UNAFFECTED — it still surfaces as a needs-human escalation mapping to `partial`, never captured by the abort branch; and a run with no signal is byte-identical to before. HONESTY BOUNDARY: this claims abort via an INJECTED signal (the real invocable seam threaded through runTool → executeCanonicalLoop → engine.run) — NOT operator Ctrl-C, whose SIGINT process-handler trigger is a tracked fast-follow (#317). Abort takes effect only at a node BOUNDARY: a runaway INSIDE a single long node halts only when it returns (inherited CLM-0044 limitation, not immediate kill).

**Enforced by:**

- [`packages/cli/src/loop-abort.test.ts`](../packages/cli/src/loop-abort.test.ts)
- [`packages/cli/src/loop-abort.test.ts`](../packages/cli/src/loop-abort.test.ts)
- [`packages/cli/src/loop-abort.test.ts`](../packages/cli/src/loop-abort.test.ts)
- CI `test`

## CLM-0144

**Status:** verified — **source:** [`CLM-0144.yaml`](../claims/registry/CLM-0144.yaml)

Ctrl-C cooperatively aborts a run (EPIC #47·P5 #317 — the operator-facing TRIGGER that completes #304). The `run` command wraps its loop run in `withSigintAbort`: the FIRST SIGINT fires the AbortSignal #318 threads into the run, so the loop halts cleanly at the next node boundary as a resumable cancel (the abort EFFECT is CLM-0143's, not re-claimed here). The handler is removed in a `finally` once the run settles — on the success, no-signal, AND throw paths — so it never leaks across runs or tests. Because registering a SIGINT handler suppresses Node's default Ctrl-C kill, a SECOND SIGINT escalates to a hard exit (the operator's force-quit escape hatch); and abort is idempotent (a repeated first Ctrl-C cannot double-fire). HONESTY BOUNDARY: this claims the WIRING (a SIGINT installs a handler that fires the already-tested signal, the second escalates, the handler is cleaned up) — proven HERMETICALLY with an injected process (no real OS signals in CI). Abort still lands only at a node BOUNDARY (inherited CLM-0044 limitation), not instantly.

**Enforced by:**

- [`packages/cli/src/sigint-abort.test.ts`](../packages/cli/src/sigint-abort.test.ts)
- [`packages/cli/src/sigint-abort.test.ts`](../packages/cli/src/sigint-abort.test.ts)
- [`packages/cli/src/sigint-abort.test.ts`](../packages/cli/src/sigint-abort.test.ts)
- [`packages/cli/src/sigint-abort.test.ts`](../packages/cli/src/sigint-abort.test.ts)
- [`packages/cli/src/sigint-abort.ts#withSigintAbort`](../packages/cli/src/sigint-abort.ts)
- CI `test`

## CLM-0145

**Status:** verified — **source:** [`CLM-0145.yaml`](../claims/registry/CLM-0145.yaml)

An AGENTIC adapter is refused before launch when its workspace is a real git tree (#280 part 2 / #138, the P2 AppSec containment). An agentic adapter (claude/codex/opencode/agy — the CLIs that execute generated code and read/write their cwd; ollama is pure-API and exempt) pointed at a NON-throwaway git working tree could poison `.git/hooks`, rewrite `.git/config`, or read tracked secrets — so `checkAgenticContainment` throws an `AgenticRepositoryWorkspaceError` at the kernel `invokeAdapter` choke point, the single funnel every caller (CLI loop, MCP, direct) passes through, so a cli-only guard cannot be bypassed. NON-throwaway = the realpath'd cwd is NOT under the realpath'd temp dir AND a `.git` exists at or above it (symlink-proof via realpath; a symlinked path into a real repo is still refused). On the loop path the refusal is AUDITED (`cli.adapter.refused`) before any node runs, not a silent throw (charter rule 7). It is pure path logic — the kernel stays model-free. SCOPE/HONESTY: the boundary is GIT-TREE containment, NOT general secret protection — a non-git directory holding a `.env` is NOT covered (a separate, larger scope). The contained adapter has no runtime opt-out it can reach (a security boundary, not a knob); escapes are copy-to-temp or `--sandbox docker` (#236); an audited overlay opt-out is deferred (#320). KNOWN GAP / TRUST ASSUMPTION: the throwaway carve-out is the OS temp dir and `os.tmpdir()` honors `$TMPDIR` — the contained model cannot set kernloop's launch env (the guard runs in the parent before the child spawns), but a LAUNCHER that points `$TMPDIR` at/above a working tree disables the carve-out's refusal for it, and a real repo cloned UNDER the temp dir is likewise treated as throwaway (location ≠ provenance); deriving the carve-out from a kernloop-OWNED root is the hardening deferred to #332. That carve-out-masked case is no longer SILENT, though: when the carve-out allows an agentic adapter into a path that is under the temp dir YET has a `.git` at/above it, the loop path AUDITS `cli.adapter.carveout-git-tree` (`carveOutMaskedGitTree`, #332 observability, rule 7) — so an operator can SEE the location-based allow-into-a-git-tree even though the full owned-root provenance fix is deferred; an ordinary `.git`-less scratch dir is not audited (no noise). An unresolvable temp dir fails closed (no carve-out).

**Enforced by:**

- [`packages/kernel/src/adapters/containment.test.ts`](../packages/kernel/src/adapters/containment.test.ts)
- [`packages/kernel/src/adapters/containment.test.ts`](../packages/kernel/src/adapters/containment.test.ts)
- [`packages/kernel/src/adapters/containment.test.ts`](../packages/kernel/src/adapters/containment.test.ts)
- [`packages/kernel/src/adapters/containment.test.ts`](../packages/kernel/src/adapters/containment.test.ts)
- [`packages/kernel/src/adapters/containment.test.ts`](../packages/kernel/src/adapters/containment.test.ts)
- [`packages/cli/src/loop/finalize.test.ts`](../packages/cli/src/loop/finalize.test.ts)
- [`packages/kernel/src/adapters/containment.test.ts`](../packages/kernel/src/adapters/containment.test.ts)
- [`packages/kernel/src/adapters/containment.test.ts`](../packages/kernel/src/adapters/containment.test.ts)
- [`packages/cli/src/loop/finalize.test.ts`](../packages/cli/src/loop/finalize.test.ts)
- [`packages/cli/src/loop/finalize.test.ts`](../packages/cli/src/loop/finalize.test.ts)
- [`packages/cli/src/loop/finalize.test.ts`](../packages/cli/src/loop/finalize.test.ts)
- [`packages/kernel/src/adapters/containment.test.ts`](../packages/kernel/src/adapters/containment.test.ts)
- [`packages/kernel/src/adapters/containment.ts#checkAgenticContainment`](../packages/kernel/src/adapters/containment.ts)
- CI `test`

## CLM-0146

**Status:** verified — **source:** [`CLM-0146.yaml`](../claims/registry/CLM-0146.yaml)

The audit chain can be HMAC-KEYED so a JSONL-rewriting attacker cannot DOWNGRADE or in-place-tamper it undetectably (#280 part 1). An envelope's `keyEpoch` is ABSENT on legacy/unkeyed lines (plain SHA-256, byte-identical to pre-keying chains) and PRESENT (≥1) on keyed lines, whose `hash` is HMAC-SHA256 over the SAME canonical form — with `keyEpoch` itself covered — under a key held in a keyring OUTSIDE the overlay (default `~/.config/kernloop/audit.key`, 0600). The keyring records each chain's keyed cutover (`firstKeyedSeq`); because the attacker cannot write that off-overlay file, `verifyChain` enforces a NO-DOWNGRADE FLOOR: a from-genesis rewrite that re-stamps every record as epoch-0 and recomputes the plain-SHA chain FAILS (`downgrade_detected`), epochs are non-decreasing (`epoch_regression`), a keyed line whose key is unavailable is a typed failure (`missing_key`, NEVER a silent fallback to unkeyed verify), and a chain ERASED below its cutover fails (`truncated_below_floor`). A keyring that cannot be loaded (bad perms/malformed) is itself a typed failure (`keyring_unavailable`), so a reader surfaces verified:false instead of crashing. The keyring is minted only when ABSENT and never re-keyed in place, perms looser than 0600 are refused, and the shipped CLI keys every real run via `createProductionKernloop`. HONESTY BOUNDARY: on-host tamper-EVIDENCE, not tamper-PROOF. HMAC is symmetric, so an attacker who can READ the key file forges, and one who can DELETE the keyring downgrades to legacy verification. SUFFIX truncation of keyed events ABOVE the cutover (dropping the most recent keyed records) is NOT caught here — like the base chain's documented truncation caveat it needs an external length witness (`expectedLength`) until the keyring records a per-chain high-water seq (deferred #331). Remote/separate-custody verifier and the re-key command are deferred (#323/#325/#324).

**Enforced by:**

- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- [`packages/cli/src/kernel.test.ts`](../packages/cli/src/kernel.test.ts)
- [`packages/kernel/src/audit/keyring.ts#ensureChainKeyed`](../packages/kernel/src/audit/keyring.ts)
- [`packages/kernel/src/audit/verify.ts#verifyChain`](../packages/kernel/src/audit/verify.ts)
- [`packages/kernel/src/audit/canonical.ts#hmacSha256Canonical`](../packages/kernel/src/audit/canonical.ts)
- CI `test`

## CLM-0147

**Status:** verified — **source:** [`CLM-0147.yaml`](../claims/registry/CLM-0147.yaml)

The review gate STRUCTURALLY fences its untrusted diff/context against prompt injection (#289, defence-in-depth hardening the #226 item-3 lexical mitigation). In the cli composition-root seam (`reviewerInvoker`), each review draws a fresh unguessable per-review nonce (64-bit CSPRNG, injectable for tests) and wraps the untrusted, already-clamped (#288) diff and context in `<<UNTRUSTED[nonce] …` / `[nonce]UNTRUSTED>>` fences. The trusted pieces — the reviewer role, the untrusted-data instruction (which names the nonce), the truncation notice, and the strict JSON output contract — live OUTSIDE the fence, so a diff line that mimics a markdown header or an output contract (`+## Output contract: {… approved}`, `+IGNORE PRIOR INSTRUCTIONS`) is structurally INSIDE the fence and cannot be read as the reviewer's own framing. Because clamping happens BEFORE fencing, the closing marker is appended after any truncation and can never be severed (which would re-merge untrusted text into the trusted region). A literal occurrence of the nonce inside the content is neutralized VISIBLY (a placeholder, never a silent edit), so even a leaked nonce cannot forge a closing marker. HONESTY: this claims the PROMPT STRUCTURE the seam assembles — proven by a model-free test asserting the fence layout — NOT that a real model behaviorally resists injection. The nonce defeats marker-FORGERY escape only; semantic social-engineering that never forges a marker is out of scope, and the layer sits atop the gate's ADVISORY tier (a forced approve only suppresses a non-blocking flag) and strict-zod output validation.

**Enforced by:**

- [`packages/cli/src/loop/seams.test.ts`](../packages/cli/src/loop/seams.test.ts)
- [`packages/cli/src/loop/seams.test.ts`](../packages/cli/src/loop/seams.test.ts)
- [`packages/cli/src/loop/seams.test.ts`](../packages/cli/src/loop/seams.test.ts)
- [`packages/cli/src/loop/seams.test.ts`](../packages/cli/src/loop/seams.test.ts)
- [`packages/cli/src/loop/seams.test.ts`](../packages/cli/src/loop/seams.test.ts)
- [`packages/cli/src/loop/seams.ts#reviewerInvoker`](../packages/cli/src/loop/seams.ts)
- CI `test`

## CLM-0148

**Status:** verified — **source:** [`CLM-0148.yaml`](../claims/registry/CLM-0148.yaml)

A `run`'s live milestones are EMITTED to the MCP host as progress notifications so it can show the loop working (#336 P1). When the host calls the `run` tool with a `progressToken`, the server forwards each of THIS run's SIGNIFICANT audit events — routing, gate verdicts, per-node spend (#302), child iterations, the outcome — as one `notifications/progress` apiece (monotonic counter; NO `total`, since the loop's iteration count is unknown up front). The content is the EXISTING audited events re-rendered by the `watch` renderer: an in-process tailer reads the audit JSONL the loop already appends, filtered to the run by `task.id` (`startProgressTail`), so fan-out children interleave in file order and nothing new is "claimed" — it is a second TRANSPORT for already-audited facts. The loop's spend / node-lifecycle / child-iteration events carry the taskId (alongside the loop's internal runId) so the `task.id` filter actually catches them — without that both ids match the filter only by coincidence in a fixture; in a real run the runId differs (#343, caught by dogfooding). It is read-only and best-effort: the tailer never throws on a missing or partial file, and a notification failure (sync throw OR async rejection) is swallowed so progress can never break the run it narrates. With NO progressToken the sink is absent and zero notifications are emitted. HONESTY BOUNDARY: this claims the SERVER-SIDE EMISSION of the notifications (asserted by a fake host capturing `sendNotification`) — NOT that any particular client (e.g. Claude Code) renders them to the user, which this layer cannot observe. Deferred to P2/P3 (#336): audit-joined `status --job` for async/no-token hosts, uniform per-node start/finish events, verbosity controls, the terminal two-band UX.

**Enforced by:**

- [`packages/cli/src/mcp-progress.test.ts`](../packages/cli/src/mcp-progress.test.ts)
- [`packages/cli/src/mcp-progress.test.ts`](../packages/cli/src/mcp-progress.test.ts)
- [`packages/cli/src/mcp-progress.test.ts`](../packages/cli/src/mcp-progress.test.ts)
- [`packages/cli/src/loop/progress-tail.test.ts`](../packages/cli/src/loop/progress-tail.test.ts)
- [`packages/cli/src/loop/progress-tail.test.ts`](../packages/cli/src/loop/progress-tail.test.ts)
- [`packages/cli/src/loop/progress-tail.test.ts`](../packages/cli/src/loop/progress-tail.test.ts)
- [`packages/cli/src/mcp.ts#makeProgressSink`](../packages/cli/src/mcp.ts)
- [`packages/cli/src/loop/progress-tail.ts#startProgressTail`](../packages/cli/src/loop/progress-tail.ts)
- CI `test`

## CLM-0149

**Status:** verified — **source:** [`CLM-0149.yaml`](../claims/registry/CLM-0149.yaml)

Every canonical-loop node emits a lifecycle heartbeat, surfaced on the live progress stream ONLY at opt-in verbosity (#336 P3). The node wrapper (`withSpendAudit`, applied to every executor) brackets each node with a `loop.node.start` (before execution) and `loop.node.finish` (in a `finally`, so a node that THROWS still records its boundary before the error propagates) audit event — alongside the existing `loop.spend` (CLM-0137). The events carry ONLY already-known facts (taskId AND the loop's runId, node, childId when in a fan-out child) — NEVER a fabricated child index/total ordinal (that lives in the protected engine cursor, not the audit record), so this is honest re-transport, not manufactured telemetry. Both ids are present so a consumer filtering by the caller-known taskId catches the heartbeat even though the loop's runId differs (#343). These two types are kept OUT of the default `watch`/progress SIGNIFICANT set, so the default progress stream and `kernloop watch` are UNCHANGED — the per-node heartbeat ("▶ plan", "■ review done") is forwarded ONLY when the caller opts into `verbose`: the `run` tool's `progress: 'milestones' | 'verbose'` input (default `milestones`) threads to the progress tailer, and `renderEvent(event, {verbose})` is the single gate. So a long run can show now-planning / now-reviewing depth on demand without spamming an un-opted transcript (the consensus-vote's load-bearing anti-spam condition). The verbose set is the node lifecycle only — never adapter payloads, prompts, or finding text. Observe-tier: it records, it never acts.

**Enforced by:**

- [`packages/cli/src/loop/spend-audit.test.ts`](../packages/cli/src/loop/spend-audit.test.ts)
- [`packages/cli/src/loop/spend-audit.test.ts`](../packages/cli/src/loop/spend-audit.test.ts)
- [`packages/cli/src/loop/spend-audit.test.ts`](../packages/cli/src/loop/spend-audit.test.ts)
- [`packages/cli/src/loop/progress-tail.test.ts`](../packages/cli/src/loop/progress-tail.test.ts)
- [`packages/cli/src/loop/executors-nodes.ts#withSpendAudit`](../packages/cli/src/loop/executors-nodes.ts)
- [`packages/cli/src/tools/watch.ts#renderEvent`](../packages/cli/src/tools/watch.ts)
- CI `test`

## CLM-0150

**Status:** verified — **source:** [`CLM-0150.yaml`](../claims/registry/CLM-0150.yaml)

A finished run's FULL audit trail can be replayed post-hoc on demand (#336 D, the panel-endorsed fast-follow). `kernloop watch --once --verbose` (alias `--explain`) renders a completed run's whole trail from the audit log — the SIGNIFICANT milestones (routing, gate verdicts, spend, child iterations, outcome) PLUS the persisted per-node `▶`/`■` lifecycle heartbeat (CLM-0149) — by threading `{verbose:true}` through `watchSnapshot` → `renderEvent`, the SAME renderer the live progress stream uses, so the live and replay views cannot diverge. It is a READ-ONLY re-render of already-audited facts: no new events, no telemetry, no kernel/contract change. The verbose snapshot is a strict SUPERSET of the default (default still omits the node lifecycle). It works by the caller-known taskId because the loop's lifecycle/spend events carry BOTH taskId and the loop's internal runId (#343) — so a `--task-id` filter catches the whole run even though the runId differs. The default (non-verbose) snapshot and `kernloop watch` are unchanged.

**Enforced by:**

- [`packages/cli/src/tools/watch.test.ts`](../packages/cli/src/tools/watch.test.ts)
- [`packages/cli/src/tools/watch.test.ts`](../packages/cli/src/tools/watch.test.ts)
- [`packages/cli/src/tools/watch.test.ts`](../packages/cli/src/tools/watch.test.ts)
- [`packages/cli/src/tools/watch.ts#watchSnapshot`](../packages/cli/src/tools/watch.ts)
- CI `test`

## CLM-0151

**Status:** verified — **source:** [`CLM-0151.yaml`](../claims/registry/CLM-0151.yaml)

A vote/review gate Verdict's audit event records the per-voter ballot (each voter's vote), not just the panel names and aggregate result.

**Enforced by:**

- [`packages/cli/src/tools/gate.test.ts`](../packages/cli/src/tools/gate.test.ts)
- [`packages/cli/src/tools/watch.test.ts`](../packages/cli/src/tools/watch.test.ts)
- CI `test`

## CLM-0152

**Status:** verified — **source:** [`CLM-0152.yaml`](../claims/registry/CLM-0152.yaml)

Whether the review gate drives child re-iteration is derived from its authority-ladder tier (enforce ⇒ drives), the ratification-guarded source, not the static manifest tier; the ladder exposes that tier via tierOf.

**Enforced by:**

- [`packages/kernel/src/ladder/ladder.test.ts`](../packages/kernel/src/ladder/ladder.test.ts)
- [`packages/kernel/src/ladder/ladder.test.ts`](../packages/kernel/src/ladder/ladder.test.ts)
- [`packages/cli/src/loop/engine-build.test.ts`](../packages/cli/src/loop/engine-build.test.ts)
- [`packages/cli/src/loop/engine-build.test.ts`](../packages/cli/src/loop/engine-build.test.ts)
- CI `test`

## CLM-0153

**Status:** verified — **source:** [`CLM-0153.yaml`](../claims/registry/CLM-0153.yaml)

An overlay promotes the review gate to enforce by recording a ratification ref (gates.review.ratifiedEnforce); kernel assembly applies it as an audited ladder transition with that ref as ratifiedBy. It is per-overlay and opt-in — a fresh overlay declares nothing and the gate stays advisory (never a default).

**Enforced by:**

- [`packages/cli/src/kernel.test.ts`](../packages/cli/src/kernel.test.ts)
- [`packages/cli/src/kernel.test.ts`](../packages/cli/src/kernel.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/kernel/src/ladder/ladder.test.ts`](../packages/kernel/src/ladder/ladder.test.ts)
- CI `test`

## CLM-0154

**Status:** verified — **source:** [`CLM-0154.yaml`](../claims/registry/CLM-0154.yaml)

In enforce mode the canonical loop halts BEFORE dispatching a node when the remaining budget cannot cover the reserve (the larger of a headroom floor and the largest single-node spend observed so far), so an enforce cap is not overshot by one node's spend; the post-node guard remains the backstop and owns the already-over case.

**Enforced by:**

- [`packages/workflows/src/budget.test.ts`](../packages/workflows/src/budget.test.ts)
- [`packages/workflows/src/budget.test.ts`](../packages/workflows/src/budget.test.ts)
- [`packages/workflows/src/budget.test.ts`](../packages/workflows/src/budget.test.ts)
- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- CI `test`

## CLM-0155

**Status:** verified — **source:** [`CLM-0155.yaml`](../claims/registry/CLM-0155.yaml)

Reasoning nodes (every canonical-loop model node except the coder `implement`) invoke the agentic CLI tool-free WHERE THE CLI SUPPORTS IT — coverage is per-CLI and recorded (full/partial/none, #355 CLM-0158), NOT a uniform cross-adapter guarantee: claude is FULL — verified against the real CLI 2.1.183 that headless `-p` "don't ask mode" auto-denies every permission-gated tool (a reasoning invocation cannot read a planted sentinel), with `--disallowedTools` as defense-in-depth; codex is PARTIAL (already `-s read-only` — writes blocked, reads still allowed); opencode/ollama have NO run-level flag (no coverage — recorded, not faked). `--allowedTools` is NOT a fail-closed alternative on claude — it is additive auto-approve, not restrictive (verified). The coder keeps tools (it produces files).

**Enforced by:**

- [`packages/kernel/src/adapters/definitions.test.ts`](../packages/kernel/src/adapters/definitions.test.ts)
- [`packages/cli/src/loop/node-model.test.ts`](../packages/cli/src/loop/node-model.test.ts)
- [`packages/kernel/src/adapters/definitions.ts#pureCompletionArgs`](../packages/kernel/src/adapters/definitions.ts)
- CI `test`

## CLM-0156

**Status:** verified — **source:** [`CLM-0156.yaml`](../claims/registry/CLM-0156.yaml)

The Outcome contract carries an optional served:ModelIdentity (the producing model class); the canonical loop populates it on each child's coder Outcome and ingests the child's DELIVERABLE pass/fail into a SEPARATE outcome-level identity-fitness series (observer_fitness_identity_outcome) that never double-counts with the per-call series; and the adapter selector BLENDS that deliverable-pass signal into its choice, so a model class that produces passing deliverables — not merely calls that don't error — is preferred. An empty deliverable series leaves the call-only ranking unchanged.

**Enforced by:**

- [`packages/faculty-observer/src/identity-ledger.test.ts`](../packages/faculty-observer/src/identity-ledger.test.ts)
- [`packages/cli/src/loop/adapter-fitness.test.ts`](../packages/cli/src/loop/adapter-fitness.test.ts)
- [`packages/cli/src/loop.test.ts`](../packages/cli/src/loop.test.ts)
- [`packages/cli/src/loop/executors-nodes.ts#recordChildOutcomeFitness`](../packages/cli/src/loop/executors-nodes.ts)
- CI `test`

## CLM-0157

**Status:** verified — **source:** [`CLM-0157.yaml`](../claims/registry/CLM-0157.yaml)

The Verdict contract carries an `escalate` disposition (≈ ASK): the vote gate, under the opt-in gates.vote.escalateOnNoConsensus, emits `escalate` when a panel DEADLOCKS (neither the approve bar nor the symmetric reject bar clears) instead of defaulting to reject; with the flag off a deadlock still resolves to reject, byte-identical across every strategy. The canonical loop routes an `escalate` verdict to its EXISTING escalated outcome — it HALTS for a human IMMEDIATELY (regardless of the K/Kc bound), with a distinct haltReason 'vote-escalation' so an operator tells a deadlock from K-exhaustion. All verdict routing goes through a single never-exhaustiveness classifier, so a future VerdictResult value is a compile error, never a silent mis-route. The non-routing verdict CONSUMERS that once read a raw `result === 'pass'` outside the classifier (#361) now also go through it: the gate.quality executor's success signal maps `advance` → success, and the observe telemetry tallies a verdict by its disposition into pass / fail / escalate buckets — so a SECOND escalate producer (the parsimony gate's escalateOnRefute, #415) is surfaced, never bucketed as a plain failure or dropped.

**Enforced by:**

- [`packages/faculty-gates/src/vote/strategies.test.ts`](../packages/faculty-gates/src/vote/strategies.test.ts)
- [`packages/faculty-gates/src/vote/strategies.test.ts`](../packages/faculty-gates/src/vote/strategies.test.ts)
- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- [`packages/workflows/src/verdict-disposition.test.ts`](../packages/workflows/src/verdict-disposition.test.ts)
- [`packages/cli/src/tools/observe.test.ts`](../packages/cli/src/tools/observe.test.ts)
- [`packages/workflows/src/verdict-disposition.ts#verdictDisposition`](../packages/workflows/src/verdict-disposition.ts)
- CI `test`

## CLM-0158

**Status:** verified — **source:** [`CLM-0158.yaml`](../claims/registry/CLM-0158.yaml)

Pure-completion coverage (#148 hardening, #355) is declarative and visible: a single kernel source classifies each adapter's tool-free reasoning coverage as full (claude — headless `-p` auto-deny + `--disallowedTools` defense-in-depth, #355), partial (codex read-only), or none (opencode/ollama); a real-CLI run whose DEFAULT adapter has less than full coverage appends a cli.run.pure-completion-degraded audit event, so a degraded default posture is not silently confused with enforced policy (a per-node adapterFitness substitution is a tracked gap, #363). The reasoning-node set is an EXPLICIT allowlist (not !== implement), so a future tool-needing node keeps tools rather than being silently starved tool-free.

**Enforced by:**

- [`packages/kernel/src/adapters/definitions.test.ts`](../packages/kernel/src/adapters/definitions.test.ts)
- [`packages/cli/src/loop/pure-completion-audit.test.ts`](../packages/cli/src/loop/pure-completion-audit.test.ts)
- [`packages/cli/src/loop/pure-completion-audit.test.ts`](../packages/cli/src/loop/pure-completion-audit.test.ts)
- [`packages/cli/src/loop/node-model.test.ts`](../packages/cli/src/loop/node-model.test.ts)
- [`packages/kernel/src/adapters/definitions.ts#pureCompletionCoverage`](../packages/kernel/src/adapters/definitions.ts)
- CI `test`

## CLM-0159

**Status:** verified — **source:** [`CLM-0159.yaml`](../claims/registry/CLM-0159.yaml)

A panel-7 RATIFICATION vote can convene a PROVIDER-DIVERSE panel (#369) — OPT-IN via `gates.vote.providerDiverse`, DEFAULT OFF since #461 (a live experiment found three independent model families gave identical verdicts to a single strong model on every test proposal, so the adversarial ROLES carry the signal; by default a panel-7 vote runs roles-on-the-run-adapter and needs no second authed adapter). WHEN ENABLED: the composition root (`voteDiversityFor`, gated on the flag) round-robins the voters across the overlay's distinct available adapters (stable-sorted, deterministic) and binds each voter to its OWN adapter's seam, so the panel is not one model role-playing N personas (the correlated-oracle weakness). Each ballot records the normalized served:ModelIdentity that cast it on the VoterRecord, so independence is VERIFIABLE; when fewer than 2 distinct adapters are available the panel runs single-oracle but surfaces it honestly — a visible single-oracle WARN finding AND a cli.vote.single-oracle-degraded audit (rule 7), never silent. WHEN OFF (default) or on an INJECTED run or a panel-3 loop vote, no diverse panel is built (no served identities — the #405 quorum + diversity findings are inert), byte-identical to single-model voting. The human merge stays the ratifier for protected-path/spec/tier decisions either way (spec §11, #348). The faculty stays model-free; the cli owns per-voter routing.

**Enforced by:**

- [`packages/cli/src/loop/engine-build.test.ts`](../packages/cli/src/loop/engine-build.test.ts)
- [`packages/cli/src/loop/engine-build.test.ts`](../packages/cli/src/loop/engine-build.test.ts)
- [`packages/cli/src/loop/engine-build.test.ts`](../packages/cli/src/loop/engine-build.test.ts)
- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/cli/src/loop/vote-executor.test.ts`](../packages/cli/src/loop/vote-executor.test.ts)
- [`packages/cli/src/loop/vote-executor.test.ts`](../packages/cli/src/loop/vote-executor.test.ts)
- [`packages/cli/src/loop/vote-executor.test.ts`](../packages/cli/src/loop/vote-executor.test.ts)
- [`packages/cli/src/loop/node-seam.test.ts`](../packages/cli/src/loop/node-seam.test.ts)
- [`packages/cli/src/loop/vote-executor.test.ts`](../packages/cli/src/loop/vote-executor.test.ts)
- [`packages/cli/src/loop/vote-diversity.test.ts`](../packages/cli/src/loop/vote-diversity.test.ts)
- [`packages/cli/src/loop/seams.ts#diverseBallotInvoker`](../packages/cli/src/loop/seams.ts)
- CI `test`

## CLM-0160

**Status:** verified — **source:** [`CLM-0160.yaml`](../claims/registry/CLM-0160.yaml)

Voter calibration (#369 Inc3, the voter analog of CLM-0156 deliverable fitness): at retrospect each PROCEEDING plan-vote voter is labeled correct iff its individual vote matched the run's eventual success — APPROVED a plan that fully succeeded, or REJECTED one that did not — on an EXPLICIT success-only threshold (partial/failure/ cancelled are not success); rejected-overall votes (which re-plan, no deliverable) AND abstaining voters (no prediction) are never labeled, so precision is a NOISY PROXY conditioned on proceeded plans, not a general voter-quality metric. An opt-in precision-WEIGHTED aggregation (gates.vote.precisionWeighted, default false) then weights each ballot by precisionWeight: NEUTRAL at chance (0.5), bounded [0.5,1.5], min-sample-gated, and FLOORED — never silenced or inverted. With the flag off, or before a voter accrues labels, the tally is integer counts (byte-identical). Labeling happens regardless of the flag so the data accrues.

**Enforced by:**

- [`packages/faculty-gates/src/vote/strategies.test.ts`](../packages/faculty-gates/src/vote/strategies.test.ts)
- [`packages/faculty-gates/src/vote/strategies.test.ts`](../packages/faculty-gates/src/vote/strategies.test.ts)
- [`packages/faculty-gates/src/vote/strategies.test.ts`](../packages/faculty-gates/src/vote/strategies.test.ts)
- [`packages/cli/src/loop/vote-executor.test.ts`](../packages/cli/src/loop/vote-executor.test.ts)
- [`packages/cli/src/loop/vote-executor.test.ts`](../packages/cli/src/loop/vote-executor.test.ts)
- [`packages/cli/src/loop/vote-executor.test.ts`](../packages/cli/src/loop/vote-executor.test.ts)
- [`packages/faculty-gates/src/vote/strategies.ts#precisionWeight`](../packages/faculty-gates/src/vote/strategies.ts)
- CI `test`

## CLM-0161

**Status:** verified — **source:** [`CLM-0161.yaml`](../claims/registry/CLM-0161.yaml)

A provider-diverse ratification panel surfaces VOTER DILUTION on the Verdict (#371): when one or more voters' ballots ERROR (the routed adapter was uncallable at vote time — authed-out, quota-exceeded, or crashed — recorded by the gate as a `voter_error:` abstain, never a fabricated vote), runVoteGate emits a `warn` diversity finding naming how many of the panel failed and how many independent ballots actually counted, so the served-based single-oracle/skew ratios are interpretable and a human ratifier sees that a close ratification may have turned on the dropped voters. The dilution finding is computed only when at least one diverse ballot survived (a single-adapter panel-3, which carries no served, yields none) and is emitted ALONGSIDE the single-oracle/skew findings, not instead of them. PATH-availability is already enforced at run setup (the run aborts on a not-installed declared adapter), so the dilution finding catches the residual RUNTIME (auth/quota) failures that slip past that probe.

**Enforced by:**

- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- CI `test`

## CLM-0162

**Status:** verified — **source:** [`CLM-0162.yaml`](../claims/registry/CLM-0162.yaml)

The audit keyring opportunistically REAPS its own orphaned write temps (#377, the #376 follow-up): the unique-per-write temp name that fixed the clobber race means a crash between writeFileSync and renameSync leaks a distinct `${path}.<hex>.tmp` that nothing reclaimed. On a successful keyring write, reapStaleKeyringTemps deletes sibling temps older than a few-minute floor — never one a concurrent distinct-chain write may still be mid-rename on — matched STRICTLY by the keyring's own basename prefix AND a `.tmp` suffix, so the keyring file itself, backups, and unrelated siblings are never touched. It runs only on the rare first-keyed write (off the hot path), swallows every filesystem error so housekeeping can never break a keyring operation, and emits a `warn` when it reaps so the cleanup is never silent (rule 7).

**Enforced by:**

- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- [`packages/kernel/src/audit/keyed-chain.test.ts`](../packages/kernel/src/audit/keyed-chain.test.ts)
- CI `test`

## CLM-0163

**Status:** verified — **source:** [`CLM-0163.yaml`](../claims/registry/CLM-0163.yaml)

The Antigravity CLI adapter `agy` (#387) — Google's replacement for the deprecated individual `gemini` CLI — is wired as the sixth kernel adapter and drives Antigravity print mode: `buildCommand` emits `agy -p <prompt> --model <name>`, parsing the PLAIN-TEXT response (no JSON envelope) with NO usage, so the call is metered `false` rather than guessed. It is harness-routed with its own auto-router; tiers bind to the verbatim Gemini model names `agy models` lists (frontier→`Gemini 3.1 Pro (High)` … small→`Gemini 3.5 Flash (Low)`). Effort is BAKED INTO the model name (Low/Medium/High/Thinking), not a separate flag, so the adapter declares no effort profile and effort is dropped honestly. Its pure-completion coverage is `none` and SO DECLARED: `agy`'s only restriction flag, `--sandbox`, blocks exec/network but NOT fs read/write (verified), so a `pureCompletion` request adds no argv and is best-effort, audited — never a silent or fabricated tool-free guarantee. It is classified AGENTIC (cwd-using) for containment, and marked `experimental` (it self-updates in the background).

**Enforced by:**

- [`packages/kernel/src/adapters/translate.test.ts`](../packages/kernel/src/adapters/translate.test.ts)
- [`packages/kernel/src/adapters/definitions.test.ts`](../packages/kernel/src/adapters/definitions.test.ts)
- [`packages/kernel/src/adapters/definitions.test.ts`](../packages/kernel/src/adapters/definitions.test.ts)
- CI `test`

## CLM-0164

**Status:** verified — **source:** [`CLM-0164.yaml`](../claims/registry/CLM-0164.yaml)

The canonical-loop run/default adapter (`--adapter`, spec §3.1) may be a registered api ENDPOINT id, not only a CLI adapter name (#392) — so kernloop runs end-to-end with NO model CLI installed, every node routing to the endpoint's api seam (pure HTTP) at its per-tier model. An endpoint run adapter is recognized at run setup and skips the CLI-only steps that do not apply to it: the PATH-probe (`ensureRunAdaptersAvailable`), the agentic-cwd containment guard (an api endpoint has no cwd subprocess), and the pure-completion-CLI coverage audit (a raw completion exposes no agentic tools); its key is validated fail-closed at call time. The provider-diverse vote panel does NOT seed an endpoint run adapter (the panel builds per-adapter CLI seams), so an endpoint-only run votes single-oracle on the node's own api seam — honestly degraded, never a fabricated CLI voter. A run adapter that is neither a CLI adapter nor a registered endpoint id fails fast at setup with the adapter list, never a silent mis-route.

**Enforced by:**

- [`packages/cli/src/loop/node-resolve.test.ts`](../packages/cli/src/loop/node-resolve.test.ts)
- [`packages/cli/src/loop/vote-diversity.test.ts`](../packages/cli/src/loop/vote-diversity.test.ts)
- [`packages/cli/src/loop/vote-executor.test.ts`](../packages/cli/src/loop/vote-executor.test.ts)
- [`packages/cli/src/cli.test.ts`](../packages/cli/src/cli.test.ts)
- CI `test`

## CLM-0165

**Status:** verified — **source:** [`CLM-0165.yaml`](../claims/registry/CLM-0165.yaml)

The standalone model-calling verbs — `gate vote`/`gate review`, `distill`, `forge`, `program author` — accept a registered api ENDPOINT id as `--adapter`, not only a CLI adapter name (#395, completing the #392 run-loop work). All four resolve their single model call through one shared `resolveStandaloneInvoke`: a registered endpoint binds the kernel api seam at the endpoint's `large`-tier model (a capable default for a one-shot verb call; resolveServedApi degrades downward if `large` is unbound; the key is read fail-closed at call time), and a CLI adapter is PATH-probed and bound via `adapterInvoke` as before (an absent CLI is a typed error, never a stub). An adapter that is neither a CLI adapter nor a registered endpoint fails fast. So these verbs run on a custom OpenAI-compatible endpoint with NO model CLI installed. (`gate vote` on an endpoint is single-oracle — no provider-diverse CLI panel — like the endpoint-only run loop, honestly degraded).

**Enforced by:**

- [`packages/cli/src/loop/standalone-invoke.test.ts`](../packages/cli/src/loop/standalone-invoke.test.ts)
- [`packages/cli/src/loop/standalone-invoke.test.ts`](../packages/cli/src/loop/standalone-invoke.test.ts)
- [`packages/cli/src/loop/standalone-invoke.test.ts`](../packages/cli/src/loop/standalone-invoke.test.ts)
- [`packages/cli/src/loop/standalone-invoke.test.ts`](../packages/cli/src/loop/standalone-invoke.test.ts)
- [`packages/cli/src/loop/standalone-invoke.test.ts`](../packages/cli/src/loop/standalone-invoke.test.ts)
- CI `test`

## CLM-0166

**Status:** verified — **source:** [`CLM-0166.yaml`](../claims/registry/CLM-0166.yaml)

An overlay can PIN a concrete per-tier model onto a built-in CLI adapter via the `adapterModels` block (`{ <cli-adapter>: { <tier>: <model> } }`, #393) — the agentic-CLI counterpart to the `endpoints` per-tier `models` (direct HTTP). A harness-routed CLI (opencode) defaults every tier to the harness default (`''`, its own auto-router); a pin merges OVER the adapter's `tierBinding` in `resolveServed`, so kernloop runs `opencode -m <model>` for a kernloop-CHOSEN model on a pinned tier while an UNpinned tier keeps the adapter default (merge, not replace — so downward degradation against the adapter's own bound tiers is preserved). The pin is CLI-only (`adapterModelOverride` is inert for an endpoint id, which carries its own `models`), and the schema rejects a pin keyed by a name that is not a built-in CLI adapter. The SAME override threads the selector's PREDICTION (`resolveServedFor`) and node-bind's CALL-TIME binding, so predicted==served holds under a pin (the CLM-0130 honesty invariant): live-fitness can never credit a model that did not serve.

**Enforced by:**

- [`packages/cli/src/loop/adapter-model-pin.test.ts`](../packages/cli/src/loop/adapter-model-pin.test.ts)
- [`packages/cli/src/loop/adapter-model-pin.test.ts`](../packages/cli/src/loop/adapter-model-pin.test.ts)
- [`packages/cli/src/loop/adapter-model-pin.test.ts`](../packages/cli/src/loop/adapter-model-pin.test.ts)
- [`packages/cli/src/loop/adapter-model-pin.test.ts`](../packages/cli/src/loop/adapter-model-pin.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- [`packages/cli/src/overlay.test.ts`](../packages/cli/src/overlay.test.ts)
- CI `test`

## CLM-0167

**Status:** verified — **source:** [`CLM-0167.yaml`](../claims/registry/CLM-0167.yaml)

The vote gate supports CORRELATION-AWARE aggregation (#369 Inc4): voters that share a served model CLASS are not independent evidence, so an opt-in `gates.vote.correlationAware` downweights each member of a class of size K by `correlationDiscount(form, K)` — composed MULTIPLICATIVELY with the Inc3 precision weight — so a provider-correlated bloc counts toward its effective-independent size, not its head-count. The discount form is a tunable HEURISTIC (`sqrt` ⇒ 1/√K default, `linear` ⇒ 1/K) whose load-bearing pinned properties are `c(1)=1` (a singleton class is undiscounted) and monotonic non-increasing in K. It is surfaced as a VISIBLE `info` Verdict finding naming the discounted class and its effective votes — never silent. Default OFF and inert on a single-adapter panel (no served identities to group), so an unenabled or single-adapter panel is byte-identical; aggregation stays pure and deterministic (preserves CLM-0037). The grouping keys off the composition-root- filled `served` identity (trusted adapter resolution, never ballot-supplied), so a voter cannot forge diversity to evade the discount. Demonstrated: a 4-voter one-class bloc that out-votes 3 diverse dissenters on raw head-count is FLIPPED to reject once the discount applies.

**Enforced by:**

- [`packages/faculty-gates/src/vote/correlation.test.ts`](../packages/faculty-gates/src/vote/correlation.test.ts)
- [`packages/faculty-gates/src/vote/correlation.test.ts`](../packages/faculty-gates/src/vote/correlation.test.ts)
- [`packages/faculty-gates/src/vote/correlation.test.ts`](../packages/faculty-gates/src/vote/correlation.test.ts)
- [`packages/faculty-gates/src/vote/correlation.test.ts`](../packages/faculty-gates/src/vote/correlation.test.ts)
- [`packages/faculty-gates/src/vote/correlation.test.ts`](../packages/faculty-gates/src/vote/correlation.test.ts)
- [`packages/faculty-gates/src/vote/correlation.test.ts`](../packages/faculty-gates/src/vote/correlation.test.ts)
- [`packages/faculty-gates/src/vote/correlation.test.ts`](../packages/faculty-gates/src/vote/correlation.test.ts)
- [`packages/cli/src/overlay-vote.test.ts`](../packages/cli/src/overlay-vote.test.ts)
- CI `test`

## CLM-0168

**Status:** verified — **source:** [`CLM-0168.yaml`](../claims/registry/CLM-0168.yaml)

The parsimony Decision Receipt (#408, EPIC #407) is defined as a typed zod PAYLOAD (`@kernloop/parsimony` `ParsimonyReceiptSchema`) for a new `parsimony.receipt` audit EVENT — NOT a sixth Frozen-Five contract: it rides kernloop's existing hash-chained audit log, so the chain fields (prevHash/hash/seq) are added by the audit envelope and are deliberately ABSENT from the payload schema. A receipt records the resolving ladder rung + outcome, the Control Floor checks (each typed by CATALOG — the floor is multi-catalog: nist-800-53r5, section-508, wcag, or intent — so a non-NIST entry with no control id is valid), a deferred shortcut as a first-class block carrying its `controlRisk` (when an applicable floor entry is unsatisfied), and the blind-verification verdict (method fixed to `blind_independent`). The agent's prose is stored only as a `rationaleDigest` (content hash), never raw, so blind verification stays unbiased. The schema ENFORCES the deferred invariant — a `deferred`-status floor check exists IFF a `deferred` block does — so a receipt cannot record a deferred control without its debt (nor a debt with no deferral). The schema is strict (an unknown field or catalog, a rung outside 0..5, or a chain field like prevHash/hash/seq, THROWS) and round-trips losslessly through parse.

**Enforced by:**

- [`packages/parsimony/src/receipt.test.ts`](../packages/parsimony/src/receipt.test.ts)
- [`packages/parsimony/src/receipt.test.ts`](../packages/parsimony/src/receipt.test.ts)
- [`packages/parsimony/src/receipt.test.ts`](../packages/parsimony/src/receipt.test.ts)
- [`packages/parsimony/src/receipt.test.ts`](../packages/parsimony/src/receipt.test.ts)
- [`packages/parsimony/src/receipt.test.ts`](../packages/parsimony/src/receipt.test.ts)
- [`packages/parsimony/src/receipt.test.ts`](../packages/parsimony/src/receipt.test.ts)
- [`packages/parsimony/src/receipt.test.ts`](../packages/parsimony/src/receipt.test.ts)
- [`packages/parsimony/src/receipt.test.ts`](../packages/parsimony/src/receipt.test.ts)
- [`packages/parsimony/src/receipt.test.ts`](../packages/parsimony/src/receipt.test.ts)
- CI `test`

## CLM-0169

**Status:** verified — **source:** [`CLM-0169.yaml`](../claims/registry/CLM-0169.yaml)

The Parsimony Ladder (#409, EPIC #407) is a PURE, deterministic evaluator (`@kernloop/parsimony` `evaluateLadder`) over a POLICY-DATA rung table (`PARSIMONY_LADDER`): an ordered restraint cascade — need → stdlib → native → dep → oneLine → minimal — that stops at the FIRST rung that holds (first-match-wins) and returns the resolving rung + its {@link ParsimonyOutcome} (skip / reuse_stdlib / reuse_native / reuse_dep / one_line / minimal_impl) for the Decision Receipt to record. The ladder is DATA, not code — each rung names a signal key + the value that resolves it (rung 0 `need` resolves on `false`; the last rung is an unconditional fallthrough), so an overlay may supply its own table and the evaluator makes no model call, reads no I/O, and never synthesizes an outcome the table did not declare. A mis-authored ladder with no resolving rung THROWS rather than fabricating an outcome.

**Enforced by:**

- [`packages/parsimony/src/ladder.test.ts`](../packages/parsimony/src/ladder.test.ts)
- [`packages/parsimony/src/ladder.test.ts`](../packages/parsimony/src/ladder.test.ts)
- [`packages/parsimony/src/ladder.test.ts`](../packages/parsimony/src/ladder.test.ts)
- [`packages/parsimony/src/ladder.test.ts`](../packages/parsimony/src/ladder.test.ts)
- [`packages/parsimony/src/ladder.test.ts`](../packages/parsimony/src/ladder.test.ts)
- [`packages/parsimony/src/ladder.test.ts`](../packages/parsimony/src/ladder.test.ts)
- CI `test`

## CLM-0170

**Status:** verified — **source:** [`CLM-0170.yaml`](../claims/registry/CLM-0170.yaml)

The Control Floor (#410, EPIC #407) is a TYPED, MULTI-CATALOG set of non-waivable guards (`@kernloop/parsimony` `CONTROL_FLOOR` + pure `evaluateFloor`): each entry is `{name, catalog, controlIds, appliesWhen}` policy data, and the catalog is heterogeneous on purpose — `nist-800-53r5` (input_validation SI-10, error_recovery SI-11/CP-10, access_enforcement AC-3/IA-2/SC-8, audit_logging AU-2/AU-3/AU-10), `section-508` (accessibility — NO 800-53 control id), and `intent` (no catalog control) — so a consumer (notably the OSCAL projection #8) must NOT assume every entry maps to a NIST control. `appliesWhen` names a {@link FloorContext} trust-boundary key (not a closure, so the floor is overlay-loadable and fires ONLY on a relevant diff): an entry that does not apply is `na`, one that applies and is satisfied is `pass`, and one that applies and is NOT satisfied is `deferred` — FAIL-CLOSED (a missing `satisfied` entry defaults to unsatisfied, never an assumed pass). `floorControlRisk` aggregates the distinct control ids of the deferred checks for the forced Deferred block, and `floorHasDeferral` detects a deferral even when it carries no control id (a 508 miss) — so an applicable unsatisfied guard can never be silently dropped.

**Enforced by:**

- [`packages/parsimony/src/floor.test.ts`](../packages/parsimony/src/floor.test.ts)
- [`packages/parsimony/src/floor.test.ts`](../packages/parsimony/src/floor.test.ts)
- [`packages/parsimony/src/floor.test.ts`](../packages/parsimony/src/floor.test.ts)
- [`packages/parsimony/src/floor.test.ts`](../packages/parsimony/src/floor.test.ts)
- [`packages/parsimony/src/floor.test.ts`](../packages/parsimony/src/floor.test.ts)
- [`packages/parsimony/src/floor.test.ts`](../packages/parsimony/src/floor.test.ts)
- [`packages/parsimony/src/floor.test.ts`](../packages/parsimony/src/floor.test.ts)
- CI `test`

## CLM-0171

**Status:** verified — **source:** [`CLM-0171.yaml`](../claims/registry/CLM-0171.yaml)

`buildParsimonyReceipt` (`@kernloop/parsimony`, #411/#5) assembles a validated parsimony Decision Receipt from an evaluated decision — the caller supplies the ULID/timestamp/loopIter/overlay/subject/rationaleDigest/verifier plus the `LadderResult` and evaluated `FloorCheck`s, and the builder maps the rung+outcome, forces a `deferred` block when any floor check deferred (else null), and starts verification `pending`/`checkedFloor:false` (the blind verifier #7 flips it). It CLOSES #423: `DeferredSchema.controlRisk` is `.min(1)`, but a Section-508 / intent floor miss carries no 800-53 control id — so `deferredRisk` synthesizes a `<catalog>:<name>` SENTINEL token for a control-less deferred check, keeping `controlRisk` non-empty whenever a deferral happened (the receipt's deferred invariant holds for ANY applicable unsatisfied guard, NIST or not) while letting the OSCAL projection (#8) still distinguish a non-control deferral. The aggregate is the distinct union of control ids and sentinels; empty exactly when nothing deferred. The assembled receipt is schema-validated (throws on an invalid one, never a partial).

**Enforced by:**

- [`packages/parsimony/src/build.test.ts`](../packages/parsimony/src/build.test.ts)
- [`packages/parsimony/src/build.test.ts`](../packages/parsimony/src/build.test.ts)
- [`packages/parsimony/src/build.test.ts`](../packages/parsimony/src/build.test.ts)
- [`packages/parsimony/src/build.test.ts`](../packages/parsimony/src/build.test.ts)
- [`packages/parsimony/src/build.test.ts`](../packages/parsimony/src/build.test.ts)
- [`packages/parsimony/src/build.test.ts`](../packages/parsimony/src/build.test.ts)
- CI `test`

## CLM-0172

**Status:** verified — **source:** [`CLM-0172.yaml`](../claims/registry/CLM-0172.yaml)

The canonical loop has a `parsimony` GATE NODE (#411/#5, EPIC #407) — the Check layer of the parsimony subsystem — wired into the fan-out child sub-chain AFTER the `review` gate (`CANONICAL_LOOP.childChain` = implement → quality → review → parsimony). Per fan-out child it makes ONE assessor model call over the child's written diff (the same diff the review gate reads) under a STRICT JSON contract, zod-validated — a malformed assessment is a typed clean error (raw output preserved), never a fabricated assessment. It then evaluates the restraint ladder (`evaluateLadder`) and the multi-catalog Control Floor (`evaluateFloor`) over the assessor's reported signals, floor context, and per-entry satisfaction, builds a parsimony Decision Receipt (`buildParsimonyReceipt`, which forces the deferred block + #423 non-control sentinel automatically and starts verification `pending` for the blind verifier #7), and EMITS it as a `parsimony.receipt` event on kernloop's hash-chained, HMAC-keyed audit log (`appendEvent`). It returns an ADVISORY Verdict (`gate: 'parsimony'`): a PASS regardless of deferrals in this increment, surfacing each deferred-floor control risk as a `warn` finding; with no diff stashed (a resume past implement) it abstains honestly and emits no receipt. HONEST SCOPE: this is evidence EMISSION, not enforcement — blocking on a refuted blind verification is #7 and intensity gating is #9.

**Enforced by:**

- [`packages/workflows/src/graph.test.ts`](../packages/workflows/src/graph.test.ts)
- [`packages/workflows/src/graph.test.ts`](../packages/workflows/src/graph.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- CI `test`

## CLM-0173

**Status:** verified — **source:** [`CLM-0173.yaml`](../claims/registry/CLM-0173.yaml)

The parsimony subsystem (#6, EPIC #407) exposes a GREPPABLE `kl:parsimony` marker grammar and a read-only `kl debt` harvest. `parsimonyMarker(receipt)` formats a single-line, space-free marker — `kl:parsimony rung=R outcome=O floor=<id-or-name>:<status>,… defer=none|<debtId> receipt=<receiptId>` — listing every Control Floor check that applied (NOT `na`) and back-referencing the full receipt by id; `parseMarker(line)` tolerantly recovers at least that `receipt=<id>` back-link from any line (or null on a non-marker), so a marker resolves to its receipt on the hash-chained audit log. Writing markers as inline code comments is a SEPARATE future concern (coder-node integration) and is NOT attempted here — this is the grammar + back-link only. The `kl debt` CLI VERB (not a 12th MCP tool) reads `parsimony.receipt` events back off the overlay's audit log via the same envelope reader the `audit` tool uses, validates each payload with `parseParsimonyReceipt`, and lists ONLY the receipts carrying a `deferred` block — an unmitigated shortcut — with its receiptId, subject, rung/outcome, control risk, owner, and ts (a human table by default, structured JSON under `--json`, plus a summary count). It MUTATES NOTHING and appends NO audit event (a harvest is a query), and a non-parsimony or malformed event is skipped, never crashing the harvest.

**Enforced by:**

- [`packages/parsimony/src/marker.test.ts`](../packages/parsimony/src/marker.test.ts)
- [`packages/parsimony/src/marker.test.ts`](../packages/parsimony/src/marker.test.ts)
- [`packages/parsimony/src/marker.test.ts`](../packages/parsimony/src/marker.test.ts)
- [`packages/parsimony/src/marker.test.ts`](../packages/parsimony/src/marker.test.ts)
- [`packages/cli/src/debt-commands.test.ts`](../packages/cli/src/debt-commands.test.ts)
- [`packages/cli/src/debt-commands.test.ts`](../packages/cli/src/debt-commands.test.ts)
- [`packages/cli/src/debt-commands.test.ts`](../packages/cli/src/debt-commands.test.ts)
- [`packages/cli/src/debt-commands.test.ts`](../packages/cli/src/debt-commands.test.ts)
- CI `test`

## CLM-0174

**Status:** verified — **source:** [`CLM-0174.yaml`](../claims/registry/CLM-0174.yaml)

The parsimony OSCAL projection (#8/#414, EPIC #407) maps parsimony Decision Receipts to an OSCAL Assessment Results document via the PURE `toOscalAssessmentResults(receipts, meta)` — the caller supplies the document uuid, last-modified timestamp, and oscal-version, so identical inputs yield byte-identical output (deterministic; child observation/finding uuids are derived from the document uuid). Each receipt's applicable (non-`na`) Control Floor checks become OSCAL `observations` (method `TEST`); a `refuted` blind verification and each unmitigated `deferred` control-risk become OSCAL `findings`. A finding links to a NIST 800-53 control (`target.type: objective-id`, `target-id: <control>`, plus a `control-id` property) ONLY for a BARE control-id token; a `<catalog>:<name>` SENTINEL token (#423 — a Section-508 / WCAG / intent deferral with no 800-53 control) is emitted as a finding WITHOUT a NIST control link (`target.type: statement-id`, recorded as a `non-control-risk` property), and the document's `reviewed-controls` names only the bare controls, never a sentinel. The single disambiguation point is `isSentinelRisk(token)` — true exactly when the token contains a `:`. The projection output VALIDATES against the vendored, official, unmodified NIST OSCAL Assessment Results JSON Schema (OSCAL v1.1.3, `packages/parsimony/schemas/oscal_assessment-results_schema.json`) compiled with `ajv` + `ajv-formats` in CI — for an all-pass floor (observations, no findings), a NIST-control deferral, a 508 sentinel deferral, a refuted verification, and multiple aggregated receipts. The OSCAL types in `oscal-types.ts` are a caller-facing convenience; the ajv validation against the vendored real schema is the ground truth. The projection is invocable through a REAL entry point (#430): `kernloop debt --oscal` reads EVERY parsimony.receipt event off the audit log (`readParsimonyReceipts`, skipping malformed/unrelated events) and emits the OSCAL document, minting the document uuid + timestamp per-invocation.

**Enforced by:**

- [`packages/cli/src/debt-commands.test.ts`](../packages/cli/src/debt-commands.test.ts)
- [`packages/parsimony/src/oscal.test.ts`](../packages/parsimony/src/oscal.test.ts)
- [`packages/parsimony/src/oscal.test.ts`](../packages/parsimony/src/oscal.test.ts)
- [`packages/parsimony/src/oscal.test.ts`](../packages/parsimony/src/oscal.test.ts)
- [`packages/parsimony/src/oscal.test.ts`](../packages/parsimony/src/oscal.test.ts)
- [`packages/parsimony/src/oscal.test.ts`](../packages/parsimony/src/oscal.test.ts)
- [`packages/parsimony/src/oscal.test.ts`](../packages/parsimony/src/oscal.test.ts)
- [`packages/parsimony/src/oscal.test.ts`](../packages/parsimony/src/oscal.test.ts)
- [`packages/parsimony/src/oscal.test.ts`](../packages/parsimony/src/oscal.test.ts)
- [`packages/parsimony/src/oscal.test.ts`](../packages/parsimony/src/oscal.test.ts)
- [`packages/parsimony/src/oscal.test.ts`](../packages/parsimony/src/oscal.test.ts)
- CI `test`

## CLM-0175

**Status:** verified — **source:** [`CLM-0175.yaml`](../claims/registry/CLM-0175.yaml)

The parsimony assessor (`assessParsimony`, #426, EPIC #407) CHUNKS a child's diff that EXCEEDS the per-chunk budget (`DIFF_ASSESS_MAX_CHARS`, kept as the chunk size) into consecutive budget-sized chunks split on whole code-point boundaries (never mid-surrogate), runs the strict assessor ONCE PER CHUNK — each chunk wrapped in its OWN per-call nonce fence so the #289/#288 prompt-injection + cost-denial defenses are preserved per chunk — and UNIONS the per-chunk assessments into ONE `ParsimonyAssessment`: floorContext is the logical OR across chunks (full trust-boundary coverage — a boundary buried PAST the head can no longer draw a clean floor assessment, the security gap this fix closes before enforcement #7); satisfied is the FAIL-CLOSED AND across chunks (a floor entry is satisfied only if some chunk reported it true AND no chunk reported it false — a guard claimed satisfied in one chunk but unsatisfied in another is NOT satisfied overall); the ladder signals + rung come from the FIRST chunk only (the ladder is the advisory Prime layer — a wrong rung is inefficiency, not a control breach — so a first-chunk view is acceptable while the security-critical FLOOR gets full chunked coverage); the per-chunk rationales are concatenated deterministically (the receipt's `rationaleDigest` reflects every chunk); and the per-chunk costs are SUMMED. A diff that FITS in one chunk (the common case) is ONE call producing an assessment byte-identical to the prior single-call behavior — the executor (`parsimony-executor.ts`) is unchanged. Chunking is BOUNDED at `MAX_ASSESS_CHUNKS` calls (≈800k chars): a diff needing more than the cap fails the floor CLOSED on the whole diff (every guard is forced to apply with none satisfied, so a too-large diff can never draw a clean floor by burying a boundary past the cap) — and because that fail-closed verdict does not depend on what the in-cap chunks assess, the assessor SHORT-CIRCUITS at ZERO model spend (#434) rather than spending the first `MAX_ASSESS_CHUNKS` calls only to discard their floor findings (an adversarial child thus forces neither O(diff size) NOR `MAX_ASSESS_CHUNKS` model calls — zero cost/latency denial surface on the over-cap path); the advisory ladder reports the conservative `minimal_impl` (rung 5) disposition for the unassessable diff. A malformed chunk emission throws a typed `LoopParseError` (raw output preserved) per chunk — never a fabricated or partial assessment (prime directive: the record is what happened).

**Enforced by:**

- [`packages/cli/src/loop/parsimony-assess.test.ts`](../packages/cli/src/loop/parsimony-assess.test.ts)
- [`packages/cli/src/loop/parsimony-assess.test.ts`](../packages/cli/src/loop/parsimony-assess.test.ts)
- [`packages/cli/src/loop/parsimony-assess.test.ts`](../packages/cli/src/loop/parsimony-assess.test.ts)
- [`packages/cli/src/loop/parsimony-assess.test.ts`](../packages/cli/src/loop/parsimony-assess.test.ts)
- [`packages/cli/src/loop/parsimony-assess.test.ts`](../packages/cli/src/loop/parsimony-assess.test.ts)
- [`packages/cli/src/loop/parsimony-assess.test.ts`](../packages/cli/src/loop/parsimony-assess.test.ts)
- [`packages/cli/src/loop/parsimony-assess.test.ts`](../packages/cli/src/loop/parsimony-assess.test.ts)
- [`packages/cli/src/loop/parsimony-assess.test.ts`](../packages/cli/src/loop/parsimony-assess.test.ts)
- [`packages/cli/src/loop/parsimony-assess.test.ts`](../packages/cli/src/loop/parsimony-assess.test.ts)
- [`packages/cli/src/loop/parsimony-assess.test.ts`](../packages/cli/src/loop/parsimony-assess.test.ts)
- [`packages/cli/src/loop/parsimony-assess.test.ts`](../packages/cli/src/loop/parsimony-assess.test.ts)
- CI `test`

## CLM-0176

**Status:** verified — **source:** [`CLM-0176.yaml`](../claims/registry/CLM-0176.yaml)

The Check-layer parsimony gate (#413/#7, EPIC #407) runs a SECOND, INDEPENDENT, rationale-BLIND verifier model call (`verifyFloor`, parsimony-verify.ts) per fan-out child AFTER the assessor, and sets the receipt's `verification` verdict to a REAL `confirmed`/`refuted` (with `checkedFloor:true`) instead of `pending`. The verifier is BLIND to the assessor's prose rationale: its prompt (`verifierPrompt`) carries ONLY the child's diff (nonce-fenced UNTRUSTED data, #289, and clamped, #288 — the same fence + clamp the assessor uses) and the NAMES of the floor guards the assessor CLAIMED satisfied (`status === 'pass'`); the assessor's rationale string is never passed (the receipt stores only its `rationaleDigest`). The verifier re-checks whether each claimed-pass guard is ACTUALLY satisfied by the diff and emits a strict JSON verdict `{status:'confirmed'|'refuted', refutedChecks:string[], reason:string}`, zod-parsed by the hardened `parseEmission` (a malformed verdict throws a typed `LoopParseError`, raw output preserved — never a fabricated verdict). It CHUNKS the diff exactly as the assessor does (reusing `chunkDiff`/`MAX_ASSESS_CHUNKS`, the same per-call nonce fence and clamp per chunk) and UNIONs the per-chunk verdicts FAIL- CLOSED: `confirmed` only if EVERY chunk confirms; if ANY chunk refutes (or cannot confirm a claimed guard) the overall verdict is `refuted` with the union of refuting names; per-chunk costs are SUMMED. A diff that EXCEEDS the chunk cap is `refuted` OUTRIGHT at ZERO model spend (fail-closed — an over-cap diff cannot be fully verified, and since the verdict is `refuted` regardless of the in-cap chunks the verifier short-circuits BEFORE invoking the model, #434). When the assessor claimed NO floor guard satisfied (zero `pass` checks) the verification CONFIRMS VACUOUSLY WITHOUT a model call (`checkedFloor:true`, nothing to refute). The gate STAYS ADVISORY in this increment: it still returns a PASS Verdict regardless of the verdict; a `refuted` verification adds a `warn` finding naming the refuted guard(s) but does NOT reject/block (the loop completes exactly as before — additive, non-behavior-changing). The verifier's cost is summed into the gate's Verdict cost, and the pre-flight call-count estimate (cost-estimate.ts) models the parsimony node as assessor + verifier (2×c). ENFORCEMENT — rejecting on a refute and intensity gating — is #9, a SEPARATE later PR.

**Enforced by:**

- [`packages/cli/src/loop/parsimony-verify.test.ts`](../packages/cli/src/loop/parsimony-verify.test.ts)
- [`packages/cli/src/loop/parsimony-verify.test.ts`](../packages/cli/src/loop/parsimony-verify.test.ts)
- [`packages/cli/src/loop/parsimony-verify.test.ts`](../packages/cli/src/loop/parsimony-verify.test.ts)
- [`packages/cli/src/loop/parsimony-verify.test.ts`](../packages/cli/src/loop/parsimony-verify.test.ts)
- [`packages/cli/src/loop/parsimony-verify.test.ts`](../packages/cli/src/loop/parsimony-verify.test.ts)
- [`packages/cli/src/loop/parsimony-verify.test.ts`](../packages/cli/src/loop/parsimony-verify.test.ts)
- [`packages/cli/src/loop/parsimony-verify.test.ts`](../packages/cli/src/loop/parsimony-verify.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/cost-estimate.test.ts`](../packages/cli/src/cost-estimate.test.ts)
- CI `test`

## CLM-0177

**Status:** verified — **source:** [`CLM-0177.yaml`](../claims/registry/CLM-0177.yaml)

The Check-layer parsimony gate (#9/#415, EPIC #407) has an INTENSITY DIAL + ENFORCEMENT, set per-overlay by `gates.parsimony.intensity` ∈ {off, lite, full, ultra} with `escalateOnRefute` (overlay-schemas.ts `ParsimonyGateSchema`, mirrored as the derived `parsimonyDrivesIteration` engine flag in workflows config.ts, CLM-0045). The DEFAULT is `full` (user-ratified — deliberately NOT byte-identical to the pre-#9 advisory past): a fresh overlay ENFORCES. By intensity the gate's Verdict is: OFF — the gate does NO work: an immediate `abstain` Verdict, NO assessor/verifier model call, NO `parsimony.receipt`. LITE — advisory (the pre-#9 behavior): assess + blind-verify + emit receipt; result `pass`; a refute or a deferral is a `warn` finding only, never a reject. FULL — assess + verify + emit receipt; a REFUTED blind verification → result `reject` (or `escalate` when `escalateOnRefute`); a confirmed verification → `pass`; a DEFERRED floor check stays a `warn` finding (debt ALLOWED at full). ULTRA — full PLUS any DEFERRED floor check (`floorHasDeferral`) also → `reject` (or `escalate`); no debt allowed. The rejecting Verdict carries `findings` NAMING why (the refuted guard names and/or the deferred control risk) so the re-iterating coder gets actionable feedback. A parsimony `reject` DRIVES child re-iteration through the EXISTING child-iterate back-edge (it is a child sub-gate like quality/review): at full/ultra the CLI sets `parsimonyDrivesIteration` on the engine (engine-build.ts `parsimonyGateDrivesIteration`), so `gateDrivesIteration` returns true for the parsimony node and steps.ts `advanceChildGate` → `childBranch` → `reiterateChild` re-runs implement with the floor findings folded in, bounded by Kc (an `escalate` Verdict halts the child for a human, #192); the parsimony verdict is kept in its OWN `ChildResult.parsimonyVerdict` slot so it never clobbers the quality verdict. At lite/off the gate is non-driving (its findings fold in as hints only). The pre-flight call-count estimate (cost-estimate.ts) is intensity-aware: off ⇒ 0 parsimony calls; lite ⇒ 2/child single-pass; full/ultra ⇒ 2/child with the MAX scaling to childAttempts (a refute re-runs the child). HONEST SCOPE (NOT evasion-proof): the blind verifier is answer-key-anchored — it catches pass-OVER-claims (a refuted claimed-pass guard) but NOT applicability-UNDER-claims (an assessor reporting a floor flag false / a guard `na` when the diff really crosses that boundary, which bypasses both the verifier and the deferral). The vacuous-confirm path (zero claimed-pass ⇒ confirm without a model call) cannot whitewash a deferral: the deferral logic is INDEPENDENT of the verification status, so a deferred check still warns at full / still rejects at ultra under a vacuous confirm. The over-cap refute (a diff over MAX_ASSESS_CHUNKS) names its reason distinctly so an operator can tell "too large to verify" from "a guard is actually unmet". The under-claim residual is a filed follow-up (#435). HONEST COST BOUND: a re-iterated reject costs ONE extra child attempt ONLY when the next attempt fixes the refute; a DETERMINISTIC false-refute (the verifier persistently misreading a guard the diff genuinely satisfies — a fixed diff, not transient noise) cannot be fixed by re-iteration and burns the FULL Kc budget, re-charging assessor+verifier each attempt, then terminates with a parsimony reject — bounded (never an infinite wedge) but worst-case Kc×(assess+verify), not one. The blind verifier's false-refute rate is unmeasured; the FP-rate harness that would bound this is a filed follow-up (#436).

**Enforced by:**

- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/loop/parsimony-executor.test.ts`](../packages/cli/src/loop/parsimony-executor.test.ts)
- [`packages/cli/src/overlay-parsimony.test.ts`](../packages/cli/src/overlay-parsimony.test.ts)
- [`packages/cli/src/overlay-parsimony.test.ts`](../packages/cli/src/overlay-parsimony.test.ts)
- [`packages/cli/src/overlay-parsimony.test.ts`](../packages/cli/src/overlay-parsimony.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- [`packages/workflows/src/overrides.test.ts`](../packages/workflows/src/overrides.test.ts)
- [`packages/cli/src/cost-estimate.test.ts`](../packages/cli/src/cost-estimate.test.ts)
- CI `test`

## CLM-0178

**Status:** verified — **source:** [`CLM-0178.yaml`](../claims/registry/CLM-0178.yaml)

The parsimony subsystem (EPIC #407) carries a VERSIONED threat taxonomy (docs/parsimony-threat-taxonomy.md, schema kernloop.parsimony-threat-taxonomy/v1) whose entry PT-001 names the "YAGNI-as-attack" threat — a coder agent invoking a parsimony / restraint rationale to justify DROPPING an access-enforcement (AC-3, via the `access_enforcement` floor guard) or input-validation (SI-10, via the `input_validation` floor guard) control — and is backed by a LOAD-BEARING adversarial proof. In the proven pass-OVER-claims variant the assessor reports the floor boundaries crossed (`enforcesAccess`/`crossesTrustBoundary` true) AND CLAIMS the controls satisfied (`pass`) while the diff implements neither. The proof exercises the REAL parsimony executor + the REAL blind verifier (`verifyFloor`, parsimony-verify.ts) via a scripted invoke — NOT a mock of `decideVerdict`: the blind verifier (BLIND to the assessor's YAGNI rationale — it receives only the diff and the claimed-pass guard NAMES) REFUTES the claimed-pass AC-3/SI-10 guards, and at intensity `full` (the default, CLM-0177) the parsimony Verdict is `reject` with an error finding NAMING the refuted guards (`input_validation`, `access_enforcement`); the refute verdict rides the hash-chained audit log as the receipt's `verification.status=refuted`. The SAME attack is only advisory (a `warn`, passes) at `lite`. The LOOP-LEVEL consequence is proven against the real engine: a persistently-refuting child (the dropped control never added back) re-iterates through the existing child-iterate back-edge and FAILS its iteration at the Kc bound (escalated, never integrating a control-floor violation), while its clean sibling is untouched. HONEST SCOPE (the documented residual, follow-up #435): the blind verifier is answer-key-anchored — it catches pass-OVER-claims ONLY. PT-001 and these tests deliberately do NOT cover the applicability-UNDER-claims / na-lying variant (an assessor reporting the boundary flag false / a guard `na` when the diff really crosses it), which bypasses both the verifier and the deferral; the taxonomy states this residual explicitly and links it to #435.

**Enforced by:**

- [`packages/cli/src/loop/parsimony-attack.test.ts`](../packages/cli/src/loop/parsimony-attack.test.ts)
- [`packages/cli/src/loop/parsimony-attack.test.ts`](../packages/cli/src/loop/parsimony-attack.test.ts)
- [`packages/cli/src/loop/parsimony-attack.test.ts`](../packages/cli/src/loop/parsimony-attack.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- CI `test`

## CLM-0179

**Status:** verified — **source:** [`CLM-0179.yaml`](../claims/registry/CLM-0179.yaml)

The compact PARSIMONY (restraint) RULE [#417, EPIC #407 M4] — the agent-facing Prime-layer instruction to climb the restraint ladder, hold the Control Floor, and emit the greppable `kl:parsimony` marker — is SINGLE-SOURCED as the exported const `COMPACT_PARSIMONY_RULE` in `@kernloop/parsimony` (packages/parsimony/src/rule.ts), composed from the canonical PARSIMONY_LADDER / CONTROL_FLOOR / MARKER_TAG so it names the REAL rungs, the REAL floor control ids (AC-3, SI-10, …), and the REAL marker grammar — never a divergent vocabulary. BOTH the implement/coder prompt AND the per-harness copies DERIVE from that one const: the CLI's `coderPrompt` (packages/cli/src/loop/prompts.ts) appends COMPACT_PARSIMONY_RULE on EVERY coder call so the Prime disposition travels with the implement step, and `renderHarnessCopy(harness)` / `renderSkillDoc()` wrap the SAME const with a thin header to GENERATE the per-harness copies (claude/codex/gemini/opencode) and the human-readable SKILL.md under skills/parsimony-restraint/. The generator `scripts/render-parsimony-rule.mjs` writes those copies and, in `--check` mode (wired into CI as the `parsimony:render -- --check` drift gate), EXITS NONZERO the instant any committed copy is hand-edited away from the single source. The `parsimony.receipt` kernel-contract — a NEW typed event on the existing hash-chained/HMAC audit log (NOT a sixth Frozen-Five contract), its full ParsimonyReceiptSchema payload, the deferred-invariant superRefine, the `kl:parsimony` marker grammar, the read-back verification block, and the OSCAL projection pointer — is documented under docs/parsimony-receipt-contract.md. Two consistency guards close the residual drift surfaces the generated-copy gate does not reach: the rule's hand-typed example marker line is asserted token-by-token against the canonical ladder/outcome/floor (#440, so a rung renumber or outcome rename cannot leave it silently stale), and every ParsimonyReceiptSchema payload field is asserted present in the contract doc (#441, so a future schema field cannot land undocumented).

**Enforced by:**

- [`packages/parsimony/src/rule.test.ts`](../packages/parsimony/src/rule.test.ts)
- [`packages/parsimony/src/rule.test.ts`](../packages/parsimony/src/rule.test.ts)
- [`packages/parsimony/src/rule.test.ts`](../packages/parsimony/src/rule.test.ts)
- [`packages/parsimony/src/rule.test.ts`](../packages/parsimony/src/rule.test.ts)
- [`packages/parsimony/src/rule.test.ts`](../packages/parsimony/src/rule.test.ts)
- [`packages/parsimony/src/rule.test.ts`](../packages/parsimony/src/rule.test.ts)
- [`packages/parsimony/src/receipt.test.ts`](../packages/parsimony/src/receipt.test.ts)
- [`packages/cli/src/loop/prompts.test.ts`](../packages/cli/src/loop/prompts.test.ts)
- [`scripts/__tests__/render-parsimony-rule.test.mjs`](../scripts/__tests__/render-parsimony-rule.test.mjs)
- [`docs/parsimony-receipt-contract.md#payload--every-parsimonyreceiptschema-field`](../docs/parsimony-receipt-contract.md#payload--every-parsimonyreceiptschema-field)
- CI `test`

## CLM-0180

**Status:** verified — **source:** [`CLM-0180.yaml`](../claims/registry/CLM-0180.yaml)

The repo carries a `preflight` aggregate script (#449) that chains the locally-reproducible CI gates (build, typecheck, lint, wiring:check, format, test, claims:check, claims:verify-ran, render-claims --check, docs:render --check, docs:coverage, stats:check, parsimony:render --check, governance:check, audit:selftest, e2e, evals) fail-fast, so a contributor or agent reproduces a green CI run with ONE command. A drift gate (`scripts/check-preflight-sync.mjs`, run in CI as a root-vitest test) keeps `preflight` in LOCKSTEP with `.github/workflows/ci.yml`. It is FAIL-CLOSED: EVERY single-line `run:` command CI executes is a required gate unless it matches the explicit CI-only allowlist (the lockfile install) — there is no gate-FORM allowlist, so a gate spelled `turbo run x` / `bash scripts/x.sh` / `npx y` is required by default and cannot escape by not looking like a pnpm/scripts command. Each required gate is resolved ONE level through the package.json `scripts` map so a `pnpm <alias>` and its raw `node scripts/x.mjs` CI form canonicalize to the same signature, and the check asserts every required gate appears in `preflight`. A multi-line `run:` BLOCK SCALAR (which the single-line parser cannot read) FAILS LOUD rather than silently skipping — closing the one path by which a gate hidden in a block could escape. So adding a CI gate without adding it to `preflight` turns the gate red: `preflight` cannot silently rot into a stale subset that reports green while missing a CI check.

**Enforced by:**

- [`scripts/__tests__/check-preflight-sync.test.mjs`](../scripts/__tests__/check-preflight-sync.test.mjs)
- [`scripts/__tests__/check-preflight-sync.test.mjs`](../scripts/__tests__/check-preflight-sync.test.mjs)
- [`scripts/__tests__/check-preflight-sync.test.mjs`](../scripts/__tests__/check-preflight-sync.test.mjs)
- [`scripts/__tests__/check-preflight-sync.test.mjs`](../scripts/__tests__/check-preflight-sync.test.mjs)
- [`scripts/__tests__/check-preflight-sync.test.mjs`](../scripts/__tests__/check-preflight-sync.test.mjs)
- [`scripts/__tests__/check-preflight-sync.test.mjs`](../scripts/__tests__/check-preflight-sync.test.mjs)
- [`scripts/__tests__/check-preflight-sync.test.mjs`](../scripts/__tests__/check-preflight-sync.test.mjs)
- [`scripts/__tests__/check-preflight-sync.test.mjs`](../scripts/__tests__/check-preflight-sync.test.mjs)
- [`scripts/__tests__/check-preflight-sync.test.mjs`](../scripts/__tests__/check-preflight-sync.test.mjs)
- CI `test`

## CLM-0181

**Status:** verified — **source:** [`CLM-0181.yaml`](../claims/registry/CLM-0181.yaml)

The vote gate enforces a DISTINCT-CLASS INDEPENDENCE QUORUM (#405/#369 Inc5b, human-ratified 2026-06-23): when a panel's surviving ballots span FEWER distinct served model classes than required, the gate emits `escalate` (ask a human) instead of ruling — closing the named honesty gap where a single-oracle ratification could still AUTO-APPROVE. The quorum counts distinct served CLASSES (independence) via `identityKey`, NOT raw ballot count: 5/7 ballots of one provider is 1 class, not 5. For a panel-7 RATIFICATION vote (`ratificationProfile`, set by the cli when `gates.vote.panel === 7`) the threshold DEFAULTS to 2 — the ratified default-ON: a single-oracle ratification escalates rather than auto-approving. A panel-3 loop vote is OFF by default (byte-identical), and the overlay's `gates.vote.minDistinctClasses` explicitly overrides the threshold either way (set to 1 to OPT OUT on a ratification panel). The gate is INERT on a single-adapter / endpoint-only panel (no served identities to count) — so an unenabled, single-adapter, or endpoint-only vote is byte-identical. The override replaces ANY tally `result` with `escalate` (not only an `approve`): a panel too correlated to RULE cannot be trusted to reject either, so the symmetric honest move is to escalate regardless of tally, leaving the confidence (the raw approve share) intact for the human to read. The escalation is NOT silent (rule 7): it surfaces a VISIBLE `warn` Verdict finding naming the cause, and the Verdict is published via publishVerdict which appends a `cli.gate.verdict` audit event carrying the `escalate` result. The quorum composes with precision weighting and correlation-aware aggregation: a single-oracle panel escalates even when weights are applied, never silently auto-deciding on a weighted tally. HONEST LIMITATION: the gate measures independence from SERVED identities, so a panel that serves NO identities (an endpoint-only / single-adapter ratification) cannot be checked and stays byte-identical — closing that residual (and the `panel === 7` ratification proxy) is a follow-up.

**Enforced by:**

- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/faculty-gates/src/vote/run-diversity.test.ts`](../packages/faculty-gates/src/vote/run-diversity.test.ts)
- [`packages/cli/src/loop/vote-executor.test.ts`](../packages/cli/src/loop/vote-executor.test.ts)
- [`packages/cli/src/loop/vote-executor.test.ts`](../packages/cli/src/loop/vote-executor.test.ts)
- CI `test`

## CLM-0182

**Status:** verified — **source:** [`CLM-0182.yaml`](../claims/registry/CLM-0182.yaml)

The vote-gate PARITY EVIDENCE (#348 / #328 Inc3) is operationalized as a structured, tamper-evident ledger (`evals/vote-parity/ledger.jsonl`) + a pure scorer (`scripts/vote-parity-check.mjs`, `pnpm vote-parity`) that mirrors the HUMAN-RATIFIED criteria v2 (#348, 2026-06-19) — it does NOT invent thresholds. Each ledger entry is one PAIRED data point: kernloop's native `gate vote @7` vs the external nexus `consensus_vote @7` on the same proposal. The scorer computes: the COUNTED window size (a point counts toward windowN ONLY when independence is verified AND it is flagged counted, so pre-criteria points stay PROVISIONAL — no teach-to-the-test); the load-bearing ZERO-false-approves gate (a false-approve = native APPROVES while external REJECTS, the self-grading-homework failure; a false-REJECT is safe/conservative and does not fail the window); disposition agreement (≥90% bar); decision-type diversity (≥4); and dangerous-case coverage (≥5 external-reject/split, a MAJORITY organic). `criteriaMet` requires EVERY bar and is explicitly NECESSARY-NOT-SUFFICIENT — the scorer REPORTS progress and never promotes: the #328 Inc3 enforce-tier promotion stays a SEPARATE human-ratified step with an EXTERNAL panel, and the external check + the human merge + the standing canary stay in the loop permanently. The committed ledger's counted window must always carry zero false-approves (a CI test enforces this invariant + the scorer logic); the seeded DP#1–3 are provisional pre-criteria reasoning-parity evidence. Independence-from-external (the counting precondition) is satisfied by a SINGLE-MODEL native panel on a family DISJOINT from `consensus_vote` (agy/google vs its {anthropic,openai}) — NOT by an internally-diverse native panel (diversity is opt-in for vote QUALITY since #468) — so counted DPs accrue with no 2nd adapter and no criterion relaxation; DP4 is the first (a genuine native-vs-external model-DISAGREEMENT that, by surfacing real divergence #461 could not, kept the independence precondition a HARD gate).

**Enforced by:**

- [`scripts/__tests__/vote-parity-check.test.mjs`](../scripts/__tests__/vote-parity-check.test.mjs)
- [`scripts/__tests__/vote-parity-check.test.mjs`](../scripts/__tests__/vote-parity-check.test.mjs)
- [`scripts/__tests__/vote-parity-check.test.mjs`](../scripts/__tests__/vote-parity-check.test.mjs)
- [`scripts/__tests__/vote-parity-check.test.mjs`](../scripts/__tests__/vote-parity-check.test.mjs)
- [`scripts/__tests__/vote-parity-check.test.mjs`](../scripts/__tests__/vote-parity-check.test.mjs)
- [`scripts/__tests__/vote-parity-check.test.mjs`](../scripts/__tests__/vote-parity-check.test.mjs)
- [`scripts/__tests__/vote-parity-check.test.mjs`](../scripts/__tests__/vote-parity-check.test.mjs)
- [`scripts/__tests__/vote-parity-check.test.mjs`](../scripts/__tests__/vote-parity-check.test.mjs)
- [`scripts/__tests__/vote-parity-check.test.mjs`](../scripts/__tests__/vote-parity-check.test.mjs)
- [`scripts/__tests__/vote-parity-check.test.mjs`](../scripts/__tests__/vote-parity-check.test.mjs)
- CI `test`

## CLM-0183

**Status:** verified — **source:** [`CLM-0183.yaml`](../claims/registry/CLM-0183.yaml)

The review-gate enforce promotion (#328 Inc2) is EVIDENCE-VERIFIED (#350): kernel assembly grants enforce only when a committed review-calibration artifact proves the gate met its PROMOTION_CRITERION (precision >= threshold over n >= windowN) AND was measured over the CURRENT review eval-set (bound by a hash, so a grown or changed set invalidates a stale measurement). A missing, malformed, stale, under-threshold, or under-window artifact is REFUSED — the gate STAYS ADVISORY and the refusal is audited (kernel.ladder.promotion-refused), so enforce is never granted on unverified or stale evidence. The composition root VERIFIES that the committed numbers meet the bar; it does NOT measure precision (constitutional rule 4) — that runs out-of-band via `kernloop calibrate`, which evaluates the default reviewer panel over the labeled eval-set and writes the artifact bound to the eval-set hash plus the adapter it was measured against. The eval-set is currently n=10 < windowN=50, so a real artifact honestly reports n below the window and kernloop's own review gate is not yet promotable (#478) — the mechanism is correct even while inert.

**Enforced by:**

- [`packages/cli/src/review-calibration.test.ts`](../packages/cli/src/review-calibration.test.ts)
- [`packages/cli/src/review-calibration.test.ts`](../packages/cli/src/review-calibration.test.ts)
- [`packages/cli/src/review-calibration.test.ts`](../packages/cli/src/review-calibration.test.ts)
- [`packages/cli/src/review-calibration.test.ts`](../packages/cli/src/review-calibration.test.ts)
- [`packages/cli/src/review-calibration.test.ts`](../packages/cli/src/review-calibration.test.ts)
- [`packages/cli/src/kernel.test.ts`](../packages/cli/src/kernel.test.ts)
- [`packages/cli/src/kernel.test.ts`](../packages/cli/src/kernel.test.ts)
- [`packages/cli/src/calibrate-command.test.ts`](../packages/cli/src/calibrate-command.test.ts)
- CI `test`

## CLM-0184

**Status:** verified — **source:** [`CLM-0184.yaml`](../claims/registry/CLM-0184.yaml)

The vote gate's authority TIER governs RATIFICATION authority — whether its verdict may ratify a protected/spec/tier decision (the #328/#348 native-ratifier role, today still external via consensus_vote + human merge) — DECOUPLED from the gate's LOOP role. The plan-iterate loop role (a rejecting vote re-enters plan, bounded by K, then escalates the run) is STRUCTURAL in the canonical graph and TIER-INDEPENDENT: it is driven solely by the verdict disposition and K, there is no voteGateDrivesIteration flag (in contrast to the review gate, whose enforce promotion DOES flip child re-iteration, #328 Inc1), and the loop EngineConfig cannot even EXPRESS a vote authority tier. So the gate's `advisory` tier is honest — it drives the loop but does NOT yet ratify external decisions — and promoting its tier (a future #348 step, gated on parity evidence + human sign-off) would change ratification authority, not loop mechanics (#480).

**Enforced by:**

- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- CI `test`

## CLM-0185

**Status:** verified — **source:** [`CLM-0185.yaml`](../claims/registry/CLM-0185.yaml)

The kernloop CLI's process-entry guard recognizes the module as the entrypoint when `argv[1]` is the npm bin symlink — it matches `import.meta.url` against BOTH the resolved and the realpath-resolved forms of `argv[1]` — so `main()` fires under `npx @kernloop/cli`, a global `npm i -g @kernloop/cli` install, and `node_modules/.bin/kernloop` (and under `--preserve-symlinks`, where `import.meta.url` is itself the symlink). A `path.resolve`-only guard left `argv[1]` as the symlink path and never matched the real module URL, so the published CLI ran nothing via every documented install path (#502). Importing the module (argv[1] mismatched or undefined) does not fire, and a non-existent `argv[1]` falls back without throwing. The guard's behavior is unit-pinned below; the end-to-end spawn of the built binary through a real bin symlink is additionally exercised as a hard invariant in the e2e suite (`tests/e2e`, the `pnpm e2e` job).

**Enforced by:**

- [`packages/cli/src/cli-entrypoint.test.ts`](../packages/cli/src/cli-entrypoint.test.ts)
- [`packages/cli/src/cli-entrypoint.test.ts`](../packages/cli/src/cli-entrypoint.test.ts)
- [`packages/cli/src/cli-entrypoint.test.ts`](../packages/cli/src/cli-entrypoint.test.ts)
- [`packages/cli/src/cli-entrypoint.test.ts`](../packages/cli/src/cli-entrypoint.test.ts)
- [`packages/cli/src/cli-entrypoint.test.ts`](../packages/cli/src/cli-entrypoint.test.ts)
- [`packages/cli/src/cli-entrypoint.test.ts`](../packages/cli/src/cli-entrypoint.test.ts)
- CI `test`

## CLM-0186

**Status:** verified — **source:** [`CLM-0186.yaml`](../claims/registry/CLM-0186.yaml)

The api adapter's egress is guarded at RESOLVE TIME, not only lexically (#508). Every request routes through `safeFetch`, whose undici dispatcher uses a custom `connect.lookup` that resolves the host and REJECTS the connection if any resolved address is not public unicast — TOCTOU-safe by construction, because the lookup that VALIDATES the addresses is the SAME lookup the socket connects through (no resolve-then-reconnect window for DNS-rebinding). Address classification is delegated to the vetted `ipaddr.js` (which normalizes every textual spelling): an address is allowed only if `range()` is `unicast`; loopback/private/link-local (incl. 169.254.169.254 metadata)/carrier-grade-NAT/unique-local/ multicast/reserved/broadcast/unspecified are blocked. Embedded-IPv4 tunnels are classified by their embedded IPv4 — IPv4-mapped, NAT64 well-known `64:ff9b::/96`, 6to4 `2002::/16`, and the deprecated IPv4-compatible `::/96` — so `64:ff9b::a9fe:a9fe` (metadata) is blocked while `64:ff9b::8.8.8.8` is allowed. Reject-if-ANY over the full resolved set defeats multi-A / happy-eyeballs; `redirect:'error'` refuses redirect-rebinding; undici pools per-origin (no cross-host socket reuse); unparseable input fails closed. The lexical [CLM-0084] baseUrl guard remains a defense-in-depth pre-check. SCOPE (threat model: attacker controls the endpoint's DNS only): network-specific NAT64 prefixes and ISATAP-tunnelled embeddings require a configured tunnel on the host (hostile NETWORK infra), and the operator-typed local-host escape hatch requires a hostile OVERLAY — both out of the DNS-only model and tracked separately.

**Enforced by:**

- [`packages/kernel/src/adapters/api-net.test.ts`](../packages/kernel/src/adapters/api-net.test.ts)
- [`packages/kernel/src/adapters/api-net.test.ts`](../packages/kernel/src/adapters/api-net.test.ts)
- [`packages/kernel/src/adapters/api-net.test.ts`](../packages/kernel/src/adapters/api-net.test.ts)
- [`packages/kernel/src/adapters/api-net.test.ts`](../packages/kernel/src/adapters/api-net.test.ts)
- [`packages/kernel/src/adapters/api-net.test.ts`](../packages/kernel/src/adapters/api-net.test.ts)
- [`packages/kernel/src/adapters/api-net.test.ts`](../packages/kernel/src/adapters/api-net.test.ts)
- [`packages/kernel/src/adapters/api-net.test.ts`](../packages/kernel/src/adapters/api-net.test.ts)
- CI `test`

## CLM-0187

**Status:** verified — **source:** [`CLM-0187.yaml`](../claims/registry/CLM-0187.yaml)

The api adapter accepts a caller-supplied chat `messages` array and a per-endpoint completion ceiling (#510). When an invocation carries `messages` (system / user / assistant roles), the adapter sends it VERBATIM as the `chat/completions` body; when it does not, it falls back to the single user message assembled from `prompt` — so every existing caller is byte-for-byte unchanged while a role-aware caller (#509's vote panel) can send a system persona plus a user turn. The messages array is validated fail-closed BEFORE the key read and any egress (`checkInvocation` is `invokeApiAdapter`'s first step): an empty array, an unknown role, or empty content is a typed `AdapterRequestError`, never a malformed POST. The messages array is bounded (≤64 messages, ≤256 KiB content each) as defence-in-depth against an unbounded request body. `max_tokens` is per-endpoint configurable via the overlay `maxTokens` (threaded overlay → `apiDefinitionFor` → api-seam → adapter, defaulting to 4096 when unset) and is ALWAYS sent. The hard cap `API_MAX_TOKENS_CEILING` (128k) is a SINGLE source enforced at BOTH boundaries — the overlay parse AND the kernel invocation check (`assertMaxTokens`) — so neither a fat-fingered or hostile overlay NOR a future ApiInvocation producer (#509) can inflate the completion length past it (a kernel invariant, not a config-layer courtesy). SCOPE/HONESTY: the ceiling bounds COMPLETION tokens only (larger input messages raise input cost inherently, bounded by the message caps above); the run BUDGET [CLM-0077] is the aggregate spend backstop. The secret hygiene, lexical [CLM-0084] and resolve-time [CLM-0186] SSRF guards are untouched — messages/max_tokens are request-BODY fields, not URL/host. Per-node max_tokens override (#523), tool/function-calling passthrough (#524), and a loop node that populates a system role (#509) / real multi-turn history (#522) are out of scope and tracked separately.

**Enforced by:**

- [`packages/kernel/src/adapters/api-body.test.ts`](../packages/kernel/src/adapters/api-body.test.ts)
- [`packages/kernel/src/adapters/api-body.test.ts`](../packages/kernel/src/adapters/api-body.test.ts)
- [`packages/kernel/src/adapters/api-body.test.ts`](../packages/kernel/src/adapters/api-body.test.ts)
- [`packages/kernel/src/adapters/api-body.test.ts`](../packages/kernel/src/adapters/api-body.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api.test.ts`](../packages/kernel/src/adapters/api.test.ts)
- [`packages/kernel/src/adapters/api-body.test.ts`](../packages/kernel/src/adapters/api-body.test.ts)
- [`packages/kernel/src/adapters/api-body.test.ts`](../packages/kernel/src/adapters/api-body.test.ts)
- [`packages/kernel/src/adapters/api-body.test.ts`](../packages/kernel/src/adapters/api-body.test.ts)
- [`packages/cli/src/endpoints.test.ts`](../packages/cli/src/endpoints.test.ts)
- [`packages/cli/src/loop/standalone-invoke.test.ts`](../packages/cli/src/loop/standalone-invoke.test.ts)
- [`packages/cli/src/loop/standalone-invoke.test.ts`](../packages/cli/src/loop/standalone-invoke.test.ts)
- CI `test`

## CLM-0188

**Status:** verified — **source:** [`CLM-0188.yaml`](../claims/registry/CLM-0188.yaml)

For an ENDPOINT-ONLY ratification run whose endpoint serves >=2 chat-capable models (discovered via `/v1/models` [CLM-0086]), kernloop convenes a per-MODEL panel-7 instead of one model role-playing N personas (#509): each voter is pinned to a distinct discovered model on the SAME endpoint (via #510's per-invocation model pin), round-robined through the deterministic assignment SHARED with the cross-adapter panel [CLM-0159]. The `/v1/models` set is FILTERED to chat models before seeding (embeddings, moderation, audio, image, and rerankers dropped across OpenAI AND other-provider naming), the panel activates only at >=2 chat models (else the honest single-oracle degrade holds), and every dropped id is recorded. HONESTY IS LOAD-BEARING and enforced STRUCTURALLY, not just in prose. This is model-NAME diversity WITHIN ONE ORACLE: the models share one endpoint/operator, so failures are CORRELATED. Each per-model ballot is stamped with a UNIFORM endpoint-scoped served CLASS (`endpoint:<id>` for provider/family/generation; distinct `raw` kept for per-model attribution), so faculty-gates' own independence machinery correctly sees ONE oracle: its single-oracle finding FIRES, the distinct-class quorum ESCALATES a single-oracle ratification (honoring an operator's `minDistinctClasses`), and correlation fully discounts. The panel can NOT be mistaken for N independent providers (a QA round caught the pre-fix version presenting distinct classes to the quorum, the diversity-theater failure mode). On top of that it surfaces TWO VISIBLE Verdict Findings: a `warn` CAVEAT stating it is NOT cross-provider independence, does NOT close [CLM-0164], does not feed the #348 parity precondition, and that NEITHER high nor low disagreement establishes independence (the metric is a divergence signal, not an independence measurement); and an `info` metric of inter-voter disagreement over ONLY the voters that ACTUALLY balloted (a `voter_error:` abstain is a counted shortfall, never silent agreement). A distinct `cli.vote.model-diverse-single-oracle` audit records the posture with the chat ids used and the non-chat ids dropped, and the `vote-parity-check` `isCounted` gate EXCLUDES a `withinOracleModelDiverse` data point from the #348 window even if it is mis-flagged independent. The faculty vote gate stays model-free; this is composition-root plumbing. Cross-provider voting remains THE real oracle-diversity path.

**Enforced by:**

- [`packages/cli/src/loop/vote-model-diversity.test.ts`](../packages/cli/src/loop/vote-model-diversity.test.ts)
- [`packages/cli/src/loop/vote-model-diversity.test.ts`](../packages/cli/src/loop/vote-model-diversity.test.ts)
- [`packages/cli/src/loop/vote-model-diversity.test.ts`](../packages/cli/src/loop/vote-model-diversity.test.ts)
- [`packages/cli/src/loop/vote-model-diversity.test.ts`](../packages/cli/src/loop/vote-model-diversity.test.ts)
- [`packages/cli/src/loop/vote-model-diversity.test.ts`](../packages/cli/src/loop/vote-model-diversity.test.ts)
- [`packages/cli/src/loop/vote-model-diversity.test.ts`](../packages/cli/src/loop/vote-model-diversity.test.ts)
- [`packages/cli/src/loop/vote-model-diversity.test.ts`](../packages/cli/src/loop/vote-model-diversity.test.ts)
- [`packages/cli/src/loop/vote-model-diversity.test.ts`](../packages/cli/src/loop/vote-model-diversity.test.ts)
- [`packages/cli/src/loop/vote-model-diversity.test.ts`](../packages/cli/src/loop/vote-model-diversity.test.ts)
- [`scripts/__tests__/vote-parity-check.test.mjs`](../scripts/__tests__/vote-parity-check.test.mjs)
- CI `test`

## CLM-0189

**Status:** verified — **source:** [`CLM-0189.yaml`](../claims/registry/CLM-0189.yaml)

The canonical loop's CHILD quality gate scopes its IN-PROCESS whole-workspace scans — the doc-comment check (#534) AND the security smell check (#541) — to the child's OWN written files, so pre-existing repo-wide findings (an undocumented legacy export, a detector fixture secret) cannot fail a child on content outside its file ownership. The loop's quality node passes the child's `writtenByChild` stash into the gate (the same files the diff-coverage check closes over, CLM-0134); `docCommentCheck` / `securityCheck` / `defaultQualityChecks` accept the optional scope, and `scanDocComments` / `scanSecuritySmells` PARSE only the scoped workspace paths (out-of-scope files are never read — not merely post-filtered), which for the doc scan also excludes out-of-scope tree-sitter files and honest-degradation notes. The stash is the UNION of the child's implement emissions across its iterations (last content wins per path) — a re-iteration that re-emits only some files can never narrow the scope past an earlier undocumented or smelly write. A PRESENT-but-empty scope (a child that wrote nothing) judges nothing; an ABSENT scope — the standalone `gate quality` path and every non-child gate run — keeps the whole-workspace semantics unchanged. RESUME FAILS CLOSED: the stash is not checkpointed, so a resume landing after implement has NO stash entry — the loop passes NO scope in that case (never a present-but-empty one), falling back to the whole-workspace scans: over-broad, but the enforcing checks can never silently skip files the child really wrote. Scope entries are CANONICALIZED against the workspace (resolve-then-relative, and the loop stashes the normalized relative paths `writeWorkspaceFiles` returns — a count mismatch throws, never a raw-path fallback), so an emitted absolute-but-inside path is still scanned rather than dodging a string compare. Passing the child's files for scoping never silently enables the opt-in diff-coverage check (CLM-0134): that stays behind its own `gates.quality.diffCoverage` flag, threaded as a separate request field.

**Enforced by:**

- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/doc-scan.test.ts`](../packages/docscan/src/doc-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/docscan/src/security-scan.test.ts`](../packages/docscan/src/security-scan.test.ts)
- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/faculty-gates/src/checks.test.ts`](../packages/faculty-gates/src/checks.test.ts)
- [`packages/cli/src/loop/quality-doc-scope.test.ts`](../packages/cli/src/loop/quality-doc-scope.test.ts)
- [`packages/cli/src/loop/quality-doc-scope.test.ts`](../packages/cli/src/loop/quality-doc-scope.test.ts)
- [`packages/cli/src/loop/quality-doc-scope.test.ts`](../packages/cli/src/loop/quality-doc-scope.test.ts)
- [`packages/cli/src/loop/quality-doc-scope.test.ts`](../packages/cli/src/loop/quality-doc-scope.test.ts)
- [`packages/cli/src/loop/quality-doc-scope.test.ts`](../packages/cli/src/loop/quality-doc-scope.test.ts)
- CI `test`

## CLM-0190

**Status:** verified — **source:** [`CLM-0190.yaml`](../claims/registry/CLM-0190.yaml)

Child-iteration findings are DEDUPLICATED on append (#535): all three fold sites of the child back-edge — `reiterateChild` (a driving gate's reject), `escalateChild` (the Kc/budget bound), and `foldHints` (a non-driving gate's advisory findings) — drop any finding whose full contract identity (severity + message + optional path) is already in the child's accumulated set, so a gate re-emitting the SAME still-unfixed findings every iteration does not grow `findings` (the June-13 dogfood runs stacked one identical ~108-finding set to 113→221→329) and the audited per-iteration `findingCount` (the `onIterate` ChildIterateEvent) reflects the DISTINCT accumulated set — never a false "regressing child" signal when literally nothing changed. Genuinely new findings (including a same-message finding with a different path or severity) still accumulate, preserving the intentional accumulated-findings-as-coder-hints design; `iteration` still counts every re-entry.

**Enforced by:**

- [`packages/workflows/src/finding-dedup.test.ts`](../packages/workflows/src/finding-dedup.test.ts)
- [`packages/workflows/src/finding-dedup.test.ts`](../packages/workflows/src/finding-dedup.test.ts)
- [`packages/workflows/src/finding-dedup.test.ts`](../packages/workflows/src/finding-dedup.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- CI `test`
