# Architecture (thin, by design)

The canonical specification is [`docs/kernloop-kernel-spec.md`](docs/kernloop-kernel-spec.md).
This file is a map, not a copy; where they disagree, the spec wins.

## Layer model (spec §2)

```
L3  Workflows      canonical loop graph + repo overrides        (data: graphs)
L2  Faculties      compiler · memory · gates · workforce ·      (plugins)
                   observer · toolsmith
L1  Contracts      TaskContract · Brief · Verdict ·             (frozen types)
                   Outcome · Manifest
L0  Kernel         registry · router · audit chain ·            (~3–5k LOC)
                   ladder · bus · adapters
```

LOC budgets are CI-enforced acceptance criteria (spec §2): kernel ≤5,000,
contracts ≤800, each faculty ≤4,000, any file ≤400, any function ≤50.

## What exists per phase

| Layer                                              | Package                                         | Status                                  |
| -------------------------------------------------- | ----------------------------------------------- | --------------------------------------- |
| L1 Contracts                                       | [`packages/contracts`](packages/contracts/)     | **P0 — built** (spec §4)                |
| L0 Kernel: audit chain                             | [`packages/kernel`](packages/kernel/src/audit/) | **P0 — built** (spec §3.1, §3.3, §10.1) |
| L0 Kernel: registry, router, ladder, bus, adapters | `packages/kernel`                               | **P1 — built** (spec §3)                |
| L2 Compiler, Memory, Quality gate                  | `packages/faculty-{compiler,memory,gates}`      | **P1 — built** (spec §5.1–5.3)          |
| L2 Vote gate, Workforce                            | `packages/faculty-{gates,workforce}`            | **P2 — built** (spec §5.3–5.4)          |
| L2 Review gate, Observer, Toolsmith                | `packages/faculty-{gates,observer,toolsmith}`   | **P3 — built** (spec §5.3, §5.5, §5.6)  |
| L3 Workflows (canonical loop + engine)             | `packages/workflows`                            | **P2 — built** (spec §6)                |
| CLI / MCP server (the kernel eleven)               | `packages/cli`                                  | **P1–P3 — built** (spec §3.4)           |

Cross-cutting, already live: the claims registry and `claims:check` gate
([`claims/`](claims/)), `governance:check`
([`scripts/governance-check.mjs`](scripts/governance-check.mjs)), the
plugin-isolation lint ([`eslint-rules/plugin.mjs`](eslint-rules/plugin.mjs)),
LOC budgets ([`scripts/loc-check.mjs`](scripts/loc-check.mjs)), and the CI
audit self-test ([`scripts/audit-selftest.mjs`](scripts/audit-selftest.mjs)).

Capability statements live in [README.md](README.md#capabilities-p0-verified)
under `claims:check` enforcement — none are made here.

## Constitutional rules (spec §1)

Seven rules; violations are kernel bugs, not style issues. Summarized:
wiring-complete or absent · claims-first · kernel never self-modifies ·
kernel contains no intelligence · plugins communicate only through contracts
over the bus · every automated behavior declares an authority tier ·
everything is audited. Full text in the spec and in [`AGENTS.md`](AGENTS.md).
