---
'@kernloop/kernel': patch
---

Deps (#557, #558): bump `undici` ^7.28.0 → ^8.6.0 and `ipaddr.js` ^1.9.1 →
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
