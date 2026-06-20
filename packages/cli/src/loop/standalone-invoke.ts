/**
 * The model seam for a STANDALONE model-calling verb (#395) — gate/distill/forge/
 * program-author, which make a single model call outside the canonical loop.
 *
 * Mirrors the #392 run-loop adapter resolution: the `--adapter` may be a CLI
 * adapter name OR a registered endpoint id. A CLI adapter is probed on PATH and
 * bound via `adapterInvoke` (the harness defaults the model). A registered ENDPOINT
 * is bound via the kernel api adapter — but a verb calls `invoke(prompt)` with no
 * model, and an endpoint has NO harness default, so we resolve the endpoint's
 * `large`-tier model (a capable default for one-shot verb calls; resolveServedApi
 * degrades downward if `large` is unbound) and bind it. The key is read fail-closed
 * at call time inside the kernel adapter — never here.
 *
 * @module cli/loop/standalone-invoke
 */
import type { ModelTier } from '@kernloop/contracts';
import { isCliAdapter } from '../overlay-schemas.js';
import { apiDefinitionFor } from '../endpoints.js';
import type { Kernloop } from '../kernel.js';
import { adapterInvoke, ensureAdapterAvailable, type LoopInvoke } from './invoke.js';
import { apiInvoke, resolveServedApi } from './api-seam.js';

/** The tier a standalone verb's one-shot call binds on an endpoint (a capable default). */
const STANDALONE_TIER: ModelTier = 'large';

/**
 * Build a {@link LoopInvoke} for a standalone verb from `adapter` — a CLI adapter
 * name OR a registered endpoint id (#395). Throws a clear error when `adapter` is
 * neither (the same fail-fast as the run loop, #392). `env` is injectable for tests.
 */
export function resolveStandaloneInvoke(
  kern: Kernloop,
  adapter: string,
  env?: Readonly<Record<string, string | undefined>>,
): LoopInvoke {
  const endpoint = kern.config.endpoints[adapter];
  if (endpoint !== undefined) {
    const def = apiDefinitionFor(adapter, endpoint);
    const served = resolveServedApi(
      { tier: STANDALONE_TIER, effort: 'medium', capabilities: [] },
      def,
    );
    // resolveServedApi degrades DOWNWARD only, so an endpoint that binds only
    // `frontier` leaves `large` (and below) unresolved → ''. Fail at config-time
    // with a remedy that names the fix, not a cryptic call-time 'no model resolved'
    // from the kernel adapter (#397): degrading up to `frontier` is not an option.
    if (served.model === '') {
      throw new Error(
        `endpoint "${adapter}" binds no model for the \`${STANDALONE_TIER}\` tier or below, ` +
          `which a standalone verb needs — add a \`large\`, \`medium\`, or \`small\` entry under ` +
          `endpoints.${adapter}.models in your overlay.`,
      );
    }
    const base = apiInvoke(def, env);
    return (prompt, options = {}) =>
      base(prompt, { ...options, model: options.model ?? served.model });
  }
  if (!isCliAdapter(adapter)) {
    throw new Error(`adapter "${adapter}" is neither a CLI adapter nor a registered endpoint id`);
  }
  ensureAdapterAvailable(adapter, env);
  return adapterInvoke(adapter, env, undefined, kern.config.adapterEnvAllow);
}
