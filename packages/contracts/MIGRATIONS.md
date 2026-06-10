# Contract migrations

`@kernloop/contracts` is Layer 1 — the **frozen five**: `TaskContract`,
`Brief`, `Verdict`, `Outcome`, `Manifest` (spec §4). "Frozen" means the
contract surface does not drift: there is no sixth contract, and no field is
added, renamed, or removed outside the process below.

## Breaking changes route through human ratification

Per spec §1 (rule 3) and §4, any breaking change to a contract follows the
kernel ratification path:

1. **PR-only.** Changes land via a PR touching `packages/contracts/**`,
   which is a protected path requiring CODEOWNERS review. Never pushed
   directly.
2. **Recorded review + audit event.** The human review is recorded, and the
   ratification appends an event to the audit chain.
3. **Semver-major version bump.** `contractsVersion` (in `src/version.ts`)
   bumps its major version on any breaking change. Additive, backward-
   compatible changes (rare by design) bump minor.
4. **Migration notes here.** Every version bump adds an entry to the log
   below: what changed, why, and how consumers migrate.

## Migration log

| contractsVersion | Date       | Change                            |
| ---------------- | ---------- | --------------------------------- |
| 1.0.0            | 2026-06-09 | Initial frozen five, per spec §4. |
