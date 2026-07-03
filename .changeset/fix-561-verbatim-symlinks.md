---
'@kernloop/faculty-gates': patch
---

Preserve relative symlink targets verbatim when populating the gate-sandbox
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
