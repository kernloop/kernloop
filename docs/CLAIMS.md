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

The vote-iterate cycle is bounded at K iterations (default 3) before escalating to the human; and the child fan-out re-runs implement on a quality reject, bounded by Kc (default 3), folding the gate findings into the coder prompt — at the Kc/budget bound the child escalates without failing the sibling children or the whole run, and each re-iteration is audited.

**Enforced by:**

- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- [`packages/workflows/src/engine.test.ts`](../packages/workflows/src/engine.test.ts)
- [`packages/workflows/src/resume.test.ts`](../packages/workflows/src/resume.test.ts)
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

The canonical loop runs a review gate per child after the quality gate (implement then quality then review); the review Verdict is advisory, audited, and does not block integration.

**Enforced by:**

- [`packages/workflows/src/graph.test.ts`](../packages/workflows/src/graph.test.ts)
- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/cli/src/loop/gates-in-loop.test.ts`](../packages/cli/src/loop/gates-in-loop.test.ts)
- [`packages/cli/src/loop.test.ts`](../packages/cli/src/loop.test.ts)
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

Budget enforcement is a run-level MODE, not a contract change: in enforce mode (default) a run whose metered spend exceeds its parent budget escalates and halts (resumable) rather than silently continuing; in unlimited mode the budget never halts the run, but usage and cost are STILL metered and reported identically, and the run is recorded honestly as having run without budget enforcement.

**Enforced by:**

- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
- [`packages/workflows/src/child-iterate.test.ts`](../packages/workflows/src/child-iterate.test.ts)
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

The doc-coverage gate (#64) requires every VALUE export — function, const, class, enum — on a gated package's public API surface to carry a real, non-placeholder doc-comment, rejecting trivially-empty docs and docs that merely restate the symbol name. The public-API resolver chases the barrel graph RECURSIVELY (#72): it follows named re-exports through NESTED barrels to the real declaration that carries the doc-comment, resolves a RENAME re-export (`export { X as Y }`) by its local name while surfacing the alias (#214), surfaces a BARE local re-export (`export { foo }` with no `from`, #213), and EXPANDS relative `export *` into its named symbols (breaking any cycle, memoizing each file). Only an EXTERNAL `export *` stays opaque — gated in its owning package — and is surfaced as a count, never hidden. So thirteen packages are gated (contracts, kernel, cli, docscan, workflows, faculty-compiler, faculty-gates, faculty-memory, faculty-observer, faculty-scrum, faculty-toolsmith, faculty-workforce, tracker) — the nested-barrel and `export *` packages (cli/workflows/kernel) included, no longer under-reported. A gap exits 1 with a per-package report and the gate runs in CI. The exclusion is by KIND, recorded permanently (never a silent weakening): type aliases/interfaces (incl. z.infer companions) declare no runtime value, so they are not gated — but a VALUE re-exported via `export type` still is (#215). It is a QUALITY gate, not claim evidence — a doc-comment proves a symbol is documented, never that it behaves; tests remain the verified bar.

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

A model-CLI adapter subprocess runs in a caller-given working directory, not the parent's cwd: when the canonical loop drives an adapter it passes the task WORKSPACE as that cwd (#146), so an agentic CLI (claude/codex/gemini/opencode) is grounded in — and confined to — the workspace, never the directory kernloop was launched from. Omitting cwd inherits the parent cwd (the documented default, exercised); the loop never omits it.

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

Under an explicit gates.quality.sandbox.enabled opt-in (default off), the quality gate runs each subprocess check inside the kernel Docker sandbox: the workspace is copied into an ephemeral scratch — excluding .git and credential-bearing files and never dereferencing escaping symlinks — together with its node_modules, and the check runs under a DIGEST-PINNED, content-hash-pinned (ratified profile only; no overlay override), non-root, --network none, memory/cpu/pids-capped profile via runInSandbox; pnpm/yarn script commands are translated to npm run so they execute offline against the copied node_modules. A FUNCTIONAL Docker probe selects the tier; with the sandbox enabled and Docker unavailable the enforce path FAILS CLOSED (refuses to run generated checks unsandboxed) while an explicit opt-out degrades to the env-scoped host spawn, and the achieved isolation tier is surfaced in the Verdict (tier-reported == tier-applied). Disabled, the gate is byte-identical to the env-scoped host spawn. Real-docker tests prove network egress is blocked, host filesystem outside the scratch is unreadable, a fork-bomb is capped, and a glibc native dependency still loads.

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

The quality gate ships a built-in MODEL-FREE security check over generated deliverable code (#277, #227 item 3, spec §5.3) — an always-on in-process scan (no external binary, so it never degrades to no-signal) wired into the DEFAULT check set as `security`, at the faculty's advisory tier. It is a CURATED high-confidence, low-false-positive smell detector, NOT exhaustive SAST: it flags dynamic code execution (`eval`/`new Function` with a NON-literal argument — a string literal is the safe form and is NOT flagged), shell-command injection (the SHELL-invoking `exec`/`execSync` with a non-literal command in a file that imports child_process — the argv-array `spawn`/`execFile` are safe and NEVER flagged), and known-FORMAT hardcoded secrets (AWS/GitHub/Google/Slack keys, PEM private keys), each as an advisory `error` Finding. It reads source as DATA (AST + regex, never executed), never throws on unparseable OR deeply-nested input (a depth-bounded AST visit + a defensive catch, so a crafted file cannot overflow the in-process gate), and reuses the shared no-symlink-follow walk + byte budgets so an untrusted workspace cannot escape the tree or OOM the loop. It is HONEST about its evasions: the code rules match a BARE eval/Function/exec name, so indirection (globalThis['ev'+'al'], an aliased eval) and any call nested past the depth cap are NOT flagged, and the secret scan reports the first match of each format per file — acceptable because it is advisory and claims no completeness. The broader external-tool (semgrep/secret-scan) tier is deferred (#276) until the binaries can be bundled into the gate sandbox.

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

kernloop estimates a run's model-CALL-COUNT before it runs (EPIC #47·P5 #303): a PURE function over the frozen CANONICAL_LOOP shape × the overlay K/Kc/panel config returns a [min,max] band — min the first-pass happy path, max assuming every gate iterates to its cap (plan ×(K+1), implement ×(Kc+1)) and the CLM-0107 parse-retry fires — broken down per node (quality contributes ZERO, being mechanical). `kernloop doctor` surfaces it with its assumptions stated, including that the child count is an explicit assumed input (decompose decides it at runtime). It is HONEST about what it cannot know: it NEVER fabricates a dollar figure (per-call cost is metered at runtime, not declared) — a $ projection is only the caller's own explicit rate × this count. The arithmetic is BOUND TO ACTUAL loop behavior: a real hermetic canonical-loop run counts its model calls and they equal the estimate's min (the happy path) and never exceed its max — proving the estimate tracks the loop, not only itself.

**Enforced by:**

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
