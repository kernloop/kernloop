# PORT-NOTES — v1 graph checkpoint/resume → @kernloop/workflows

Quarry (read-only, spec §10 item 6):
`nexus-agents/packages/nexus-agents/src/orchestration/graph/` —
`graph-executor.ts`, `checkpoint-types.ts`, `checkpoint-store.ts`, and their
test suites (plus `graph-executor-hitl.test.ts` for pause/resume cases).
Reimplemented against kernloop contracts; no v1 code imported or copied.

## What ported

- **Storage as an interface, store injected.** v1's `ICheckpointStore`
  (save/load/latest/list) becomes kernloop's three-method `CheckpointStore`
  (save/latest/list — append-only semantics, no delete surface the engine
  never calls). In-memory impl ported; a JSONL file impl is new here so the
  composition root has a durable binding on day one (p2 design notes, open
  question 2).
- **Checkpoint after every completion.** v1 checkpointed per super-step;
  kernloop checkpoints per NODE completion (`{runId, seq, node, iteration,
state}`), including each fan-out child sub-node, so a kill between two
  children resumes between them.
- **Resume without re-execution.** v1's "replays a prior successful node
  instead of re-executing it" test idea becomes the call-count assertions in
  `resume.test.ts`: kill mid-run → resume → completes, with completed nodes
  invoked exactly zero times on the resumed engine.
- **Abort handling.** v1's "respects abort signal" case ported: an
  `AbortError` throw or a fired injected `AbortSignal` halts mid-node, last
  checkpoint intact, run resumable.
- **HITL pause/resume, reshaped.** v1 paused via node-returned `Interrupt`
  envelopes with resume-value plumbing. Kernloop's only human pause is the
  K-escalation (spec §6): the run halts as `escalated` with its findings,
  the checkpoint parks the cursor at plan, and `resume(runId)` continues
  from plan after the human edits — no interrupt envelope machinery.

## Deliberate deltas (kernloop constitution over v1 behavior)

- **Checkpoint write failure fails the run.** v1 "continues execution when
  checkpoint store fails". Here a rejected save is a typed
  `checkpoint_failed` run failure: a run that silently lost its checkpoints
  would let `resume` lie about what re-runs (prime directive).
- **Zero-trust resume.** v1 trusted deserialized checkpoints. Here the
  state is zod-parsed on resume (`corrupt_checkpoint` typed error) and JSONL
  reads skip corrupt lines — a torn tail line is the expected kill-mid-write
  artifact; the last COMPLETE checkpoint is the resume point. Skips are
  counted (`corruptLines`), never silently repaired.
- **No eviction bounds.** v1's in-memory store evicted oldest checkpoints
  (50/run, 100 runs). Evicting a checkpoint silently deletes resumability;
  kernloop keeps every record and leaves retention to the storage owner.
- **No failure-classification / selective-retry, no conditional-edge
  router, no reducers, no event streaming.** The canonical loop is one
  fixed graph (spec §6); generic-graph machinery stays in the quarry until
  a claim pulls it (second-system restraint, spec §1).
- **Fan-out is sequential.** v1 ran parallel nodes per super-step. Here
  children run sequentially in children order: deterministic trace,
  unambiguous checkpoint cursor, no budget races. Concurrency returns via a
  claim if evidence demands it.
- **Edge-contract validation is new.** v1 validated graph STRUCTURE
  (`graph-types-contract.test.ts`); kernloop validates every node's
  emission against the frozen-five schema its edge declares [CLM-0042] —
  v1 had no contract layer to validate against.
