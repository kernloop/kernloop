# P2 Design Notes — vote gate · workforce · canonical loop · overlay

Status: design only. Written on `phase/p2` while the P1 exit PR awaits human
ratification; per the phase protocol, no implementation that depends on
unratified work begins before that merge. The P2 backlog is
CLM-0037..CLM-0046 (`claims/registry/`, status `planned`).

## Scope (spec §11) and exit

Vote gate + workforce + canonical loop + overlay. Exit: full loop on a real
feature in a real repo, checkpoint/resume proven.

## Work order (dependency order, fan-out candidates)

| Wave | Unit                  | Owns                                   | Backlog        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | --------------------- | -------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Vote gate             | packages/faculty-gates/src/vote/\*\*   | CLM-0037..0039 | Port v1 voter role prompts + strategies-in-use (quarry item 3). Voters call models via kernel adapters — but faculties cannot import kernel, so voter invocation arrives as an injected `invoke` function (contracts-shaped), wired by the composition root. One shared Brief per panel (§8.3). Strategy = data; 3 voters default, 7 at ratification (§5.3).                                                                                                   |
| 1    | Workforce             | packages/faculty-workforce/\*\*        | CLM-0040, 0041 | Templates as data → Manifest instances (registry pattern from P1). PM decomposition is generative → PM acts through an injected adapter invoke; budget-sum invariant is mechanical and unit-testable without models. New templates enter at `suggest` (§5.4).                                                                                                                                                                                                  |
| 1    | Overlay               | packages/cli (extend) + overlay schema | CLM-0045       | overlay.yaml grows: gateThresholds, K, node overrides; zod schema; `doctor` validates; precedence = overlay > loop defaults, tested.                                                                                                                                                                                                                                                                                                                           |
| 2    | Canonical loop        | packages/workflows/\*\*                | CLM-0042..0044 | Graph as data (§6): Frame→Research→Plan→VOTE→(iterate≤K)→PM Decompose→fan-out children (implement→quality→[review P3])→Integrate→Retrospect. Engine: node executor map injected by composition root; every edge zod-validates its contract; per-node checkpoint = persisted node-state row (episodic store or a dedicated table — decide at build; quarry item 6 has v1's checkpoint/resume machinery). Kill/resume test is the load-bearing proof (CLM-0044). |
| 3    | E2E on a real feature | cli wiring + test                      | CLM-0046       | Candidate feature: a small, real change to kernloop itself driven through the loop (self-hosting rehearsal short of P3). Needs real model calls through adapters → budget ceilings from overlay; human plan-ratification can be satisfied by the K-escalation path in a controlled run.                                                                                                                                                                        |

## Open design questions (to resolve at build time, narrowest-first)

1. **Voter model invocation across the isolation boundary.** Faculties cannot
   import kernel adapters. P1 precedent: compiler takes inputs, gate takes
   commands. Vote gate will take `invokeVoter: (template, brief) →
Promise<{vote, reasoning, cost}>` as a constructor dep; the cli composition
   root binds it to `invokeAdapter`. Keeps the faculty model-free in
   substance while voters remain real.
2. **Where checkpoints live.** Options: episodic store (reuse, but traces are
   Outcome-shaped) vs. a workflows-owned SQLite table in the same overlay DB
   file (one file per overlay holds, §3.3). Leaning: separate table via a
   small storage interface injected by the composition root, so workflows
   stays kernel-free.
3. **K-escalation surface.** "Escalate to human" in a CLI world = the run
   halts with status `escalated`, prints the findings, and `kernloop run
--resume <id>` continues after the human edits the plan/overlay. No
   notification machinery in P2.
4. **Spec §12.2 open item** (K default, decay window): K=3 default adopted
   per §6; workshop decay window is P3 scope.
5. **7-voter plan ratification cost** (§8.6): plan-vote panels only; gate
   thresholds in overlay.yaml so a repo can lower to 3 for cheap runs —
   but the default stays spec-true.

## Ratification points to batch into the P2 exit PR

- Vote gate tier (`advisory` entry expected; any enforce promotion needs
  human ratification + evidence per §3.2).
- Which v1 consensus strategies count as "in use" (spec §12.3) — propose:
  simple_majority, supermajority, unanimous; others stay in the quarry.
- PM template's authority to compose bespoke specialists at `enforce`
  (§5.4) — defer the enforce grant to P3 evidence; P2 PM runs at `suggest`.
