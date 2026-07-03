---
'@kernloop/faculty-gates': patch
---

Provision the workspace's declared package manager into the gate sandbox offline
(#548) and carry the tool-output TAIL in failed-check findings (#549).

- The gate sandbox now copies the declared `packageManager` (pnpm/yarn) from the
  host corepack cache into `<scratch>/.kernloop-pm/` and puts a resolved shim on
  PATH, so turbo can re-invoke per-package scripts under `--network none`. A
  declared version missing from the host cache fails closed with an actionable
  `corepack prepare` message; npm/absent is a no-op.
- A failed subprocess check's fallback finding now surfaces the tail of combined
  stdout+stderr (where tools print their real error) instead of the boilerplate
  banner head.
