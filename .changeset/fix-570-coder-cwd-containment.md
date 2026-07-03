---
'@kernloop/kernel': patch
'@kernloop/cli': patch
---

Security (#570): contain the agentic coder's cwd and its process-tree lifetime.

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
