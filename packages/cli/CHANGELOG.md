# @kernloop/cli

## 0.1.9

### Patch Changes

- 8401393: Fix (#564): the canonical loop's child quality gate now runs the repo's own
  derived-artifact drift checks — `render-claims --check`, `docs:render --check`,
  and `stats:check` — CONDITIONED on the child having written one of that
  render's inputs, closing the #562/DF1 rescue gap (a loop-authored claim edit
  shipped a stale `docs/CLAIMS.md` past its own green gate, red on CI after merge).

  - `driftChecksFor(writtenFiles)` (`packages/faculty-gates/src/checks.ts`)
    maps a child's written paths to the render `--check` subprocess checks whose
    INPUTS those paths are: any `claims/**` write → the claims render check; any
    gated-package `packages/<pkg>/src/**` write → docs:render; any `stats:check`
    const/watched-prose/registry-or-grammar-count input → stats. A child that
    wrote none of these gets none of the checks (zero added cost). These are
    whole-repo `--check` runs, but the child gate runs over a freshly-cloned
    green sandbox workspace (#236), so a failure is provably the child's own
    un-regenerated render, never inherited debt.
  - `composeGateChecks` (`packages/cli/src/gate-checks-compose.ts`, extracted
    from `executors.ts`) appends `driftChecksFor` only when `writtenFiles` is
    present (the child gate). The standalone `gate quality` path (no
    `writtenFiles`) is byte-identical to before.
  - The classifier's package/stats-input mirrors are held in LOCKSTEP with
    their real sources by set-equality tests: `DOCS_RENDER_GATED_PACKAGES` vs
    `scripts/docs-coverage.mjs`'s `GATED_PACKAGES`, and the stats inputs vs a
    new `STATS_INPUTS` export on `scripts/stats.mjs` (derived from the same
    const/dir/watched specs `deriveStats` reads) — so a new gated package or
    stats input can never silently escape the child gate's drift check.

- Updated dependencies [8401393]
  - @kernloop/faculty-gates@0.1.9
  - @kernloop/contracts@0.1.9
  - @kernloop/docscan@0.1.9
  - @kernloop/faculty-compiler@0.1.9
  - @kernloop/faculty-memory@0.1.9
  - @kernloop/faculty-models@0.1.9
  - @kernloop/faculty-observer@0.1.9
  - @kernloop/faculty-scrum@0.1.9
  - @kernloop/faculty-toolsmith@0.1.9
  - @kernloop/faculty-workforce@0.1.9
  - @kernloop/kernel@0.1.9
  - @kernloop/parsimony@0.1.9
  - @kernloop/tracker@0.1.9
  - @kernloop/workflows@0.1.9

## 0.1.8

### Patch Changes

- 596bfb7: Fix (#544): the review gate no longer loses a reviewer's whole ballot to one
  decorative unknown key (`level`, `findings_note` — observed live 5 times in a
  row), and it now surfaces input truncation as a first-class Verdict finding
  instead of prose-only.

  - `ReviewEmissionSchema` (`packages/cli/src/loop/seams.ts`) STRIPS unknown
    top-level keys from a reviewer's raw report instead of rejecting the whole
    emission (`z.strictObject` → `z.object`, zod v4's default strip mode) —
    `findings`/`summary` stay strictly validated, so a missing or malformed
    required field still fails loud. Per-finding shape stays strict (no
    evidence yet that reviewers decorate individual findings).
  - `parseEmission` (`packages/cli/src/loop/invoke.ts`) now records any
    stripped top-level keys via the existing violation sink
    (`<overlay>/checkpoints/<runId>-<node>-dropped-keys.json`) — tolerating
    decoration is not the same as hiding that part of the model's output was
    ignored.
  - `reviewTruncationFinding`/`withReviewTruncationFinding` (`seams.ts`) surface
    an `info`-severity Verdict finding naming what was truncated and by how
    many characters when the review gate's diff/context clamp (#288) cut the
    reviewer's input, wired into both review-gate call sites (`tools/gate.ts`,
    `loop/executors.ts`).
  - @kernloop/contracts@0.1.8
  - @kernloop/docscan@0.1.8
  - @kernloop/faculty-compiler@0.1.8
  - @kernloop/faculty-gates@0.1.8
  - @kernloop/faculty-memory@0.1.8
  - @kernloop/faculty-models@0.1.8
  - @kernloop/faculty-observer@0.1.8
  - @kernloop/faculty-scrum@0.1.8
  - @kernloop/faculty-toolsmith@0.1.8
  - @kernloop/faculty-workforce@0.1.8
  - @kernloop/kernel@0.1.8
  - @kernloop/parsimony@0.1.8
  - @kernloop/tracker@0.1.8
  - @kernloop/workflows@0.1.8

## 0.1.7

### Patch Changes

- Updated dependencies [b6bdd44]
  - @kernloop/kernel@0.1.7
  - @kernloop/faculty-gates@0.1.7
  - @kernloop/faculty-toolsmith@0.1.7
  - @kernloop/contracts@0.1.7
  - @kernloop/docscan@0.1.7
  - @kernloop/faculty-compiler@0.1.7
  - @kernloop/faculty-memory@0.1.7
  - @kernloop/faculty-models@0.1.7
  - @kernloop/faculty-observer@0.1.7
  - @kernloop/faculty-scrum@0.1.7
  - @kernloop/faculty-workforce@0.1.7
  - @kernloop/parsimony@0.1.7
  - @kernloop/tracker@0.1.7
  - @kernloop/workflows@0.1.7

## 0.1.6

### Patch Changes

- 154c357: Security (#570): contain the agentic coder's cwd and its process-tree lifetime.

  - The canonical loop's default per-node seam now pins every CLI-adapter
    subprocess's cwd to the run's declared `workspaceDir` — the SAME directory
    the agentic-cwd containment validated (one binding from check to spawn) —
    so a coder that executes commands resolves relative paths in the throwaway
    workspace, never in the orchestrating repo. Diverse-voter seams are pinned
    too; standalone verbs (gate/distill/forge) declare no workspace and keep
    the operator's cwd, unchanged.
  - A dying `kernloop run` can no longer orphan its coder: each subprocess
    child leads its own POSIX process group, live groups are registered, and a
    parent-death sweep SIGTERMs every group (`kill(-pid)`, grandchildren
    included) on process exit and on fatal SIGTERM/SIGHUP. SIGINT is not swept:
    the first Ctrl-C stays the cooperative abort that awaits the in-flight
    child; force-quit exits through `process.exit`, which fires the sweep.

- Updated dependencies [154c357]
  - @kernloop/kernel@0.1.6
  - @kernloop/faculty-gates@0.1.6
  - @kernloop/faculty-toolsmith@0.1.6
  - @kernloop/contracts@0.1.6
  - @kernloop/docscan@0.1.6
  - @kernloop/faculty-compiler@0.1.6
  - @kernloop/faculty-memory@0.1.6
  - @kernloop/faculty-models@0.1.6
  - @kernloop/faculty-observer@0.1.6
  - @kernloop/faculty-scrum@0.1.6
  - @kernloop/faculty-workforce@0.1.6
  - @kernloop/parsimony@0.1.6
  - @kernloop/tracker@0.1.6
  - @kernloop/workflows@0.1.6

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

- Updated dependencies [30cfb0e]
- Updated dependencies [a53c304]
- Updated dependencies [be1ef02]
- Updated dependencies [bdaa79f]
  - @kernloop/docscan@0.1.5
  - @kernloop/faculty-gates@0.1.5
  - @kernloop/workflows@0.1.5
  - @kernloop/contracts@0.1.5
  - @kernloop/faculty-compiler@0.1.5
  - @kernloop/faculty-memory@0.1.5
  - @kernloop/faculty-models@0.1.5
  - @kernloop/faculty-observer@0.1.5
  - @kernloop/faculty-scrum@0.1.5
  - @kernloop/faculty-toolsmith@0.1.5
  - @kernloop/faculty-workforce@0.1.5
  - @kernloop/kernel@0.1.5
  - @kernloop/parsimony@0.1.5
  - @kernloop/tracker@0.1.5

## 0.1.4

### Patch Changes

- 17f5a15: docs(endpoints): guide for the three custom-endpoint paths + template maxTokens (#511)

  Adds `docs/ENDPOINTS.md` documenting the three verified ways to route kernloop
  work to a custom OpenAI-compatible endpoint (api adapter / opencode+adapterModels
  / MCP sampling) with copy-paste overlays and honest per-path limitations. Updates
  the `kernloop init` overlay template: documents the new per-endpoint `maxTokens`
  and corrects the `baseUrl` comment to reflect the resolve-time SSRF guard
  (CLM-0186), which now blocks egress to private/loopback/metadata addresses.

- 93b455c: feat(vote): endpoint-diverse per-model vote panel, honest about the single-oracle gap (#509)

  For an endpoint-only ratification run whose endpoint serves ≥2 chat-capable
  models (from `models sync`'s `/v1/models`), kernloop now convenes a panel-7
  across those distinct models instead of one model role-playing N personas. The
  `/v1/models` set is filtered to chat models (embeddings/moderation/audio/image/
  rerank dropped and audited). It is framed honestly as model-NAME diversity
  within ONE oracle: two visible Verdict findings state it is NOT cross-provider
  independence, does not close the single-oracle gap [CLM-0164], and that neither
  high nor low inter-voter disagreement establishes independence; the measured
  divergence counts only voters that actually balloted. A distinct audit records
  the posture, and the #348 parity gate excludes this signal from the independence
  window. Cross-provider voting remains the real oracle-diversity path. [CLM-0188]

- b9e17f0: feat(api): system/multi-message body + per-endpoint configurable max_tokens (#510)

  The `api` adapter now accepts a caller-supplied chat `messages` array (system /
  user / assistant), sent verbatim, with the existing single-user-message
  assembled from `prompt` as the unchanged fallback. Messages are validated
  fail-closed before the key read and any egress. `max_tokens` is configurable
  per endpoint via the overlay `maxTokens` (default 4096), clamped to a hard cap
  (128k) at parse so config can never inflate the completion ceiling. Prerequisite
  for the endpoint-diverse vote panel (#509). [CLM-0187]

- Updated dependencies [b9e17f0]
  - @kernloop/kernel@0.1.4
  - @kernloop/faculty-gates@0.1.4
  - @kernloop/faculty-toolsmith@0.1.4
  - @kernloop/contracts@0.1.4
  - @kernloop/docscan@0.1.4
  - @kernloop/faculty-compiler@0.1.4
  - @kernloop/faculty-memory@0.1.4
  - @kernloop/faculty-models@0.1.4
  - @kernloop/faculty-observer@0.1.4
  - @kernloop/faculty-scrum@0.1.4
  - @kernloop/faculty-workforce@0.1.4
  - @kernloop/parsimony@0.1.4
  - @kernloop/tracker@0.1.4
  - @kernloop/workflows@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [d04062f]
  - @kernloop/kernel@0.1.3
  - @kernloop/faculty-gates@0.1.3
  - @kernloop/faculty-toolsmith@0.1.3
  - @kernloop/contracts@0.1.3
  - @kernloop/docscan@0.1.3
  - @kernloop/faculty-compiler@0.1.3
  - @kernloop/faculty-memory@0.1.3
  - @kernloop/faculty-models@0.1.3
  - @kernloop/faculty-observer@0.1.3
  - @kernloop/faculty-scrum@0.1.3
  - @kernloop/faculty-workforce@0.1.3
  - @kernloop/parsimony@0.1.3
  - @kernloop/tracker@0.1.3
  - @kernloop/workflows@0.1.3

## 0.1.2

### Patch Changes

- ba2e306: fix(cli): the CLI now runs when launched through the npm bin symlink — `npx @kernloop/cli`, a global `npm i -g @kernloop/cli` install, and `node_modules/.bin/kernloop` (#502). The process-entry guard realpath-resolves `argv[1]` so the bin shim (`.bin/kernloop` → `dist/cli.js`) is recognized; previously it compared the symlink path and `main()` silently never ran, so the published CLI produced no output via every documented install path.
  - @kernloop/contracts@0.1.2
  - @kernloop/docscan@0.1.2
  - @kernloop/faculty-compiler@0.1.2
  - @kernloop/faculty-gates@0.1.2
  - @kernloop/faculty-memory@0.1.2
  - @kernloop/faculty-models@0.1.2
  - @kernloop/faculty-observer@0.1.2
  - @kernloop/faculty-scrum@0.1.2
  - @kernloop/faculty-toolsmith@0.1.2
  - @kernloop/faculty-workforce@0.1.2
  - @kernloop/kernel@0.1.2
  - @kernloop/parsimony@0.1.2
  - @kernloop/tracker@0.1.2
  - @kernloop/workflows@0.1.2

## 0.1.1

### Patch Changes

- f1187a3: Exercise the npm OIDC release pipeline end-to-end (#495): first tokenless release with provenance. All 15 `@kernloop/*` packages bump in lockstep via the `fixed` group.
  - @kernloop/contracts@0.1.1
  - @kernloop/docscan@0.1.1
  - @kernloop/faculty-compiler@0.1.1
  - @kernloop/faculty-gates@0.1.1
  - @kernloop/faculty-memory@0.1.1
  - @kernloop/faculty-models@0.1.1
  - @kernloop/faculty-observer@0.1.1
  - @kernloop/faculty-scrum@0.1.1
  - @kernloop/faculty-toolsmith@0.1.1
  - @kernloop/faculty-workforce@0.1.1
  - @kernloop/kernel@0.1.1
  - @kernloop/parsimony@0.1.1
  - @kernloop/tracker@0.1.1
  - @kernloop/workflows@0.1.1
