# extend-preflight-sync-gate

Add a CI gate to the local `preflight` chain and extend the preflight-sync drift check so divergence between a `.github/workflows/*.yml` file and the preflight chain fails the check.

## When to use

Use when resolving an issue that asks you to close a coverage gap between a GitHub Actions workflow gate and the locally-reproducible `pnpm preflight` chain — i.e. a gate exists in CI (e.g. `pnpm audit --audit-level=high` in `security.yml`) but is not mirrored locally, and/or the sync-check script (`scripts/check-preflight-sync.mjs`) does not scan that workflow for drift. Also applies when the accompanying claim (e.g. CLM-0180) must be reworded to honestly name the widened file set. Keep out-of-scope work (e.g. composite-action resolution) recorded on the issue, not implemented, unless its trigger has fired.

## Steps

1. Read the tracking issue and the current `preflight` script in `package.json` to see how the existing gates are chained (fail-fast, `&&`-joined, in order).
2. Add the missing gate command (e.g. `pnpm audit --audit-level=high`) into the `preflight` chain in `package.json`, matching the existing chaining style and fail-fast semantics.
3. Open `scripts/check-preflight-sync.mjs`. Extend it to ALSO scan the target workflow (`.github/workflows/security.yml`) — parse single-line `run:` steps for locally-runnable `pnpm` gates — so drift between that workflow and the preflight chain fails the check. Leave the existing `ci.yml` scanning behavior unchanged.
4. If the script exposes its scan logic as an exported function, add tests in `scripts/__tests__/` covering the new `security.yml` scan path.
5. Update the claim statement wording in `claims/registry/CLM-0180.yaml` to honestly name the widened file set (ci.yml + security.yml), keeping the existing evidence refs valid/resolving.
6. Verify definition of done: run `node scripts/check-preflight-sync.mjs` and confirm it exits 0; confirm the new preflight step is present; run the test suite and confirm the new tests plus all existing tests pass.
7. Keep out-of-scope items (e.g. composite-action resolution) on the issue only — do not implement them unless their recorded trigger has fired.
