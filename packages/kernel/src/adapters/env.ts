/**
 * Least-privilege CHILD environment for spawned model-CLI adapters (#227, spec
 * §1 rule 7 / AppSec). A model CLI is a third-party agentic binary; handing it
 * the parent's whole `process.env` exposes every host secret — OTHER providers'
 * API keys, `GH_TOKEN`/`GITHUB_TOKEN`, cloud credentials — for exfiltration or
 * misuse. {@link scopedChildEnv} hands the child only an ALLOWLIST: a fixed set
 * of benign operational vars (PATH/HOME/locale/tmp/XDG…) plus the caller-named
 * extras a specific setup legitimately needs. Pure data, no policy decisions —
 * the kernel holds no intelligence (rule 4); WHICH extras to allow is the
 * composition root's overlay choice (`adapterEnvAllow`), threaded in as `allow`.
 *
 * NOTE: the api-endpoint adapter (the OpenAI-compatible HTTP path) does NOT use
 * this — it `fetch`es with a single configured key and never spawns — so HTTP
 * endpoints are unaffected. Only the CLI-subprocess adapters are scoped, and a
 * login-authenticated CLI keeps working on HOME alone; a key-authenticated one
 * names its key var in `adapterEnvAllow`.
 *
 * @module kernel/adapters/env
 */
import type { AdapterEnv } from './invoke.js';

/**
 * Benign operational env vars always passed to a model-CLI child: enough to
 * find executables (PATH), read its own config/login (HOME, the XDG dirs),
 * render correctly (locale, TERM), and use scratch space (TMPDIR) — but NO
 * credentials.
 * `LC_*` is matched by prefix (locale categories vary); everything else here is
 * an exact name.
 */
export const SAFE_ENV_KEYS: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'SHLVL',
  'PWD',
  'OLDPWD',
  'LANG',
  'LANGUAGE',
  'TERM',
  'COLORTERM',
  'COLUMNS',
  'LINES',
  'TMPDIR',
  'TMP',
  'TEMP',
  'TZ',
  'HOSTNAME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
  // Proxy + TLS operational vars (#227 review): non-credential peers of PATH —
  // a spawned CLI behind a corporate proxy or a custom CA needs these to reach
  // its own API at all; without them it fails with a confusing network error,
  // not an obvious "env was scoped" signal. A proxy URL CAN embed credentials,
  // but it is the operator's OWN outbound config the CLI legitimately uses, not
  // an unrelated host secret like another provider's key — so defaulting these
  // on (vs forcing every proxied operator to discover the escape hatch) is the
  // right trade. The CA vars are file PATHS, never secret content.
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CURL_CA_BUNDLE',
  'REQUESTS_CA_BUNDLE',
  // Windows operational vars (harmless; absent on POSIX).
  'SystemRoot',
  'ComSpec',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
];

/** True for a key on the allowlist: a SAFE_ENV_KEYS exact name, an `LC_` locale, or a caller extra. */
function isAllowed(key: string, allow: ReadonlySet<string>): boolean {
  return key.startsWith('LC_') || SAFE_ENV_KEYS.includes(key) || allow.has(key);
}

/**
 * The least-privilege child environment: every defined var of `fullEnv` whose
 * name is on the allowlist (the benign base ∪ the caller's `allow` extras),
 * everything else DROPPED. A drop is silent here (returning a smaller env, not
 * an error) — the composition root audits the scoping, the kernel only filters.
 * Returns a plain mutable record so it can feed `spawn`'s `env` directly.
 */
export function scopedChildEnv(
  fullEnv: AdapterEnv,
  allow: readonly string[] = [],
): Record<string, string> {
  const allowSet = new Set(allow);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fullEnv)) {
    if (value !== undefined && isAllowed(key, allowSet)) out[key] = value;
  }
  return out;
}

/** The env var NAMES dropped from `fullEnv` by {@link scopedChildEnv} (for audit). */
export function droppedEnvKeys(fullEnv: AdapterEnv, allow: readonly string[] = []): string[] {
  const allowSet = new Set(allow);
  return Object.keys(fullEnv)
    .filter((key) => fullEnv[key] !== undefined && !isAllowed(key, allowSet))
    .sort();
}
