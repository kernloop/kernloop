# Parsimony Receipt — Kernel-Contract Doc

```
schema:  kernloop.parsimony-receipt/v1
version: 1.0.0
status:  active
owner:   williamzujkowski
epic:    #407 (Parsimony Invariant + Control-Floor Decision Receipts)
issue:   #417 (M4 — one canonical rule + the receipt contract doc)
```

> The durable contract for the `parsimony.receipt` audit event — the typed
> evidence a restraint decision emits. This doc is the human-readable companion
> to [`ParsimonyReceiptSchema`](../packages/parsimony/src/receipt.ts); the schema
> is the machine source of truth and wins on any disagreement. Every capability
> sentence below carries [CLM-0179].

## It is an audit EVENT, not a sixth Frozen-Five contract

The parsimony receipt is the PAYLOAD of a NEW typed event,
`parsimony.receipt`, appended to kernloop's EXISTING hash-chained, HMAC-keyed
audit log — it is NOT a sixth Frozen-Five contract [CLM-0179]. The chain
envelope (`appendEvent` / `verifyChain`) supplies the `prevHash` / `hash` /
`seq` fields, so the receipt schema carries ONLY the domain payload and those
chain fields are deliberately absent from it [CLM-0179]. The event `type`
constant is exported as `PARSIMONY_RECEIPT_EVENT` (`parsimony.receipt`)
[CLM-0179].

## Payload — every `ParsimonyReceiptSchema` field

The payload is a `strictObject`, so an unknown field is a validation error
rather than a silently-dropped one [CLM-0179]. Its fields are [CLM-0179]:

| field             | type                           | meaning                                                                  |
| ----------------- | ------------------------------ | ------------------------------------------------------------------------ |
| `receiptId`       | string (ULID)                  | identifies this receipt; the inline `kl:parsimony` marker back-links it  |
| `ts`              | string (ISO-8601)              | when the decision was recorded                                           |
| `loopIter`        | int ≥ 0                        | the canonical-loop iteration the decision belongs to                     |
| `overlay`         | string                         | the overlay identity that owns the decision (provenance)                 |
| `decisionType`    | literal `parsimony`            | discriminator distinguishing this event from other receipts              |
| `subject`         | string (`path:span` or symbol) | what the decision is about                                               |
| `rung`            | int 0–5                        | the ladder rung that resolved the decision (#409)                        |
| `outcome`         | `ParsimonyOutcome`             | the resolving rung's outcome (see below)                                 |
| `rationaleDigest` | string (e.g. `sha256:…`)       | a CONTENT HASH of the agent's rationale — never the prose                |
| `floorChecks`     | `FloorCheck[]`                 | the Control Floor checks evaluated against this decision                 |
| `deferred`        | `Deferred` \| `null`           | a deferred shortcut, or `null` when every applicable guard was satisfied |
| `verification`    | `Verification`                 | the blind-verification verdict                                           |

`rationaleDigest` stores a hash, not the prose, so the blind verifier judges the
diff against the floor WITHOUT being biased by the agent's self-justification
[CLM-0179].

### `outcome` — the six restraint outcomes

`ParsimonyOutcome` has exactly six values, one per ladder rung: `skip` (rung 0,
`need` failed), `reuse_stdlib`, `reuse_native`, `reuse_dep`, `one_line`, and
`minimal_impl` (rung 5, nothing cheaper held) [CLM-0179]. The ladder stops at the
first rung that holds, and the resolving rung's outcome is recorded so the
receipt names WHY the minimum was chosen [CLM-0179].

### `floorChecks[]` — the Control Floor results

Each `FloorCheck` carries `name`, `catalog`, `controlIds`, a `status` of
`pass` / `na` / `deferred`, and an optional `evidenceRef` [CLM-0179]. The floor
is MULTI-CATALOG: `controlIds` is empty for a non-control catalog (an `intent`
guard or a Section 508 entry that maps to no 800-53 control), which the OSCAL
projection must tolerate [CLM-0179]. A check is `na` when the entry did not apply
to the diff, `pass` when it applied and was satisfied, and `deferred` when it
applied and was NOT satisfied [CLM-0179].

### `deferred` — the first-class debt block

When an applicable floor guard is unsatisfied, the receipt carries a `Deferred`
block — a FIRST-CLASS finding, never a buried comment — with `debtId`, `reason`,
a non-empty `controlRisk` (the control ids at risk), and an `owner` [CLM-0179].
It is linked to the inline marker by `debtId` so `kl debt` (#6) and the OSCAL
projection (#8) can surface it [CLM-0179].

### `verification` — the blind verdict

`Verification` records `method` (always `blind_independent`), the `verifier`,
`checkedFloor`, and a `status` of `pending` / `confirmed` / `refuted`
[CLM-0179]. The verifier sees the diff + the floor checklist only, never the
rationale (hence `rationaleDigest`), and a `refuted` status FAILS the loop
iteration at intensity `full` / `ultra` (CLM-0177) [CLM-0179].

## The deferred invariant (a `superRefine`)

Beyond the field shape, `ParsimonyReceiptSchema` enforces a DEFERRED INVARIANT
via a `superRefine`: a `deferred`-status floor check exists **iff** the receipt
carries a `deferred` block [CLM-0179]. This stops a receipt from claiming a
deferred control without recording the debt (an unmitigated shortcut hidden from
`kl debt` / OSCAL), or recording a debt block with no floor check that actually
deferred — either way the record would lie about what happened [CLM-0179].

## The `kl:parsimony` marker grammar

Every receipt has a stable, GREPPABLE one-line marker — the human/grep-facing
shorthand that back-links to the full receipt [CLM-0179]. Its grammar is
[CLM-0179]:

```
kl:parsimony rung=<0-5> outcome=<outcome> floor=<id|name>:<status>[,…] defer=<none|debtId> receipt=<receiptId>
```

Every field is space-free, so a plain `grep 'kl:parsimony'` over a tree finds
every marker and `parseMarker` lifts the `receipt=<id>` back-reference out
[CLM-0179]. The `floor` field lists every check that is NOT `na` (the checks that
actually applied), each as `<controlId-or-name>:<status>`; `defer` is `none` when
there is no deferred block, else the `debtId` [CLM-0179]. A check that maps to a
NIST control uses its FIRST control id (the most specific catalog handle); a
non-control entry uses its `name` [CLM-0179].

The compact agent-facing instruction that tells a coder to emit this marker —
climb the restraint ladder, hold the control floor, emit `kl:parsimony` — is
single-sourced as `COMPACT_PARSIMONY_RULE` in `@kernloop/parsimony`, embedded in
the implement/coder prompt and rendered into the per-harness copies under
`skills/parsimony-restraint/` by `scripts/render-parsimony-rule.mjs` (CI
drift-gated) [CLM-0179].

## Verification block (read-back)

A receipt is parsed + validated at the boundary where it is read back off the
audit log via `parseParsimonyReceipt`, which THROWS on a malformed receipt rather
than coercing a partial one through [CLM-0179]. `hasDeferredFloor` reports whether
an applicable floor check was unsatisfied — i.e. whether the receipt MUST carry a
`deferred` block — so a consumer can reject an inconsistent receipt [CLM-0179].

## OSCAL projection pointer

The receipt projects to OSCAL Assessment Results
([`packages/parsimony/src/oscal.ts`](../packages/parsimony/src/oscal.ts), #8),
where each applicable floor check becomes an OSCAL observation/finding against its
control selection — a NIST-800-53r5-mappable record of the restraint decision
[CLM-0179]. The projection must NOT assume every floor entry maps to a NIST
control: the non-control catalogs (Section 508 accessibility, the `intent` guard)
carry an empty `controlIds` and are projected as a non-NIST observation
[CLM-0179].
