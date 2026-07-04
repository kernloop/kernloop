# @kernloop/workflows

## 0.1.10

### Patch Changes

- 68b9ff4: Fix (#543, CLM-0199): checkpoint the canonical loop's per-child written-file
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
  - @kernloop/contracts@0.1.10

## 0.1.9

### Patch Changes

- @kernloop/contracts@0.1.9

## 0.1.8

### Patch Changes

- @kernloop/contracts@0.1.8

## 0.1.7

### Patch Changes

- @kernloop/contracts@0.1.7

## 0.1.6

### Patch Changes

- @kernloop/contracts@0.1.6

## 0.1.5

### Patch Changes

- 30cfb0e: fix(loop): make the child quality gate convergeable (#534, #535, #541). The
  canonical loop's child quality gate now scopes its in-process whole-workspace
  scans — the doc-comment check AND the security smell check — to the child's OWN
  written files (the union across its iterations, mirroring diff-coverage), so
  pre-existing repo-wide findings can no longer fail every child; the standalone
  whole-workspace `gate quality` semantics are unchanged when no scope is passed,
  and a resume with a lost written-files stash fails CLOSED to the whole-workspace
  scans AND taints that child whole-workspace for the remainder of the run (the
  durable path-checkpoint fix is #543). The stash union also widens what the
  review/parsimony consumers see: all iterations' emissions, last content wins per
  path — matching what is actually on disk. [CLM-0189]
  And the child iteration back-edge deduplicates findings on append at all three
  fold sites (reiterate, escalate, hint-fold), so a gate re-emitting the same
  still-unfixed findings no longer inflates the accumulated set or the audited
  findingCount (the June-13 113→221→329 stack); genuinely new findings still
  accumulate as coder hints. [CLM-0190]

  BEHAVIOR CHANGE for external callers of `executeQualityGate` (cli): a
  `writtenFiles` request no longer implicitly adds the diff-coverage check — it
  now scopes the doc-comment check instead, and diff-coverage requires the new
  explicit `diffCoverage: true` request flag (the overlay's
  `gates.quality.diffCoverage` knob, unchanged for `kernloop run` users). Callers
  that passed `writtenFiles` expecting diff-coverage must add the flag. And a
  caller passing `writtenFiles: []` as a legacy neutral default now suppresses
  BOTH in-process scans including the security smell check (an empty scope means
  the child owns no content) — pass no `writtenFiles` at all to keep the
  whole-workspace scans.
  - @kernloop/contracts@0.1.5

## 0.1.4

### Patch Changes

- @kernloop/contracts@0.1.4

## 0.1.3

### Patch Changes

- @kernloop/contracts@0.1.3

## 0.1.2

### Patch Changes

- @kernloop/contracts@0.1.2

## 0.1.1

### Patch Changes

- @kernloop/contracts@0.1.1
