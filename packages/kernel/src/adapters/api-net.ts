/**
 * Resolve-time, IP-pinned SSRF guard for the api adapter's egress (#508).
 *
 * The lexical {@link module:kernel/adapters/api-url} guard validates the operator
 * baseUrl STRING (scheme/credentials/local-host) before egress — but an `https:`
 * host that *resolves* to a private/loopback/link-local/cloud-metadata address
 * passes it (the honest "not SSRF immunity" caveat on [CLM-0084]). This module
 * closes that: every api-adapter request goes through {@link safeFetch}, whose
 * undici dispatcher uses a custom `connect.lookup` that resolves the host and
 * REJECTS the connection if any resolved address is disallowed.
 *
 * TOCTOU-safe by construction: the lookup that VALIDATES the addresses is the
 * SAME lookup the socket connects through — there is no separate
 * resolve-then-reconnect window for DNS-rebinding to exploit (the exact gap both
 * ratification panels' contrarians flagged). An operator-declared LOCAL endpoint
 * (the documented http escape hatch, {@link isLocalHost}) is allowed to resolve
 * to loopback/private; a NON-local hostname that resolves there is blocked.
 *
 * [CLM-0186]
 * @module kernel/adapters/api-net
 */
import { lookup as dnsLookupCb, type LookupAddress } from 'node:dns';
import { type LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch, type RequestInit, type Response } from 'undici';
import { isLocalHost } from './api-url.js';

/** Resolve every address for a host (the injectable seam unit tests drive). */
export type ResolveAll = (hostname: string) => Promise<LookupAddress[]>;

const defaultResolveAll: ResolveAll = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookupCb(hostname, { all: true }, (err, addresses) =>
      err ? reject(err) : resolve(addresses),
    );
  });

/**
 * True if a RESOLVED address must never be the egress target of a non-local endpoint.
 * Parsing + range classification is delegated to the vetted `ipaddr.js` (so every
 * textual spelling — decimal/hex/octal IPv4, compressed/uncompressed/zone-id IPv6 —
 * normalizes before classification): an address is ALLOWED only if it is public
 * `unicast`. Everything else (loopback, private/RFC-1918, link-local incl. metadata,
 * carrier-grade NAT, unique-local, multicast, teredo, reserved, unspecified) is
 * disallowed. Embedded-IPv4 tunnels — IPv4-mapped, NAT64 well-known `64:ff9b::/96`
 * (rfc6052), 6to4, and the deprecated IPv4-compatible `::/96` (which ipaddr reports as
 * unicast) — are resolved to their embedded IPv4 and classified there, so e.g.
 * `64:ff9b::a9fe:a9fe` (169.254.169.254) is blocked while `64:ff9b::8.8.8.8` is allowed.
 * Unparseable input fails closed (disallowed).
 */
export function isDisallowedAddress(address: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(address);
  } catch {
    return true; // unparseable — fail closed
  }
  if (addr.kind() === 'ipv4') return addr.range() !== 'unicast';
  const v6 = addr as ipaddr.IPv6;
  if (v6.isIPv4MappedAddress()) return v6.toIPv4Address().range() !== 'unicast';
  const r = v6.range();
  const bytes = v6.toByteArray();
  if (r === 'rfc6052') return embeddedV4Disallowed(bytes, 12); // NAT64 64:ff9b::/96 — v4 in last 32 bits
  if (r === '6to4') return embeddedV4Disallowed(bytes, 2); // 2002::/16 — v4 in bytes 2..5
  if (r !== 'unicast') return true; // loopback/linkLocal/uniqueLocal/multicast/teredo/reserved/unspecified
  // ipaddr reports the deprecated IPv4-compatible ::/96 as 'unicast' — close that gap.
  // (Verified still misreported in ipaddr.js 2.x — 2.4.0 probe — so this closure stays
  // load-bearing, not just belt-and-braces. :: and ::1 are already handled above via the
  // non-unicast range check, so reaching here with the first 12 bytes zero means the low
  // 32 bits are an embedded IPv4.)
  if (bytes.slice(0, 12).every((b) => b === 0)) return embeddedV4Disallowed(bytes, 12);
  return false;
}

/** Classify the IPv4 embedded at `offset` in an IPv6 byte array (allowed only if unicast). */
function embeddedV4Disallowed(bytes: number[], offset: number): boolean {
  const v4 = ipaddr.fromByteArray(bytes.slice(offset, offset + 4));
  return v4.kind() !== 'ipv4' || v4.range() !== 'unicast';
}

/**
 * Build a `connect.lookup` (dns.lookup-shaped) that resolves a hostname and, for
 * a NON-local host, rejects the connection if ANY resolved address is disallowed.
 * A lexically-local host (the operator's http escape hatch) is allowed to resolve
 * to loopback/private. Reject-if-ANY: a host resolving to a mix of public and
 * disallowed addresses is refused outright (an attacker can't smuggle a private
 * address into the candidate set the connector picks from).
 */
export function makeSafeLookup(resolveAll: ResolveAll = defaultResolveAll) {
  return (
    hostname: string,
    options: { all?: boolean | undefined; family?: number | undefined },
    callback: (
      err: NodeJS.ErrnoException | null,
      address?: string | LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    // A lexically-local host (localhost / *.localhost / a private-IP literal) is the
    // operator's explicit local endpoint, so it MAY resolve to loopback/private; any
    // other host that resolves there is the SSRF/rebinding case we block. (A bare IP
    // literal resolves to itself, so it is classified by the same path below.)
    const local = isLocalHost(hostname);

    resolveAll(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          return callback(new Error(`api-net: ${hostname} resolved to no addresses`));
        }
        if (!local) {
          const bad = addresses.find((a) => isDisallowedAddress(a.address));
          if (bad) {
            return callback(
              new Error(
                `api-net: blocked egress — "${hostname}" resolves to disallowed address ` +
                  `${bad.address} (private/loopback/link-local/metadata). Use a public ` +
                  `https endpoint, or the explicit http local-host escape hatch.`,
              ),
            );
          }
        }
        // Return in the shape undici asked for; these validated addresses are the
        // ONLY ones the socket connects through (no re-resolution → no TOCTOU).
        if (options.all) return callback(null, addresses);
        const first = addresses[0] as LookupAddress;
        callback(null, first.address, first.family);
      },
      (err) => callback(err as NodeJS.ErrnoException),
    );
  };
}

/**
 * One process-wide dispatcher whose every new connection is validated by
 * {@link makeSafeLookup}. Reused across calls (connection pooling); the lookup
 * runs per new socket, so the guard applies to every egress.
 */
// The cast bridges our readable (hostname, options, callback) lookup to undici's
// structural `LookupFunction`; the runtime correctly handles the `all`/`family`
// option shapes undici passes (verified by the api-net tests).
const safeAgent = new Agent({ connect: { lookup: makeSafeLookup() as unknown as LookupFunction } });

/**
 * SSRF-safe `fetch` for the api adapter: identical to global fetch but every
 * connection's DNS resolution is validated and pinned by {@link safeAgent}. All
 * api-adapter egress (chat + discovery) routes through this. Same web `Response`
 * (web `ReadableStream` body) the callers already consume.
 */
export function safeFetch(target: URL | string, init: RequestInit): Promise<Response> {
  return undiciFetch(target, { ...init, dispatcher: safeAgent });
}
