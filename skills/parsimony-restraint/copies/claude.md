# Parsimony restraint rule — Claude copy

> GENERATED from `COMPACT_PARSIMONY_RULE` in `@kernloop/parsimony` by
> `scripts/render-parsimony-rule.mjs`. Do NOT edit by hand — the CI drift
> gate (`parsimony:render -- --check`) fails if this copy diverges from the
> single source. [CLM-0179]

## Parsimony (restraint) rule

Before you add code, climb the RESTRAINT LADDER and stop at the FIRST rung
that holds — prefer reuse / stdlib / a native platform feature / an installed
dependency / one line over writing something new:

```
rung 0 need → skip
rung 1 stdlib → reuse_stdlib
rung 2 native → reuse_native
rung 3 dep → reuse_dep
rung 4 oneLine → one_line
rung 5 minimal → minimal_impl
```

Never invoke "keep it simple" / YAGNI to drop a CONTROL FLOOR guard. When the
change crosses one of these boundaries the guard is NON-WAIVABLE — implement it
(do not claim it is satisfied when the diff does not implement it):

```
input_validation (SI-10) when crossesTrustBoundary
error_recovery (SI-11/CP-10) when risksDataLoss
access_enforcement (AC-3/IA-2/SC-8) when enforcesAccess
accessibility (section-508) when hasUserInterface
audit_logging (AU-2/AU-3/AU-10) when acts
intent (intent) when wasRequested
```

A guard that applies and is unmet is a FIRST-CLASS deferred finding (it names
the control at risk), never a silent omission.

EMIT the greppable `kl:parsimony` marker for each restraint decision so it is
auditable, e.g.:

```
kl:parsimony rung=2 outcome=reuse_native floor=SI-10:pass,AU-2:pass defer=none receipt=<id>
```

The `floor` field lists every guard that applied (control id or name : status),
`defer` is `none` or the debt id, and `receipt` back-links the full receipt on
the hash-chained audit log.
