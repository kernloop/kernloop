# MIGRATIONS

Contract migrations for the Frozen Five (`packages/contracts/**`). Each entry
records a change to a frozen schema, why it is backward-compatible (or what a
consumer must do), and the ratification that allowed it. A schema change without
an entry here fails the honesty round.

---

## 2026-06-19 — `VerdictResult` gains `escalate` (#192)

**Change.** `VerdictResultSchema` grows from
`approve | reject | abstain | pass | fail` to add a sixth value, `escalate`.

**Semantics.** `escalate` (≈ ASK, quarried from omnigent's ALLOW/DENY/ASK) is the
human-decision disposition: a gate that will _neither approve nor block_ because
a human must rule. It is **not** a synchronous human-in-the-loop prompt — an
autonomous loop has no human present at the moment a gate escalates. The
canonical loop routes an `escalate` Verdict to its **existing** escalated
outcome: it **halts** as `status: 'escalated'` and surfaces the run to the
operator on the next interaction (carrying the gate findings), with a distinct
`haltReason: 'vote-escalation'` so an operator can tell a deadlock-halt from an
iteration/budget-exhaustion halt. Never a silent pass; never an automatic reject.

**Backward compatibility — additive, byte-identical for existing data.** The new
value is optional in practice: it is produced only by the vote gate, and only
when the overlay opts in via `gates.vote.escalateOnNoConsensus` (default
`false`). With the flag off, vote aggregation is byte-identical to its prior
behavior (a deadlock still resolves to `reject`). Any Verdict serialized before
this change validates unchanged, and any consumer that never enables the flag
observes no new value.

**Source-compatibility — handled, not silent.** Adding a value to a TypeScript
enum does not by itself force consumers to handle it. To prevent silent
mishandling, the loop's verdict routing now goes through a single exhaustive
classifier (`verdictDisposition`, `packages/workflows/src/verdict-disposition.ts`)
with a `never`-exhaustiveness guard: a future addition to `VerdictResult` is a
**compile error** at the routing point until handled. Every audited consumer
(`advanceVote`, `childBranch`, the integrate aggregation) was updated in the same
change.

**Ratification.** Frozen-Five change. Design ratified by nexus `consensus_vote`
(supermajority, 7-0) on the producer/consumer scope and the async-halt honesty
wording; the diff ratified by a second `consensus_vote`; merged via the
human-review PR path. Claim: `CLM-0157`. Deferred follow-up: an advisory
review-gate producer (#359).
