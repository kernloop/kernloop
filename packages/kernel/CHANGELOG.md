# @kernloop/kernel

## 0.1.7

### Patch Changes

- b6bdd44: Deps (#557, #558): bump `undici` ^7.28.0 → ^8.6.0 and `ipaddr.js` ^1.9.1 →
  ^2.4.0 — the two runtime majors inside the resolve-time SSRF guard
  ([CLM-0186]) — with adversarial per-class verification instead of
  merge-on-green.

  - Every blocked class re-verified with literal addresses on the new
    versions: loopback, RFC-1918 private, link-local + cloud metadata, CGNAT,
    unique-local, unspecified, multicast (both families), broadcast, reserved,
    teredo, and the embedded-IPv4 tunnels (IPv4-mapped, NAT64 `64:ff9b::/96`,
    6to4 `2002::/16`, deprecated IPv4-compatible `::/96`), plus public-unicast
    negative controls. New literal-IP test cases added for previously
    untested classes (IPv4 multicast, 6to4-embedded metadata, NAT64-embedded
    private, teredo, reserved, and the `::/96` allow side).
  - ipaddr.js 2.4.0 still misreports the deprecated IPv4-compatible `::/96`
    as `unicast` (probed against 1.9.1 and 2.4.0), so the guard's manual
    gap-closure remains load-bearing and is kept unchanged; 2.x newly parses
    IPv4 shorthand (`127.1`) that 1.x failed closed on — both versions block
    it, now via classification rather than parse failure.
  - No range-name or classification change affects the guard; undici 8's
    `Agent`/`connect.lookup`/`fetch` surface typechecks unchanged and the
    standing connect-block regression passes. Guard semantics are exactly
    preserved; CLM-0186 unchanged.
  - Parser-differential pins added for the classic SSRF shorthand spellings
    (octal `0177.0.0.1`, hex `0x7f.0.0.1`, 2-part `10.1`, 3-part `192.168.1`,
    and the public `8.8` admit-direction control): ipaddr.js 2.x classifies
    each identically to inet_aton semantics — blocked where private-embedding,
    no differential found.
  - `@kernloop/kernel` now declares `engines.node >=22.19.0`, matching the
    floor undici 8 raised (from `>=20.18.1`), so consumers on early-22.x get a
    loud install-time engine mismatch instead of a runtime undici rejection.
  - @kernloop/contracts@0.1.7

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
