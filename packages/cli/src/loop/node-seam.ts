/**
 * The composition-root seam that turns a node's {@link ModelRequirement} into a
 * bound, metered model call [CLM-0078] — resolving WHICH adapter,
 * WHICH model alias, and WHICH effort arg actually serve it, and recording the
 * SERVED model+effort (with degradation/clamp honesty) as provenance the loop
 * threads into Briefs and Outcomes.
 *
 * The resolution itself is the kernel's pure translation seam
 * (`resolveTierModel` / `resolveEffort`); this module binds its result to a
 * concrete adapter and the loop's metered invoke. Degradation is NEVER silent:
 * a tier that stepped down or an effort that clamped/dropped is carried on
 * {@link ServedModel} and surfaced in provenance (prime directive).
 */
import {
  adapterDefinitions,
  resolveEffort,
  resolveTierModel,
  type AdapterCommandEffort,
  type AdapterName,
} from '@kernloop/kernel';
import type { Cost, Effort, ModelIdentity, ModelRequirement, ModelTier } from '@kernloop/contracts';
import {
  catalog,
  emptyDiscoveredCache,
  resolveWithDiscovered,
  type DiscoveredCache,
} from '@kernloop/faculty-models';
import { meteredInvoke, type LoopInvoke, type RunTotals } from './invoke.js';

/**
 * The empty discovered cache used when the loop runs WITHOUT a synced cache —
 * `resolveWithDiscovered` against it behaves exactly like the bare vendored
 * resolution (table → rule → unknown). The `snapshot` stamp is inert here (no
 * I/O), so a fixed placeholder is honest. Threaded as the default so existing
 * callers keep their behavior; a real run loads the overlay's cache (loop/index).
 */
const NO_DISCOVERED: DiscoveredCache = emptyDiscoveredCache('n/a');

/** What actually served a node's requirement — the honest provenance record. */
export interface ServedModel {
  /** The adapter that served the call: a CLI adapter name OR a registered api endpoint id. */
  readonly adapter: AdapterName | string;
  /** The model/alias the adapter bound (`''` = the harness default). */
  readonly model: string;
  /** The requested tier. */
  readonly requestedTier: ModelTier;
  /** The tier actually served — differs from {@link requestedTier} iff degraded. */
  readonly servedTier: ModelTier;
  /** True when the requested tier was unpopulated and resolution stepped DOWN. */
  readonly degraded: boolean;
  /** The requested effort. */
  readonly requestedEffort: Effort;
  /** The effort served, or `'unsupported'` when the adapter dropped it. */
  readonly servedEffort: Effort | 'unsupported';
  /** True when the requested effort was clamped to a different supported level. */
  readonly effortClamped: boolean;
  /**
   * The resolved effort arg to ride into argv, or undefined when the adapter
   * dropped effort. Kept off the public provenance ref; used only to bind the
   * actual call.
   */
  readonly effortArg: AdapterCommandEffort | undefined;
}

/**
 * Resolve a node's requirement to the model+effort that will serve it on
 * `adapter`. Pure over the adapter's declarative profile + the kernel seam:
 * the tier resolves (downward-degrading) to a model alias, the effort resolves
 * (clamping/dropping) to a CLI literal, and both honesty flags are carried.
 *
 * `modelOverride` (#393, CLM-0166) is an overlay's per-tier model PIN for this
 * CLI adapter: it merges OVER the adapter's declarative `tierBinding` (a pinned
 * tier wins, an unpinned tier keeps the adapter default), so kernloop can drive a
 * harness-routed CLI (opencode) at a kernloop-chosen model per tier instead of
 * the CLI's own auto-router. Merging (not replacing) preserves downward
 * degradation against the adapter's own bound tiers; the same override threads
 * the selector's prediction so predicted==served holds (CLM-0130).
 */
export function resolveServed(
  req: ModelRequirement,
  adapter: AdapterName,
  modelOverride?: Partial<Record<ModelTier, string>>,
): ServedModel {
  const def = adapterDefinitions[adapter];
  const binding =
    modelOverride === undefined ? def.tierBinding : { ...def.tierBinding, ...modelOverride };
  const tier = resolveTierModel(req.tier, binding);
  const effort = resolveEffort(req.effort, def.effort);
  const effortArg =
    def.effort !== undefined && effort.value !== undefined
      ? { param: def.effort.param, value: effort.value, via: def.effort.via }
      : undefined;
  return {
    adapter,
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

/** A node's bound, metered invoke plus the served-model provenance it carries. */
export interface NodeSeam {
  /** The metered invoke, pre-bound to the served model alias (when non-empty). */
  readonly invoke: LoopInvoke;
  /** What served the call — threaded into Brief/Outcome provenance. */
  readonly served: ServedModel;
}

/**
 * The per-MODEL-CALL fitness hook (#66, CLM-0125): each model invoke at a loop
 * node fires this once for its served {@link ModelIdentity} — `success` = the
 * call returned output, `false` = it threw — with the call's metered `cost`
 * (zero on failure). The composition root wires it to
 * `Observer.ingestModelFitness`, re-keying fitness on the model class so a
 * version bump does not reset learning. Optional: the injected-invoke test path
 * leaves it undefined.
 */
export type OnModelCall = (identity: ModelIdentity, success: boolean, cost: Cost) => void;

/** Per-call hooks {@link buildNodeSeam} threads beyond the served binding (#66). */
export interface NodeSeamHooks {
  /**
   * The discovered cache the seam normalizes the served alias against, so the
   * identity it reports to {@link onModelCall} matches provenance (the synced
   * cache wins over a bare rule parse). Defaults to the empty cache.
   */
  readonly discovered?: DiscoveredCache;
  /** Per-MODEL-CALL fitness hook (#66, CLM-0125); see {@link OnModelCall}. */
  readonly onModelCall?: OnModelCall;
}

/**
 * Bind a {@link ServedModel} onto `base` as a metered {@link NodeSeam}: every
 * call carries the served model alias (when the harness binds one, not the
 * default `''`) and the resolved effort arg (when the adapter supports it), and
 * its spend accumulates into `totals`. A caller-supplied `model`/`effort` in
 * the per-call options still wins (tests script raw invokes); the binding only
 * fills what the call left unset.
 *
 * `hooks.onModelCall` (#66) fires once per model call for the node's served
 * {@link ModelIdentity} — `true` + the call's metered cost on success, `false`
 * + zero cost on throw (then the error rethrows unchanged) — so the Observer
 * re-keys fitness on the model class. The identity is computed once from
 * `served` against `hooks.discovered`, matching the provenance ref.
 */
export function buildNodeSeam(
  served: ServedModel,
  base: LoopInvoke,
  totals: RunTotals,
  timeoutMs?: number,
  hooks: NodeSeamHooks = {},
  /** Bind tool-free invocation for a REASONING node (#148); a per-call option wins. */
  pureCompletion?: boolean,
): NodeSeam {
  // Attribute this node's spend to the adapter that serves it (#44).
  const metered = meteredInvoke(base, totals, served.adapter);
  // The served identity is fixed for this seam — compute it once, the same way
  // provenance does (the discovered cache wins over a bare rule parse) (#66).
  const identity = servedIdentity(served, hooks.discovered);
  const invoke: LoopInvoke = async (prompt, options = {}) => {
    const model = options.model ?? (served.model === '' ? undefined : served.model);
    const effort = options.effort ?? served.effortArg;
    // The per-node model-call budget (#127); a caller-supplied timeout wins.
    const timeout = options.timeoutMs ?? timeoutMs;
    // The REQUESTED tier rides through so a host that picks the model itself
    // (MCP sampling, #140) can route high/med/low; CLI/api adapters ignore it.
    const tier = options.tier ?? served.requestedTier;
    const pure = options.pureCompletion ?? pureCompletion;
    try {
      const result = await metered(prompt, {
        ...options,
        ...(model === undefined ? {} : { model }),
        ...(effort === undefined ? {} : { effort }),
        ...(timeout === undefined ? {} : { timeoutMs: timeout }),
        ...(pure === undefined ? {} : { pureCompletion: pure }),
        tier,
      });
      // Per-model-call fitness (#66): success = the call returned output.
      hooks.onModelCall?.(identity, true, result.cost);
      return result;
    } catch (err) {
      // Failure = the call threw; zero cost, then rethrow unchanged (#66).
      hooks.onModelCall?.(identity, false, { tokens: 0, usd: 0, wallClockMs: 0 });
      throw err;
    }
  };
  return { invoke, served };
}

/**
 * Compact one-line provenance ref for a served model, e.g.
 * `model:claude/opus@high` or, when degraded/clamped,
 * `model:claude/sonnet@high(tier large→medium,effort dropped)`. Always names
 * what TRULY served (prime directive: provenance never implies more than ran).
 */
export function servedRef(served: ServedModel): string {
  const model = served.model === '' ? 'default' : served.model;
  const notes: string[] = [];
  if (served.degraded) notes.push(`tier ${served.requestedTier}→${served.servedTier}`);
  if (served.servedEffort === 'unsupported') notes.push('effort dropped');
  else if (served.effortClamped)
    notes.push(`effort ${served.requestedEffort}→${served.servedEffort}`);
  const suffix = notes.length === 0 ? '' : ` (${notes.join(',')})`;
  // `@<effort>` is the REQUESTED effort by design; any divergence from what
  // actually served is disclosed in the `(...)` note (dropped / x→y) above, so
  // the ref never implies a served level it didn't honor (prime directive).
  return `model:${served.adapter}/${model}@${served.requestedEffort}${suffix}`;
}

/**
 * Normalize what served a node into a {@link ModelIdentity} [CLM-0081, CLM-0087]
 * (the SUPPLY side, spec §5.7/§8.4). The served `model` is the harness ALIAS the
 * tier resolved to (`opus`, `gemini-3.1-pro`, or `''` = harness default). It is
 * normalized through {@link resolveWithDiscovered}: the vendored catalog TABLE
 * wins, else the DISCOVERED cache (an id `models sync` saw the endpoint serve)
 * names it, else rule, else an honest `unknown` — so a discovered model
 * normalizes by the cache, not a bare rule parse. A `''` (kernloop pinned no
 * model) normalizes to `unknown`, never a guess. `discovered` defaults to the
 * empty cache (identical to bare vendored resolution).
 */
export function servedIdentity(
  served: ServedModel,
  discovered: DiscoveredCache = NO_DISCOVERED,
): ModelIdentity {
  return resolveWithDiscovered(served.model, catalog, discovered);
}

/**
 * The served identity FOR A DIVERSITY VOTE (#369, #381): like {@link servedIdentity},
 * but when the served model normalizes to an `unknown` class (a concrete-id adapter
 * like codex serving the harness default, with no catalog entry), it disambiguates by
 * the SERVING ADAPTER — `provider` becomes the adapter name, `family` stays the honest
 * `'unknown'`. Without this, two DISTINCT uncatalogued adapters (e.g. codex + opencode,
 * both → `unknown/unknown`) would share one diversity CLASS KEY and the vote gate's
 * #369 findings would falsely COLLAPSE them into a single oracle even though two
 * independent providers voted. Scoped to the vote ballot: the global provenance
 * ({@link identityRef}, CLM-0081) and the fitness ledger (CLM-0125) keep the honest
 * `unknown` identity unchanged. A catalogued/ruled identity is returned verbatim.
 */
export function voterServedIdentity(
  served: ServedModel,
  discovered: DiscoveredCache = NO_DISCOVERED,
): ModelIdentity {
  const id = servedIdentity(served, discovered);
  if (id.resolvedBy !== 'unknown') return id;
  return { ...id, provider: served.adapter };
}

/**
 * Compact provenance ref naming the NORMALIZED served identity [CLM-0081], e.g.
 * `identity:claude-opus@4.8/large(table)` or, for a harness default,
 * `identity:unknown(unknown)`. It rides ALONGSIDE {@link servedRef} so the
 * trace records both the raw served alias and the real model class behind it —
 * and admits `unknown` honestly when kernloop did not pin the model. The
 * trailing `(resolvedBy)` discloses how confidently the class was named. The
 * discovered cache (default empty) lets a synced model name by table, not rule.
 */
export function identityRef(
  served: ServedModel,
  discovered: DiscoveredCache = NO_DISCOVERED,
): string {
  const id = servedIdentity(served, discovered);
  const variant = id.variant === null ? '' : `-${id.variant}`;
  const known = id.resolvedBy === 'unknown';
  const body = known ? id.family : `${id.family}${variant}@${id.generation}/${id.tier}`;
  return `identity:${body}(${id.resolvedBy})`;
}
