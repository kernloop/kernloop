> **Point-in-time snapshot.** This document recorded the state at its phase
> exit and is preserved for history; it is not maintained. For current
> capability see [README.md](../../README.md) — the live, claim-gated source
> of truth. Statements here (e.g. tool counts, "current phase") were true at
> the time and may since have been superseded.

# P0 Report — Verified Foundation

**Phase:** P0 (contracts + claims registry + CI gates + audit chain)
**Exit criterion (spec §11):** `claims:check` green on an empty-but-honest repo — **met**.
**Tag:** `v0.1.0-p0`. Built on `main` pre-ruleset per the phase protocol; rulesets
snap on at this checkpoint.

## Exit criteria verification

| #   | Criterion                                                       | Status                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fresh clone → `pnpm install && pnpm build && pnpm test` green   | ✓ verified on a clean `/tmp` clone (plus claims:check, governance:check, lint, audit:selftest)                                                                                                                                                                                                                                                                  |
| 2   | `claims:check` green, registry non-empty, all evidence resolves | ✓ 13 claims, all `verified`, all refs resolve                                                                                                                                                                                                                                                                                                                   |
| 3   | Deliberate-failure proofs                                       | ✓ in the test suite: tampered audit log fails verification (chain + property tests, CI self-test); dangling claim evidence fails the gate (`claims/src/check.test.ts`); a 401-line file fails the LOC gate (`scripts/__tests__/file-loc-gate.test.mjs`); over-budget package fails (`loc-check.test.mjs`); governance drift fails (`governance-check.test.mjs`) |
| 4   | No stub / TODO-wired / fail-closed paths                        | ✓ grep-clean across all source                                                                                                                                                                                                                                                                                                                                  |
| 5   | `BOOTSTRAP.md` complete and accurate                            | ✓ org/repo verified; rulesets applied at this exit; npm scope + domains remain human checklist items                                                                                                                                                                                                                                                            |

## Claims table (id → statement → evidence)

| ID       | Statement (abbrev.)                                                     | Evidence                                       |
| -------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| CLM-0001 | Five contracts zod-validated; malformed messages rejected at parse time | 4 tests + `ci:test`                            |
| CLM-0002 | Authority ladder is a closed four-tier enum                             | 2 tests                                        |
| CLM-0003 | All five contracts survive JSON round-trip                              | 5 tests                                        |
| CLM-0004 | Contract surface frozen at exactly five                                 | 5 tests                                        |
| CLM-0005 | Manifests carry governance as data (tier/maturity/promotion/claims)     | 4 tests                                        |
| CLM-0006 | All five reject unknown keys (field drift fails loudly)                 | 5 tests                                        |
| CLM-0007 | claims:check fails on dangling evidence                                 | 4 deliberate-failure tests                     |
| CLM-0008 | verified-without-test-evidence fails the gate                           | 1 deliberate-failure test                      |
| CLM-0009 | Audit events hash-chained; chain verifies with exact length             | 1 test                                         |
| CLM-0010 | Every envelope carries contractsVersion                                 | 1 test                                         |
| CLM-0011 | Single bit-flip detected and attributed to seq                          | 1 test                                         |
| CLM-0012 | Truncate / reorder / delete fails verification                          | 3 tests                                        |
| CLM-0013 | Tamper evidence property-tested across seeded chains                    | 2 parameterized tests (5 seeds × 25 mutations) |

Full statements in `claims/registry/`; quoted verbatim in README's claims block.

## LOC vs budgets

| Package                             | LOC | Budget |
| ----------------------------------- | --- | ------ |
| packages/contracts                  | 474 | 800    |
| packages/kernel (audit module only) | 477 | 5,000  |

File ≤400 / function ≤50 enforced by eslint (errors, not warnings).

## Coverage (thresholds ≥80% in every vitest config)

| Suite               | Lines | Branches | Tests |
| ------------------- | ----- | -------- | ----- |
| @kernloop/contracts | 100%  | 100%     | 69    |
| @kernloop/kernel    | 100%  | 93.6%    | 59    |
| @kernloop/claims    | 99.0% | 89.5%    | 47    |
| root gate scripts   | 98.6% | 87.1%    | 21    |

196 tests total.

## Porting deltas from nexus-agents v1 (audit module, spec §10 item 1)

Detailed in `packages/kernel/src/audit/PORT-NOTES.md`. Highlights:

- v1 hashed only 7 envelope fields via insertion-ordered `JSON.stringify`, so
  payload edits were invisible to verification. Kernloop hashes **every**
  field over a documented canonical serialization (recursive sorted keys).
- Genesis prevHash is a documented constant (64×`0`) instead of `undefined`.
- Verification targets the stored JSONL file, not an in-memory array; added
  monotonic `seq` (1-based) and `contractsVersion` on every envelope.
- Dropped: un-chained legacy mode (v1's "legacy log passes" test is
  deliberately inverted — it now fails), queue/flush buffering, rotation
  (breaks the single verifiable chain), `query()` (P1 `audit` tool).
- Truncation is detectable only with an external length witness:
  `verifyChain(store, { expectedLength })`. Documented limitation with an
  explicit test; the CI self-test exercises it.

## Spec ambiguities encountered → resolutions

1. **"test doesn't exist/passes" in claims:check** — resolver verifies the
   test exists by exact literal name; the CI pipeline orders `claims:check`
   after the `test` job, so a green gate also implies the referenced tests
   ran green. Documented in `claims/src/resolve.ts`.
2. **Open supporting types in spec §4** (EvidenceRequirement, Check, Cost…)
   — designed minimal and strict (unknown keys rejected); all judgments
   JSDoc'd in `packages/contracts`. Most-likely-revisited: strict-vs-tolerant
   unknown-key policy at bus boundaries.
3. **Sentence segmentation for the capability lint** — conservative: one
   sentence per line inside claims blocks; a wrapped line is not a sentence.
4. **`it.each` evidence refs** — resolver accepts the literal printf-style
   template name (`seed %i: …`); expanded titles are not static literals.
5. **Function-length lint on test suites** — `max-lines-per-function` is off
   for `*.test.*` (describe callbacks are functions); the 400-line file cap
   still applies everywhere.
6. **Claims authorship during fan-out** — the audit subagent could not write
   to `claims/` (owned by the registry subagent); it drafted its claims in
   its report and the orchestrator integrated them, fixing test-name
   references where the gate caught drift. Charter intent ("claims written by
   the implementer") preserved in substance.

## Deviations from the seed prompt

- **Fan-out shape:** the seed recommended A∥B∥C after the scaffold; executed
  A first, then B∥C in isolated worktrees, because B's registry contents and
  C's envelope (`contractsVersion`) both consume A's real exports — interface
  guessing across three parallel agents was the riskier path. Integration
  order A→B→C as specified.
- **CI history:** two intermediate red runs on main (a coverage-measurement
  nondeterminism, an eslint `no-useless-assignment`), each fixed in the next
  commit. The "every commit leaves CI green" standard was violated twice and
  is noted here rather than rewritten away.

## P1 starting line

What P0 leaves ready for the kernel work:

- **Contracts:** `@kernloop/contracts` exports all five schemas + `Tier`,
  `Maturity`, `contractsVersion`, `KNOWN_CONTRACTS`. The router/registry can
  validate manifests with `ManifestSchema` as-is.
- **Audit:** `appendEvent`/`verifyChain`/`createAuditStore` are plain library
  functions ready to back the kernel's AuditChain component and the P1 `audit`
  MCP tool (which adds `query` — deliberately not built in P0).
- **Gates to extend, not invent:** the isolation lint already encodes the
  faculty boundary rule; `governance-check.mjs` whitelists the spec §9 package
  set, so adding `packages/cli` etc. in P1 passes without edits; LOC budgets
  for kernel (5k) and faculties (4k each) are already enforced.
- **Claims workflow:** P1 begins by populating `claims/registry/` with the
  P1 backlog (kernel registry/router/ladder/bus, adapters, compiler, memory,
  quality gate, the nine remaining kernel tools) as `experimental` claims,
  promoted to `verified` as evidence lands.
- **Branch protocol:** P1 builds on `phase/p1`; exit PR to main carries
  `P1-REPORT.md`; the human merge is the ratification.
