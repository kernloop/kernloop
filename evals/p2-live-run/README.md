# P2 live-run evidence (CLM-0046)

A real, model-driven canonical-loop run executed 2026-06-10 against a real
git repository (a small TypeScript package), using the `claude` CLI adapter:

```
kernloop run --goal "add a subtract(a, b) function to src/index.ts with a
  test, mirroring the existing add function" \
  --capability workflow.canonical --workspace <repo> --adapter claude
```

Result: Outcome `success`; two children, both `implement success; quality
pass` (real tsc + node --test in the workspace); plan ratified by a live
3-voter panel; cost metered at 36,875 tokens / $1.76; the trace was flagged
as a distill candidate.

- `audit.jsonl` — the overlay's full hash-chained audit log, including two
  earlier honest-failure runs (a coder output-contract violation and a
  fixture defect) that drove the loop-hardening commit. `kernloop audit
--op verify` reports `{ok: true, length: 66}` over this exact file; any
  byte edit fails verification.
- `checkpoints.jsonl` — the successful run's per-node checkpoint stream
  (frame → research → plan → vote → decompose → 2×(implement → quality) →
  integrate → retrospect).
