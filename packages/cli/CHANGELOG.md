# @kernloop/cli

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
