---
'@kernloop/kernel': patch
---

security(api): resolve-time, IP-pinned SSRF/DNS-rebinding guard for the api adapter (#508). All api-adapter egress now routes through a `safeFetch` whose undici dispatcher validates DNS resolution at connect time (the validating lookup IS the connecting lookup — TOCTOU-safe), allowing only public-unicast addresses and blocking loopback/private/link-local/metadata/CGNAT/multicast/etc., including embedded-IPv4 tunnels (IPv4-mapped, NAT64 64:ff9b::/96, 6to4, IPv4-compatible). IP classification is delegated to the vetted `ipaddr.js`. The prior lexical baseUrl guard ([CLM-0084]) remains as a defense-in-depth pre-check. New runtime deps: `undici` (Node's own fetch impl, for the per-request validating dispatcher) and `ipaddr.js` (IP parsing/classification).
