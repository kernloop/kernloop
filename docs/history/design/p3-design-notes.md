> **Point-in-time design note (superseded).** Preserved for history; the
> work it planned is implemented and claim-backed. See [README.md](../../../README.md).

# P3 Design Notes — review gate · distill · Toolsmith · Observer

Status: design only, written on `phase/p3` while the P2 exit PR (#6) awaits
human ratification. No implementation before that merge. Backlog:
CLM-0047..CLM-0058 (`planned`).

## Scope (spec §11) and exit

Review gate (advisory) + distill + forge/Toolsmith + Observer self-issue
loop. Exit: **a distilled skill and a forged workshop tool both born through
gates.** From P3 exit onward, kernloop work runs through kernloop itself.

## Work order (dependency order)

| Wave | Unit                           | Owns                                                                           | Backlog        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------ | ------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Review gate                    | faculty-gates/src/review/\*\*                                                  | CLM-0047, 0048 | Port v1 n=10 eval set + labeling rubric (quarry item 4) as the calibration seed. Adversarial diff review via injected invoke (vote-gate pattern); per-voter precision computed against labels and written to the fitness ledger (Observer interface — via contracts, not imports). ADVISORY tier until the v1 Epic-E promotion criterion is met (spec §5.3); promotion to enforce is a named human-ratification point.                                                                                                                                                                                          |
| 1    | Observer                       | faculty-observer/\*\*                                                          | CLM-0055, 0056 | Consumes Outcomes/Verdicts (bus subscription wired at composition root). Fitness ledger in overlay SQLite (own tables; memory faculty owns its DB — decide: same file, separate file? lean separate `observer.sqlite`, simpler ownership). Self-issue filing at `suggest`: P3 target tracker = GitHub issues via `gh` subprocess (real, local, no new daemon); self-issues re-enter through `run` with no special path (CLM-0056 test: the issue→loop path is the ordinary path).                                                                                                                               |
| 2    | Distill                        | faculty-toolsmith? NO — distill is memory's procedural-write path + a cli tool | CLM-0049, 0050 | `distill` tool: episodic trace id → SKILL.md proposal (via injected invoke), entering at `suggest`; ratification = human-reviewed PR adding the skill to skills/ (or overlay .kernloop/skills/). Procedural memory write only via this path (CLM-0050: memory faculty gains a guarded procedural store — write API requires a ratification token/provenance).                                                                                                                                                                                                                                                   |
| 2    | Toolsmith/forge                | faculty-toolsmith/\*\*                                                         | CLM-0051..0054 | Birth requirements mechanical: spec must include claim entry + acceptance test + manifest before generation (CLM-0051). Sandbox: Docker profile — **named human-ratification point: the sandbox profile itself** (no network, scratch-dir FS, declared mounts). Detect docker; absent → typed unavailable (never run unsandboxed). workshop/\* under overlay; ≤12 cap with retire-to-forge; ladder suggest→advisory(N clean runs)→enforce(human); decay window (spec §12.2 open item — propose 30 days, ratify in exit PR). Isolation lint already bans cross-package imports; extend a rule for workshop dirs. |
| 3    | Kernel eleven completion + E2E | cli                                                                            | CLM-0057, 0058 | `distill` + `forge` MCP tools land (surface = exactly 11; CLM-0033's "exactly nine in P1" claim text must be revised — claims/ change, flag in exit PR). Exit proof: distill a skill from the committed P2 live-run trace; forge a small real workshop tool (spec candidate: a repo-stats or changelog probe) through the full birth path in the sandbox. Then: run one kernloop maintenance task through kernloop (self-hosting demonstration).                                                                                                                                                                |

## Open design questions (resolve at build, narrowest-first)

1. **Fitness ledger location** — separate `observer.sqlite` per overlay vs
   shared DB file. Leaning separate (single-writer simplicity); spec §3.3
   says "one DB per overlay + one global" — revisit against that text.
2. **Self-issue tracker** — `gh issue create` on the overlay repo at
   `suggest`. Needs auth detection; absent → Observer reports
   unavailable, never silently skips.
3. **Procedural store ratification token** — what artifact proves human
   ratification of a skill? Proposal: the skill file merging through a
   CODEOWNERS-protected path IS the ratification; the store indexes only
   committed skills (no runtime write API at all — strictest reading).
4. **Sandbox profile ratification** — draft the Docker profile as data
   (image, network none, mounts, ulimits) in the exit-PR-ratified overlay
   defaults; forging refuses if the active profile hash ≠ ratified hash.
5. **CLM-0033 revision** — the claim is true today ("exactly nine in P1");
   P3 must supersede it honestly (revise statement + evidence to eleven,
   note the revision in the exit PR — protected path, human-reviewed).

## Ratification points to batch into the P3 exit PR

- Toolsmith sandbox profile (spec-named, §5.6 / seed protocol step 4).
- Workshop decay window default (spec §12.2) — propose 30 days.
- review gate advisory→enforce criterion adoption (Epic-E port) — adopt the
  criterion only; the promotion itself needs sustained evidence later.
- CLM-0033 statement revision (nine → eleven).
