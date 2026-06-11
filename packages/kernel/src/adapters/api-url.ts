/**
 * The api adapter's baseUrl guard (spec §3.1) — a config-LEXICAL validation of
 * the OPERATOR-configured endpoint URL, run BEFORE any network egress.
 *
 * Threat model (honest): this trusts the overlay as operator config. It is NOT
 * full SSRF immunity against a HOSTILE overlay — an `https:` baseUrl may reach
 * any host the operator points it at, which is the intended use (that is their
 * provider). What it DOES enforce: scheme (`https:`, or `http:` only to an
 * explicit local host), no embedded `user:pass@` credentials (secrets are
 * env-only), and a fixed request path appended by the caller (never templated).
 *
 * @module kernel/adapters/api-url
 */
import { isIP } from 'node:net';
import { ApiEndpointError } from './errors.js';

/** The fixed request path — never user-templated (baseUrl is host only). */
export const CHAT_PATH = '/chat/completions';

/**
 * Validate the OPERATOR-configured api endpoint `baseUrl` BEFORE any network
 * call. Config-LEXICAL guard, NOT SSRF immunity against a hostile overlay (an
 * `https:` baseUrl may reach any host the operator points it at, intended use).
 * `https:` is allowed to any host; plain `http:` is allowed ONLY to an explicit
 * localhost/loopback/private host (the documented local-model escape hatch for
 * vLLM/LM-Studio). Embedded `user:pass@` credentials are rejected (secrets are
 * env-only, never in config). Any other scheme, `http:` to a public host, or
 * embedded credentials is a typed {@link ApiEndpointError}. Returns the
 * normalized origin (scheme+host+port), to which the FIXED {@link CHAT_PATH} is
 * appended — the path is never user input.
 */
export function assertSafeBaseUrl(adapter: string, baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ApiEndpointError(adapter, `baseUrl is not a valid URL: ${baseUrl}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new ApiEndpointError(
      adapter,
      'baseUrl must not embed credentials (user:pass@) — the key is read from the env, not the URL',
    );
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:') {
    if (isLocalHost(url.hostname)) return url;
    throw new ApiEndpointError(
      adapter,
      `http: baseUrl is allowed only for a local host (localhost/loopback/private); ` +
        `"${url.hostname}" is not local — use https: (got ${baseUrl})`,
    );
  }
  throw new ApiEndpointError(adapter, `baseUrl scheme must be http(s); got "${url.protocol}"`);
}

/** True for localhost, IPv4/IPv6 loopback, and RFC-1918/link-local private hosts. */
function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIPv4(host);
  if (ipVersion === 6) return host === '::1' || host.startsWith('fc') || host.startsWith('fd');
  return false;
}

/** True for loopback / RFC-1918 / link-local IPv4 ranges. */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10/8
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 169 && b === 254) return true; // link-local
  return false;
}
