import { describe, it, expect } from 'vitest';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { isDisallowedAddress, makeSafeLookup, type ResolveAll } from './api-net.js';

// #508: resolve-time, IP-pinned SSRF guard. These pin the address classifier and
// the validating connect-lookup — the lookup that VALIDATES is the one the socket
// connects through, so a non-local host that RESOLVES to a private/metadata
// address is blocked at connect with no TOCTOU window (the gap both vote panels'
// contrarians flagged). The DNS resolver is injected so every case is deterministic.

describe('isDisallowedAddress — every internal range is refused', () => {
  it.each([
    ['127.0.0.1', 4],
    ['127.255.255.255', 4],
    ['10.0.0.1', 4],
    ['172.16.0.1', 4],
    ['172.31.255.255', 4],
    ['192.168.1.1', 4],
    ['169.254.169.254', 4], // cloud metadata
    ['100.64.0.1', 4], // CGNAT
    ['0.0.0.0', 4],
    ['::1', 6],
    ['fc00::1', 6],
    ['fd12:3456::1', 6],
    ['fe80::1', 6],
    ['::', 6],
    ['::ffff:127.0.0.1', 6], // IPv4-mapped loopback (dotted)
    ['::ffff:169.254.169.254', 6], // IPv4-mapped metadata
    ['::ffff:7f00:1', 6], // IPv4-mapped loopback (HEX form — the bypass)
    ['::ffff:a9fe:a9fe', 6], // IPv4-mapped 169.254.169.254 (hex metadata)
    ['0:0:0:0:0:ffff:7f00:1', 6], // IPv4-mapped loopback (UNCOMPRESSED — review finding 2)
    ['2002:7f00:0001::', 6], // 6to4 of 127.0.0.1
    ['64:ff9b::a9fe:a9fe', 6], // NAT64 of 169.254.169.254 metadata (review finding 1 — HIGH)
    ['64:ff9b::7f00:1', 6], // NAT64 of 127.0.0.1
    ['::7f00:1', 6], // IPv4-compatible loopback (review finding 3)
    ['::a9fe:a9fe', 6], // IPv4-compatible metadata (security-panel example)
    ['64:ff9b::169.254.169.254', 6], // NAT64 metadata, dotted form
    ['not-an-ip', 4], // unparseable → fail closed
    ['gg::1', 6], // unparseable IPv6 → fail closed
    ['', 4], // empty → fail closed
    ['255.255.255.255', 4], // broadcast (ipaddr non-unicast) — defense-in-depth
    ['ff02::1', 6], // multicast — non-unicast
  ])('disallows %s (family %i)', (addr) => {
    expect(isDisallowedAddress(addr as string)).toBe(true);
  });

  it.each([
    ['8.8.8.8', 4],
    ['104.20.23.154', 4],
    ['172.15.0.1', 4], // just below the 172.16/12 private block
    ['172.32.0.1', 4], // just above it
    ['1.1.1.1', 4],
    ['2606:4700:10::6814:179a', 6],
    ['::ffff:8.8.8.8', 6], // IPv4-mapped public (dotted)
    ['::ffff:0808:0808', 6], // IPv4-mapped 8.8.8.8 (hex) — public
    ['2002:0808:0808::', 6], // 6to4 of 8.8.8.8 — public
    ['64:ff9b::0808:0808', 6], // NAT64 of 8.8.8.8 — public destination, allowed
  ])('allows public %s (family %i)', (addr) => {
    expect(isDisallowedAddress(addr as string)).toBe(false);
  });
});

/** Drive the callback-style lookup as a promise for assertions. */
function runLookup(
  resolveAll: ResolveAll,
  hostname: string,
  all = true,
): Promise<{ err: Error | null; addresses?: string | LookupAddress[] }> {
  const lookup = makeSafeLookup(resolveAll);
  return new Promise((resolve) => {
    lookup(hostname, { all }, (err, addresses) => resolve({ err, addresses }));
  });
}

const resolvesTo =
  (...addrs: LookupAddress[]): ResolveAll =>
  async () =>
    addrs;

describe('makeSafeLookup — resolve-time SSRF/DNS-rebinding block (TOCTOU-safe)', () => {
  it('allows a non-local host that resolves to a public address', async () => {
    const r = await runLookup(resolvesTo({ address: '8.8.8.8', family: 4 }), 'api.example.com');
    expect(r.err).toBeNull();
    expect(r.addresses).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });

  it('BLOCKS a non-local host that resolves to a loopback address (the rebinding attack)', async () => {
    const r = await runLookup(resolvesTo({ address: '127.0.0.1', family: 4 }), 'rebind.evil.com');
    expect(r.err).toBeInstanceOf(Error);
    expect(r.err?.message).toContain('blocked egress');
    expect(r.err?.message).toContain('127.0.0.1');
  });

  it('BLOCKS a non-local host that resolves to the cloud-metadata address', async () => {
    const r = await runLookup(
      resolvesTo({ address: '169.254.169.254', family: 4 }),
      'metadata.evil.com',
    );
    expect(r.err).toBeInstanceOf(Error);
  });

  it('BLOCKS reject-if-ANY: a host resolving to a mix of public AND private', async () => {
    const r = await runLookup(
      resolvesTo({ address: '93.184.216.34', family: 4 }, { address: '10.1.2.3', family: 4 }),
      'mixed.evil.com',
    );
    expect(r.err).toBeInstanceOf(Error);
    expect(r.err?.message).toContain('10.1.2.3');
  });

  it('ALLOWS a lexically-local host to resolve to loopback (the http escape hatch)', async () => {
    const r = await runLookup(resolvesTo({ address: '127.0.0.1', family: 4 }), 'localhost');
    expect(r.err).toBeNull();
  });

  it('ALLOWS a *.localhost host to resolve to loopback', async () => {
    const r = await runLookup(resolvesTo({ address: '::1', family: 6 }), 'svc.localhost');
    expect(r.err).toBeNull();
  });

  it('errors when the host resolves to no addresses', async () => {
    const r = await runLookup(resolvesTo(), 'empty.example.com');
    expect(r.err).toBeInstanceOf(Error);
    expect(r.err?.message).toContain('no addresses');
  });

  it('propagates a DNS resolution error', async () => {
    const failing: ResolveAll = async () => {
      throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    const r = await runLookup(failing, 'nope.example.com');
    expect(r.err?.message).toContain('ENOTFOUND');
  });

  it('returns the single (address, family) form when options.all is false', async () => {
    const lookup = makeSafeLookup(resolvesTo({ address: '8.8.8.8', family: 4 }));
    const got = await new Promise<{ a?: unknown; f?: number }>((resolve) => {
      lookup('api.example.com', { all: false }, (_e, a, f) => resolve({ a, f }));
    });
    expect(got.a).toBe('8.8.8.8');
    expect(got.f).toBe(4);
  });
});

// Standing regression for the TOCTOU-safe invariant (vote condition): prove undici
// ACTUALLY blocks the connection when our validating connect.lookup rejects — so a
// future undici bump that changed lookup semantics would fail here, not silently
// reopen SSRF. The lookup rejects before any socket egress, so this makes no real
// network call.
describe('safe Agent — undici blocks the connect when the validating lookup rejects', () => {
  it('a non-local host resolving to loopback is refused at connect (no egress)', async () => {
    const resolver: ResolveAll = async () => [{ address: '127.0.0.1', family: 4 }];
    const agent = new Agent({
      connect: { lookup: makeSafeLookup(resolver) as unknown as LookupFunction },
    });
    await expect(
      undiciFetch('https://rebind.invalid/', {
        dispatcher: agent,
        signal: AbortSignal.timeout(5000),
      }),
    ).rejects.toThrow();
    await agent.close();
  });
});
