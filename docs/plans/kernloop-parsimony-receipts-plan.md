# Parsimony Invariant + Control-Floor Decision Receipts

**Kernloop enhancement plan, derived from `DietrichGebert/ponytail`**
Status: proposal · Owner: William (Grenlan) · License: MIT

---

## 0. TL;DR

Ponytail proves three reusable ideas at scale: an **ordered decision cascade with early exit** (the ladder), an **optimization paired with a non-waivable floor** (the carve-out list), and an **inline marker harvested into a debt ledger later** (the `ponytail:` comment + `/ponytail-debt`).

We lift all three into Kernloop, but close the one thing ponytail structurally cannot do — _verify its own floor_ — using blind independent completion verification, and we make the marker a **typed Decision Receipt mapped to NIST 800-53r5 / OSCAL control IDs**. Every "I chose not to write X" becomes a hash-chained, control-tagged, OSCAL-projectable observation.

Net new capability: a compliance-aware restraint mechanism where parsimony decisions that touch a control boundary produce auditable evidence instead of silent shortcuts.

**Design constraint respected:** this does **not** add a sixth kernel contract. It is one loop hook + policy data + an extension to the existing Decision Receipt. The frozen kernel stays frozen.

---

## 1. What we are porting (and what we change)

| Ponytail mechanism                    | What it is                                                                                | Kernloop port                              | Change we make                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| The ladder                            | Ordered preference cascade, stop at first rung that holds                                 | Parsimony Ladder (deterministic evaluator) | Lives at the **Prime** layer (prompt disposition); evaluator logs which rung fired into the receipt                                  |
| The floor                             | "Not lazy about: validation, error handling, security, accessibility, anything requested" | Control Floor                              | The actual **invariant**: typed by catalog (NIST / 508 / intent), mapped to control IDs, enforced at the **Gate** — never the prompt |
| `ponytail:` marker                    | Unstructured comment flagging a deferred shortcut                                         | Inline `kl:parsimony` marker               | Typed, greppable, receipt-linked; full record goes to the hash-chained log                                                           |
| `/ponytail-debt`                      | Harvest markers into a list                                                               | `kl debt`                                  | Harvests structured receipts; surfaces control-risk per deferral                                                                     |
| `/ponytail-review`, `/ponytail-audit` | Detective passes (diff / repo)                                                            | `kl review`, `kl audit`                    | Same preventive/detective split; review returns an actionable delete-list                                                            |
| Intensity `lite/full/ultra/off`       | Single severity knob                                                                      | Overlay-bound intensity                    | Bound to per-repo overlay identity                                                                                                   |
| `check-rule-copies` drift test        | One canonical rule, generated per-harness copies, CI fails on drift                       | Single-source rule + drift test            | Mirror exactly across Claude/Codex/Gemini/OpenCode                                                                                   |
| **(none — ponytail's gap)**           | floor is honor-system, never verified                                                     | **Blind floor verification**               | Verifier receives diff + floor checklist only, not the rationale                                                                     |

---

## 2. Design — the kernel contract

### 2.1 The Parsimony Ladder (the invariant)

A pure, deterministic evaluator. Cheap mechanical rungs resolve first; the one subjective rung is last. Stop at the first rung that holds and emit a receipt naming the rung.

```
rung 0  need        does this need to exist?            no  → outcome=skip
rung 1  stdlib      stdlib already does it?             yes → outcome=reuse_stdlib
rung 2  native      native platform feature does it?    yes → outcome=reuse_native
rung 3  dep         an installed dependency does it?    yes → outcome=reuse_dep
rung 4  oneline     expressible in one line?            yes → outcome=one_line
rung 5  minimal     otherwise: minimum that works       —   → outcome=minimal_impl
```

Invariant (enforced in the canonical execution loop): **no parsimony decision commits until (a) the ladder has been evaluated top-down and the resolving rung recorded, (b) the Control Floor guard passes, (c) a Decision Receipt is emitted, (d) the blind verifier has been handed the floor checklist.** This is the scope-narrowing delegation invariant applied to restraint: the loop narrows from "write whatever" to "the minimum that survives the floor."

Implementation notes (your standards): evaluator is a pure function, ≤50 lines, no I/O; ladder definition is policy data, not code; ≥80% coverage with a truth-table test per rung.

### 2.2 The Control Floor (non-waivable guards)

Ponytail's floor is prose. Ours is typed, because the members are heterogeneous — some are NIST controls, some are 508, some aren't controls at all. The schema must tag each entry with its catalog.

| Ponytail floor member               | Kernloop Control Floor entry | Catalog                | Control ID(s)                                  |
| ----------------------------------- | ---------------------------- | ---------------------- | ---------------------------------------------- |
| input validation at trust boundary  | Input validation             | NIST 800-53r5          | **SI-10**                                      |
| error handling preventing data loss | Error handling / recovery    | NIST 800-53r5          | **SI-11**, CP-10 (where recovery applies)      |
| security (authZ at boundary)        | Access enforcement           | NIST 800-53r5          | **AC-3** (+ IA-2 if authN, SC-8 if in transit) |
| accessibility                       | Accessibility                | Section 508 / WCAG 2.x | **508 / WCAG SC** — _not an 800-53 control_    |
| _(Kernloop adds)_ audit logging     | Audit + non-repudiation      | NIST 800-53r5          | **AU-2, AU-3, AU-10**                          |
| anything explicitly requested       | Intent guard                 | _(policy, no catalog)_ | —                                              |

Design implications:

- Floor entries are `{name, catalog, control_ids[], applies_when}` — `applies_when` is a predicate over the changed trust boundary so the floor only fires on relevant diffs.
- Two entries (accessibility, intent guard) prove the floor is multi-catalog. Don't hardcode 800-53.
- A floor entry that `applies_when` matches and is not `pass`/`na` **cannot** be silently dropped — it must produce a `deferred` block with explicit `control_risk`, which is itself a finding.

### 2.3 The Decision Receipt — `parsimony` type

Extends your existing hash-chained Decision Receipt with a new `decision_type`. The inline marker is the human breadcrumb; the full record is the chained log entry.

**Inline marker grammar** (greppable, receipt-linked — fixes ponytail's unstructured-comment gap):

```
// kl:parsimony rung=2 outcome=reuse_native floor=SI-10:pass,AU-2:pass defer=none receipt=01J9...ULID
```

**Full receipt (chained log record):**

```jsonc
{
  "receipt_id": "01J9...", // ULID
  "ts": "2026-06-20T14:03:11Z",
  "loop_iter": 42,
  "overlay": "agent://builder@nexus-substrate/kernloop",
  "decision_type": "parsimony",
  "subject": "src/loop/commit.ts:88-120", // path:span or symbol
  "rung": 2,
  "outcome": "reuse_native",
  "rationale_digest": "sha256:...", // store digest, not prose, for blind verification
  "floor_checks": [
    {
      "name": "input_validation",
      "catalog": "nist-800-53r5",
      "control_ids": ["SI-10"],
      "status": "pass",
      "evidence_ref": "test://si10_boundary",
    },
    {
      "name": "audit_logging",
      "catalog": "nist-800-53r5",
      "control_ids": ["AU-2", "AU-3"],
      "status": "pass",
      "evidence_ref": "log://emit",
    },
  ],
  "deferred": null, // or { debt_id, reason, control_risk[], owner }
  "verification": {
    "method": "blind_independent",
    "verifier": "agent://verifier@isolated-overlay",
    "checked_floor": true,
    "status": "confirmed", // pending | confirmed | refuted
  },
  "prev_hash": "sha256:...",
  "hash": "sha256:...",
}
```

Key design choices:

- `rationale_digest` not raw rationale: the verifier judges the diff against the floor **blind**, so the agent's self-justification can't bias it. The prose lives elsewhere, hashed in.
- `verification.status: refuted` **fails the loop iteration** — this is the gate ponytail lacks.
- `deferred.control_risk[]` makes deferred shortcuts first-class findings, not buried comments.

### 2.4 OSCAL projection (the differentiator)

A pure projection `receipt → OSCAL assessment-results`. Each receipt with a `floor_checks` entry or a `deferred.control_risk` becomes an OSCAL **observation**; refuted verifications and unmitigated deferrals become **findings** linked to the control IDs. Validate the output against the OSCAL schema (oscal-cli or compliance-trestle) in CI.

This is the white space: a parsimony decision — literally _not writing code_ — emitting catalog-mapped, schema-valid assessment evidence. No other agent restraint tool does this.

### 2.5 Where it lives — the prime / check / gate model

Enforcement strength is inversely proportional to model discretion. The system prompt and MCP are both _non-binding_: the prompt is persuasion (the model decides whether to comply, and the rule's salience decays deep in a long agentic run), and an MCP tool is an offered capability (the model decides whether to call it). Neither is enforcement. Enforcement is a deterministic gate the model did not author and cannot route around. So each piece of this design is placed at the layer matching the guarantee it needs — and a rule that "must never be violated" cannot live in the prompt and still be that rule.

| Layer     | Mechanism                                        | Discretion                     | What lives here                                                                    | Guarantee                                                    |
| --------- | ------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Prime** | System prompt / AGENTS.md                        | Max — model may ignore         | The **Parsimony Ladder** as disposition; the compact rule                          | None — shapes the prior, lowers violation rate at generation |
| **Check** | Tool / MCP, invoked just-in-time at the decision | High — model may skip the call | **Floor evaluation** + **receipt emission** as capabilities returning ground truth | None on its own — produces the evidence the gate consumes    |
| **Gate**  | Deterministic code the model can't author        | Zero — runs regardless         | The **`pre_commit` hook**: verify receipt + floor, block on `refuted`              | The only layer with a guarantee                              |

Concretely, mapped to the three ported pieces:

- **Ladder → Prime.** It is a preferred default; occasional misses are inefficiency, not breach. The prompt is its correct home. Keep it ruthlessly compact (long rules decay faster and tax every turn) and single-sourced/drift-checked across harnesses (issue #12).
- **Receipt → Check.** Evidence must be emitted by machinery, never asserted by the model. A model writing "✓ floor respected" because the prompt told it to is grading its own homework, and it contaminates the OSCAL evidence chain the whole differentiator depends on. Emit as a tool/code action, not prompt text.
- **Floor → Gate.** The floor is defined as "must never be violated," so it cannot be a prompt rule. It is verified by the deterministic gate; `verification.status: refuted` fails the iteration. This is the layer ponytail lacks.

The prompt and MCP are the ergonomic and evidentiary layers _around_ the gate, not substitutes for it. The decision rule per future rule: occasional misses acceptable → Prime only; needs ground truth the model can't self-assess → Check; must never be violated → Gate, with Prime + Check as the funnel that reduces how often the gate must say no.

**Frozen-kernel placement (kernloop, owns its loop):**

- **Kernel code (Gate):** one `pre_commit` hook — evaluate ladder, run floor, consume receipt, await verification, block on refute. Small, frozen, contract-stable.
- **Policy data (overlay-loadable, not kernel):** ladder definition, Control Floor catalog mapping, intensity level.
- **Receipt schema:** extension of the existing receipt contract — a new `decision_type`, no new top-level contract.
- **Verifier:** runs in an isolated overlay (blind independent verification).
- Do **not** mint a sixth typed contract. If the hook later proves overloaded, promote it then — start as policy + one hook.

### 2.5a Harness-hosted variant (nexus-agents)

Where the gate physically lives depends on **loop ownership**. kernloop owns its canonical loop, so the gate goes in-loop as above. nexus-agents, when it rides someone else's harness (Claude Code, Codex, Gemini, OpenCode), **does not own the commit point** — there is no in-loop seam to insert a hard gate. The Prime and Check layers are unchanged (same compact rule, same floor-check/receipt tools), but the **Gate relocates to the VCS/CI boundaries you do control**:

| Gate seam         | Mechanism                                                               | Blocks on                                                   |
| ----------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| Pre-commit        | git `pre-commit` hook running the floor check + receipt validation      | floor violation or missing receipt for a parsimony decision |
| Pre-push          | git `pre-push` hook re-running verification offline                     | unverified or `refuted` receipts                            |
| CI required-check | pipeline job: replay receipts, run OSCAL projection + schema validation | invalid OSCAL, refuted verification, unmitigated deferral   |
| PR merge gate     | blind-verifier overlay registered as a **required reviewer**            | verifier refute = merge blocked                             |

The guarantee is weaker than an in-loop gate (it catches at commit/push/merge rather than at generation), but it is still a deterministic gate the model cannot route around — which the prompt and MCP layers can never be. Net: **same three layers everywhere; the gate's address is the only thing that changes with loop ownership.** Capture this as an explicit acceptance criterion on the nexus-agents port so no one mistakes "we shipped the AGENTS.md rule" for "we enforced the floor."

### 2.6 Intensity dial, overlay-bound

`off | lite | full | ultra`, resolved from the per-repo overlay. `lite` = ladder + receipts, floor advisory. `full` = floor enforced, verification required. `ultra` = full + deferrals blocked entirely (no debt allowed; every floor entry must be `pass`/`na` at commit). Default `full`.

---

## 3. Validation workstream (run via Claude Code / `gh` CLI)

Point the CLI agent at this doc + the ponytail repo and run in order. Treat each as a spike with a written finding before implementation.

1. **Reproduce ponytail's measurement.** Clone ponytail, extract its canonical rule and its corrected benchmark (the n=4, matched-agentic-baseline, score-the-git-diff method from issue #126). Reproduce one run to confirm we understand the harness before adapting it.
2. **Stand up a Kernloop fixture repo** with a matched agentic baseline (same agent, real repo, real diffs) so our numbers are honest from day one.
3. **Add compliance dimensions ponytail can't measure:** floor-violation rate, receipt completeness, OSCAL-validity rate, deferral count + control-risk surface. These are the metrics that justify the work.
4. **Adversarial floor test.** Construct a case where the agent uses YAGNI to justify dropping an AC-3 / SI-10 check. Confirm the blind verifier **refutes** and the loop iteration fails. This test _is_ the proof the gap is closed; it also seeds the threat-taxonomy entry.
5. **OSCAL schema validation.** Project a batch of receipts → assessment-results, validate against the OSCAL schema in CI. Fail the build on invalid output.
6. **Drift test.** Single-source the compact rule, generate per-harness copies (Claude/Codex/Gemini/OpenCode), add a drift check that fails CI if copies diverge — ponytail's `check-rule-copies` approach.

---

## 4. Ticket set

Epic + 12 issues. Labels assume `kernloop` repo; keep sensitive design notes in a private repo per your norm. `gh` commands below are copy-pasteable; adjust `--repo`.

### Epic

```bash
gh issue create --repo kernloop/kernloop \
  --title "EPIC: Parsimony Invariant + Control-Floor Decision Receipts (ponytail-derived)" \
  --label "epic,kernel,compliance" \
  --body "Port ponytail's ladder + floor + marker into Kernloop as a kernel invariant, typed Decision Receipt (decision_type=parsimony) with NIST 800-53r5/OSCAL mapping, and close the floor-verification gap via blind independent verification. No sixth contract: one loop hook + policy data + receipt extension. See docs/plans/kernloop-parsimony-receipts-plan.md."
```

### Issues

> Dependency order in brackets. Acceptance criteria embedded. All code obeys: files ≤400 lines, functions ≤50 lines, ≥80% coverage, secrets via env only, MIT.

**#1 — Spike: reproduce ponytail benchmark + establish matched agentic baseline** `[blocks: 10]`
_Labels:_ `spike,benchmark`
_AC:_ Written finding documenting ponytail's corrected methodology; one reproduced run; a Kernloop fixture repo with a matched-agentic baseline harness committed.

**#2 — Define Decision Receipt `parsimony` schema (JSON Schema + types)** `[blocks: 3,4,5,6,8]`
_Labels:_ `kernel,schema,compliance`
_AC:_ JSON Schema for the receipt incl. `floor_checks[]`, `deferred`, `verification`, hash-chain fields; type definitions; round-trip serialization test; schema is an extension of the existing receipt, not a new contract.

**#3 — Implement Parsimony Ladder evaluator (pure, deterministic)** `[needs: 2]`
_Labels:_ `kernel`
_AC:_ Pure function, no I/O, ≤50 lines; ladder is policy data; truth-table test covering all 6 rungs + first-match-wins; emits resolving rung into the receipt.

**#4 — Implement Control Floor guard + multi-catalog mapping data** `[needs: 2]`
_Labels:_ `kernel,compliance`
_AC:_ Floor entries typed `{name,catalog,control_ids,applies_when}`; 800-53r5 + 508 + intent entries present; `applies_when` predicate fires only on relevant trust-boundary diffs; non-pass applicable entry forces a `deferred` block with `control_risk`.

**#5 — Wire the single execution-loop hook (`pre_commit`)** `[needs: 3,4]`
_Labels:_ `kernel`
_AC:_ One hook evaluates ladder → runs floor → emits receipt → awaits verification before commit; `verification.status=refuted` fails the iteration; kernel surface change is minimal and contract-stable.

**#6 — Inline marker emitter + `kl debt` harvest** `[needs: 2]`
_Labels:_ `cli,dx`
_AC:_ Emits `kl:parsimony …` markers linked to receipt ULID; `kl debt` harvests structured receipts and lists deferrals with `control_risk`; marker grammar is greppable and stable.

**#7 — Blind independent floor verification path** `[needs: 5]`
_Labels:_ `kernel,verification,compliance`
_AC:_ Verifier runs in isolated overlay, receives diff + floor checklist only (not `rationale`); returns confirmed/refuted; refute path proven by a test.

**#8 — OSCAL projection: receipts → assessment-results** `[needs: 2]`
_Labels:_ `compliance,oscal`
_AC:_ Pure projection; floor checks → observations, refutations/unmitigated deferrals → findings linked to control IDs; output validates against OSCAL schema in CI.

**#9 — Intensity dial bound to per-repo overlay** `[needs: 5]`
_Labels:_ `kernel,overlay`
_AC:_ `off|lite|full|ultra` resolved from overlay; `full` enforces floor+verification; `ultra` blocks all deferrals; default `full`; covered by per-level tests.

**#10 — Benchmark v2 with compliance dimensions + honest writeup** `[needs: 1,5,7,8]`
_Labels:_ `benchmark,compliance`
_AC:_ Matched agentic baseline; metrics incl. floor-violation rate, receipt completeness, OSCAL-validity, deferral/control-risk surface; methodology + numbers published; any inflated figure corrected down in the open (ponytail-style).

**#11 — Threat-taxonomy entry: "parsimony-as-attack" + adversarial test** `[needs: 7]`
_Labels:_ `security,threat-taxonomy`
_AC:_ Versioned taxonomy entry for "agent invokes YAGNI to justify dropping a control"; adversarial test demonstrating the blind verifier refutes and the loop fails.

**#12 — Single-source compact rule + per-harness copies + drift test** `[needs: 2]`
_Labels:_ `docs,multi-harness`
_AC:_ One canonical compact rule; generated copies for Claude/Codex/Gemini/OpenCode; CI drift check fails if copies diverge; kernel-contract doc for the parsimony receipt committed under `docs/`.

**#13 — nexus-agents harness-hosted port (Gate relocates to VCS/CI)** `[needs: 2,4,7,8]` · _repo: `nexus-substrate/nexus-agents`_
_Labels:_ `nexus-agents,compliance,ci`
_AC:_ Prime + Check layers reused unchanged (same compact rule, same floor-check/receipt tools). Because nexus-agents does not own the loop, the Gate is implemented at the seams it controls: git `pre-commit` + `pre-push` hooks, a CI required-check (replay receipts → OSCAL projection + schema validation), and the blind-verifier overlay registered as a **required PR reviewer**. **Explicit AC:** shipping the AGENTS.md rule alone does **not** satisfy this ticket — a deterministic gate that blocks on floor violation / refuted verification / invalid OSCAL must be demonstrated, or the issue stays open.

#### Bulk-create helper

```bash
# after the epic exists, capture its number as $EPIC then:
for t in \
 "Spike: reproduce ponytail benchmark + matched agentic baseline|spike,benchmark" \
 "Define Decision Receipt parsimony schema|kernel,schema,compliance" \
 "Implement Parsimony Ladder evaluator|kernel" \
 "Implement Control Floor guard + multi-catalog mapping|kernel,compliance" \
 "Wire pre_commit execution-loop hook|kernel" \
 "Inline marker emitter + kl debt harvest|cli,dx" \
 "Blind independent floor verification path|kernel,verification,compliance" \
 "OSCAL projection: receipts to assessment-results|compliance,oscal" \
 "Intensity dial bound to per-repo overlay|kernel,overlay" \
 "Benchmark v2 + compliance dimensions|benchmark,compliance" \
 "Threat-taxonomy: parsimony-as-attack + adversarial test|security,threat-taxonomy" \
 "Single-source rule + per-harness copies + drift test|docs,multi-harness" ; do
  title="${t%%|*}"; labels="${t##*|}"
  gh issue create --repo kernloop/kernloop --title "$title" --label "$labels" \
    --body "Part of EPIC #$EPIC. See docs/plans/kernloop-parsimony-receipts-plan.md."
done

# #13 lives in the other repo (Gate relocates to VCS/CI for harness-hosted nexus-agents):
gh issue create --repo nexus-substrate/nexus-agents \
  --title "nexus-agents harness-hosted port: Gate relocates to VCS/CI" \
  --label "nexus-agents,compliance,ci" \
  --body "Prime+Check reused; Gate via pre-commit/pre-push hooks, CI required-check (receipt replay + OSCAL validation), blind-verifier as required PR reviewer. Shipping the AGENTS.md rule alone does NOT satisfy this. See kernloop docs/plans/kernloop-parsimony-receipts-plan.md §2.5a."
```

---

## 5. Sequencing

- **M1 — Schema + ladder (foundation):** #2 → #3, #4. Pure, testable, no kernel-surface risk.
- **M2 — Enforcement:** #5 → #7, #9. The loop hook and the verification gate.
- **M3 — Evidence:** #6, #8, #11. Markers, OSCAL projection, the adversarial proof.
- **M4 — Proof + portability:** #1 (start early, lands here) → #10, #12. Honest numbers and multi-harness drift safety.

Spike #1 should start in parallel with M1 so the baseline exists before M4.

---

## 6. Risks & open questions

- **Soft enforcement is still soft for the _ladder_.** The floor gets verified; the ladder's rung choice does not. Acceptable — a wrong rung is inefficiency, not a control breach. Confirm that's the intended risk boundary.
- **Deliberation overhead.** Ponytail notes some reasoning models spend _more_ tokens chewing the rungs. Measure token cost per harness in #10; the intensity dial is the mitigation.
- **Accessibility ∉ 800-53.** The floor must stay multi-catalog. Don't let the OSCAL projection assume every floor entry maps to a NIST control.
- **`applies_when` precision.** Too broad and the floor fires on irrelevant diffs (noise); too narrow and it misses a boundary (gap). This predicate is the highest-judgment part — give it its own test corpus.
- **Verifier independence.** "Blind" only holds if the verifier overlay truly can't see the rationale. Audit the isolation in #7.
- **Sixth-contract temptation.** Resist until #5/#7 prove the hook is overloaded.

---

## 7. Hand-off

Give Claude Code this doc + the ponytail repo URL and start at **#1** (spike). It can create the epic and issues with the `gh` commands in §4, then work M1. The adversarial test in **#11** is the single most important artifact — it's the evidence that Kernloop closes the gap ponytail leaves open.
