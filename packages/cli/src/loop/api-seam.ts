/**
 * The api-endpoint arm of the per-node model seam [CLM-0084] — the composition
 * root binding a node whose tier resolves to a REGISTERED OpenAI-compatible
 * endpoint (overlay `endpoints`, spec §8.4 `api`). It is the SIBLING of
 * `node-seam.ts`'s CLI arm: it reuses the kernel's pure translation seam
 * (`resolveTierModel` / `resolveEffort`) over the endpoint's declarative profile
 * to choose the concrete model id + `reasoning_effort` literal, then binds a
 * metered {@link LoopInvoke} backed by the kernel's `invokeApiAdapter` — the one
 * direct network model call. The metered Cost flows into the run `totals`
 * exactly like a CLI call, so the budget guard [CLM-0077] enforces API spend too.
 *
 * Secrets never live here: the key is read from `process.env[apiKeyEnv]` inside
 * the kernel adapter at call time, not on this seam.
 */
import {
  invokeApiAdapter,
  resolveEffort,
  resolveTierModel,
  type ApiAdapterDefinition,
} from '@kernloop/kernel';
import type { ModelRequirement } from '@kernloop/contracts';
import { type LoopInvoke, type RunTotals, LOOP_INVOKE_TIMEOUT_MS } from './invoke.js';
import { buildNodeSeam, type NodeSeam, type NodeSeamHooks, type ServedModel } from './node-seam.js';

/**
 * The bounded `max_tokens` an api call sends (spend ceiling, spec §3.1). A node
 * carries no explicit token cap in this phase, so the run-level default is used;
 * it is ALWAYS sent so an endpoint can never run unbounded.
 */
export const API_MAX_TOKENS = 4_096;

/**
 * Resolve a node's requirement to the concrete model + effort an ENDPOINT serves.
 * Mirrors `resolveServed` but over the endpoint's `tierBinding`/`effort` profile:
 * the tier degrades downward to a populated concrete model id, the effort clamps
 * or drops, and both honesty flags ride on the {@link ServedModel}. The
 * resolved effort literal rides as a `reasoning_effort` body field (`via:'body'`).
 */
export function resolveServedApi(req: ModelRequirement, def: ApiAdapterDefinition): ServedModel {
  const tier = resolveTierModel(req.tier, def.tierBinding);
  const effort = resolveEffort(req.effort, def.effort);
  const effortArg =
    def.effort !== undefined && effort.value !== undefined
      ? { param: def.effort.param, value: effort.value, via: def.effort.via }
      : undefined;
  return {
    adapter: def.name,
    model: tier.model,
    requestedTier: req.tier,
    servedTier: tier.servedTier,
    degraded: tier.degraded,
    requestedEffort: req.effort,
    servedEffort: effort.servedEffort,
    effortClamped: effort.clamped,
    effortArg,
  };
}

/**
 * A {@link LoopInvoke} backed by the kernel `invokeApiAdapter` for `def`. The
 * bound model id + effort arrive through the per-call options (the node seam
 * fills them from the {@link ServedModel}); `max_tokens` is always sent. The key
 * is read from the env at call time inside the kernel adapter — never here.
 * `env` is injectable for tests (default `process.env`).
 */
export function apiInvoke(
  def: ApiAdapterDefinition,
  env?: Readonly<Record<string, string | undefined>>,
): LoopInvoke {
  return async (prompt, options = {}) => {
    const result = await invokeApiAdapter(def, {
      prompt,
      model: options.model ?? '',
      maxTokens: API_MAX_TOKENS,
      timeoutMs: options.timeoutMs ?? LOOP_INVOKE_TIMEOUT_MS,
      ...(options.effort === undefined ? {} : { effort: options.effort.value }),
      ...(env === undefined ? {} : { env }),
    });
    return { output: result.output, cost: result.cost };
  };
}

/**
 * Build a node's metered {@link NodeSeam} for an api endpoint: resolve the served
 * model+effort, then bind a metered api invoke carrying it. Spend accumulates
 * into `totals` (the run budget). `env` is injectable for tests. `hooks` threads
 * the per-model-call fitness hook + discovered cache (#66) so an endpoint-served
 * node feeds the Observer's identity-fitness series at parity with the CLI arm.
 */
export function buildApiNodeSeam(
  req: ModelRequirement,
  def: ApiAdapterDefinition,
  totals: RunTotals,
  env?: Readonly<Record<string, string | undefined>>,
  timeoutMs?: number,
  hooks: NodeSeamHooks = {},
): NodeSeam {
  const served = resolveServedApi(req, def);
  return buildNodeSeam(served, apiInvoke(def, env), totals, timeoutMs, hooks);
}
