# Parsimony Threat Taxonomy

```
schema:  kernloop.parsimony-threat-taxonomy/v1
version: 1.0.0
status:  active
owner:   williamzujkowski
epic:    #407 (Parsimony Invariant + Control-Floor Decision Receipts)
```

> A VERSIONED catalogue of the adversarial behaviours the parsimony subsystem
> exists to catch — each entry naming the threat, the control it attacks, the
> kernloop defence that catches it, and the **residual** that defence does NOT
> yet catch. This document is the durable record of WHAT the
> [Control Floor](../packages/parsimony/src/floor.ts) and the
> [blind verifier](../packages/cli/src/loop/parsimony-verify.ts) defend against
> and — equally important, per the prime directive — what they do not. An entry
> claims a defence ONLY where a load-bearing test proves it; the residual is
> stated honestly and linked to its follow-up issue.

## Schema

Each entry has the fields:

| field            | meaning                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `id`             | stable threat id (`PT-NNN`), never reused                                  |
| `title`          | one-line name of the adversarial behaviour                                 |
| `description`    | what the agent does                                                        |
| `attacks`        | the control(s) the behaviour subverts (NIST 800-53r5 / Section 508 ids)    |
| `kernloop_defense` | the wiring-complete mechanism that catches it, and the proving test       |
| `residual`       | the variant the defence does NOT yet catch, with its follow-up issue       |

---

## PT-001 — YAGNI-as-attack: invoke parsimony to justify dropping a control [CLM-0178]

- **id:** PT-001
- **title:** Agent invokes a YAGNI / "keep it simple" rationale to justify
  dropping an access-enforcement or input-validation control.
- **description:** A coder agent produces a diff that crosses a trust boundary
  (untrusted input enters) and/or a privilege boundary (access is granted or
  checked), then leans on a parsimony / restraint rationale ("YAGNI", "the
  caller already validates", "no auth needed here yet") to OMIT the control the
  boundary requires. The agent's parsimony **assessor** emission then reports
  the relevant Control Floor guard as `satisfied` (a `pass`) — i.e. it CLAIMS
  the control is in place — while the actual diff does not implement it. This is
  the **pass-OVER-claims** variant: the agent claims the control is satisfied;
  the diff shows it is not.
- **attacks:**
  - **AC-3 (Access Enforcement)** — via the `access_enforcement` floor guard
    (`appliesWhen: enforcesAccess`; also IA-2, SC-8).
  - **SI-10 (Information Input Validation)** — via the `input_validation` floor
    guard (`appliesWhen: crossesTrustBoundary`).
- **kernloop_defense [CLM-0178]:** The Check-layer parsimony gate runs a SECOND,
  INDEPENDENT **blind verifier** (`verifyFloor`,
  `packages/cli/src/loop/parsimony-verify.ts`) over the diff. The verifier is
  given ONLY the diff and the NAMES of the guards the assessor claimed `pass` —
  never the assessor's rationale — so the YAGNI self-justification cannot bias
  it. It re-checks each claimed-pass guard against the diff and REFUTES any it
  does not actually find satisfied. At intensity `full` (the default, CLM-0177) a
  refute makes the parsimony Verdict `reject`, with a finding NAMING the refuted
  guard(s); a persistently-refuting child re-iterates through the existing
  child-iterate back-edge and, if never fixed, FAILS its iteration at the Kc
  bound. Proven by the load-bearing adversarial tests in
  `packages/cli/src/loop/parsimony-attack.test.ts` (the gate-level refute→reject
  proof, exercising the REAL executor + REAL `verifyFloor`) and
  `packages/workflows/src/child-iterate.test.ts` (the loop-level Kc-exhaustion
  proof).
- **residual [CLM-0178]:** The blind verifier is **answer-key-anchored** — it
  re-checks only the guards the assessor CLAIMED `pass`. It does NOT
  independently derive the `FloorContext` from the diff. So the
  **applicability-UNDER-claims** variant — the agent's assessor reporting a floor
  flag `false` / a guard `na` (claiming the boundary is NOT crossed at all) when
  the diff really crosses it — bypasses BOTH the verifier (nothing claimed-pass
  to refute) AND the deferral (nothing deferred). This entry's defence and test
  cover ONLY the pass-OVER-claims variant; the na-lying / under-claim variant is
  an OPEN residual tracked by follow-up **#435** (the verifier deriving the
  FloorContext itself and the executor refuting on a missed boundary). Do not
  read PT-001 as covering the na-variant.

---

## Maintenance

Add an entry whenever a new adversarial behaviour against the parsimony
invariant is identified. Bump `version` (semver: patch for editorial, minor for
a new entry, major for a schema change). Every capability sentence in an entry's
`kernloop_defense` or `residual` MUST carry a `[CLM-xxxx]` tag pointing at the
claim whose evidence proves (or scopes) it — an entry without a proving claim is
prose, not a defence.
