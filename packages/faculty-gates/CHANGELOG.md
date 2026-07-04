# @kernloop/faculty-gates

## 0.1.8

### Patch Changes

- @kernloop/contracts@0.1.8
- @kernloop/docscan@0.1.8
- @kernloop/kernel@0.1.8

## 0.1.7

### Patch Changes

- Updated dependencies [b6bdd44]
  - @kernloop/kernel@0.1.7
  - @kernloop/contracts@0.1.7
  - @kernloop/docscan@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [154c357]
  - @kernloop/kernel@0.1.6
  - @kernloop/contracts@0.1.6
  - @kernloop/docscan@0.1.6

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

- a53c304: fix(gates): copy every workspace package's node_modules into the sandbox scratch, not just the workspace root — resolves pnpm symlink-farm breakage inside network-none docker (#546). [CLM-0191]
- be1ef02: Preserve relative symlink targets verbatim when populating the gate-sandbox
  scratch (#561); docker-dependent test suites now skip visibly where docker is
  unavailable (#554, test-environment only).

  - `copyWorkspaceSource` (and `copyDir`'s `cpSync` fallback) now pass
    `verbatimSymlinks: true`, so a relative link like `CLAUDE.md -> AGENTS.md`
    arrives in the scratch with its target text unchanged instead of being
    resolved to an absolute host path (which dangled inside the container and
    failed the in-sandbox governance-check). The fallback now matches the
    `cp -a` primary path; links are still copied AS links — target content is
    never read during copy.
  - The five `*.docker.test.ts` suites probe docker at import time and skip
    visibly (`describe.skipIf`) when the binary is absent or the daemon is
    unreachable, instead of throwing `spawnSync docker ENOENT`; hosts with
    docker run them unchanged.

- bdaa79f: Provision the workspace's declared package manager into the gate sandbox offline
  (#548) and carry the tool-output TAIL in failed-check findings (#549).

  - The gate sandbox now copies the declared `packageManager` (pnpm/yarn) from the
    host corepack cache into `<scratch>/.kernloop-pm/` and puts a resolved shim on
    PATH, so turbo can re-invoke per-package scripts under `--network none`. A
    declared version missing from the host cache fails closed with an actionable
    `corepack prepare` message; npm/absent is a no-op.
  - A failed subprocess check's fallback finding now surfaces the tail of combined
    stdout+stderr (where tools print their real error) instead of the boilerplate
    banner head.

- Updated dependencies [30cfb0e]
  - @kernloop/docscan@0.1.5
  - @kernloop/contracts@0.1.5
  - @kernloop/kernel@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies [b9e17f0]
  - @kernloop/kernel@0.1.4
  - @kernloop/contracts@0.1.4
  - @kernloop/docscan@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [d04062f]
  - @kernloop/kernel@0.1.3
  - @kernloop/contracts@0.1.3
  - @kernloop/docscan@0.1.3

## 0.1.2

### Patch Changes

- @kernloop/contracts@0.1.2
- @kernloop/docscan@0.1.2
- @kernloop/kernel@0.1.2

## 0.1.1

### Patch Changes

- @kernloop/contracts@0.1.1
- @kernloop/docscan@0.1.1
- @kernloop/kernel@0.1.1
