# @kernloop/kernel

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
  - @kernloop/contracts@0.1.6

## 0.1.5

### Patch Changes

- @kernloop/contracts@0.1.5

## 0.1.4

### Patch Changes

- b9e17f0: feat(api): system/multi-message body + per-endpoint configurable max_tokens (#510)

  The `api` adapter now accepts a caller-supplied chat `messages` array (system /
  user / assistant), sent verbatim, with the existing single-user-message
  assembled from `prompt` as the unchanged fallback. Messages are validated
  fail-closed before the key read and any egress. `max_tokens` is configurable
  per endpoint via the overlay `maxTokens` (default 4096), clamped to a hard cap
  (128k) at parse so config can never inflate the completion ceiling. Prerequisite
  for the endpoint-diverse vote panel (#509). [CLM-0187]
  - @kernloop/contracts@0.1.4

## 0.1.3

### Patch Changes

- d04062f: security(api): resolve-time, IP-pinned SSRF/DNS-rebinding guard for the api adapter (#508). All api-adapter egress now routes through a `safeFetch` whose undici dispatcher validates DNS resolution at connect time (the validating lookup IS the connecting lookup — TOCTOU-safe), allowing only public-unicast addresses and blocking loopback/private/link-local/metadata/CGNAT/multicast/etc., including embedded-IPv4 tunnels (IPv4-mapped, NAT64 64:ff9b::/96, 6to4, IPv4-compatible). IP classification is delegated to the vetted `ipaddr.js`. The prior lexical baseUrl guard ([CLM-0084]) remains as a defense-in-depth pre-check. New runtime deps: `undici` (Node's own fetch impl, for the per-request validating dispatcher) and `ipaddr.js` (IP parsing/classification).
  - @kernloop/contracts@0.1.3

## 0.1.2

### Patch Changes

- @kernloop/contracts@0.1.2

## 0.1.1

### Patch Changes

- @kernloop/contracts@0.1.1
