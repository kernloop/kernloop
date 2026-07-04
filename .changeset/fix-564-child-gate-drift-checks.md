---
'@kernloop/faculty-gates': patch
'@kernloop/cli': patch
---

Fix (#564): the canonical loop's child quality gate now runs the repo's own
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
