---
'@kernloop/workflows': patch
'@kernloop/cli': patch
---

Fix (#543, CLM-0199): checkpoint the canonical loop's per-child written-file
PATHS so a `--resume` rebuilds the scoped child quality gate's union from
durable state instead of degrading to the whole-workspace scan + sticky taint
(#538 round 4's fail-closed cure for #534/#541).

- `ChildResult` (`packages/workflows/src/state.ts`) gains an optional
  `writtenPaths: readonly string[]` — workspace-relative PATHS ONLY, never
  content (it's on disk in the workspace, not duplicated into the
  checkpoint).
- The engine's `AdvanceOptions.childWrittenPaths` (`steps.ts`) is a new
  pull-seam, mirroring the existing `meteredSpend` seam (#56): called right
  after a child's implement sub-node completes, its return value is persisted
  onto that child's checkpointed `ChildResult.writtenPaths` (`advanceChild`).
  Threaded through `EngineDeps`/`LoopEngine` (`engine-types.ts`, `engine.ts`).
- `packages/cli/src/loop/engine-build.ts` wires the seam to the CLI's live
  (process-local) `writtenByChild` stash, handing back just the paths.
- `packages/cli/src/loop/resume-prime.ts` (new) rebuilds `writtenByChild` on
  resume from the checkpoint's `writtenPaths`, reading each path's content
  back from the (unchanged) workspace on disk — so the child quality gate
  (CLM-0189) and the review/parsimony gates that read the same stash resume
  scoped instead of abstaining/falling back whole-workspace. A child with
  NEITHER a live stash NOR a checkpointed set (a pre-#543 checkpoint, or a
  child whose implement never ran) still degrades to the original fail-closed
  whole-workspace-scan-plus-taint behavior.
- CLM-0189's statement updated: the durable checkpoint path is now primary;
  the sticky whole-workspace taint is the fallback for the no-checkpoint case.
