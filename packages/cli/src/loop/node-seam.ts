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
import type { Effort, ModelIdentity, ModelRequirement, ModelTier } from '@kernloop/contracts';
import { catalog, resolveIdentity } from '@kernloop/faculty-models';
import { meteredInvoke, type LoopInvoke } from './invoke.js';

/** The per-tier adapter map an overlay declares (tier → adapter name). */
export type TierAdapters = Partial<Record<ModelTier, AdapterName | undefined>>;

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
 */
export function resolveServed(req: ModelRequirement, adapter: AdapterName): ServedModel {
  const def = adapterDefinitions[adapter];
  const tier = resolveTierModel(req.tier, def.tierBinding);
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

/** Pick the adapter that serves a tier: the overlay's per-tier choice, else the run adapter. */
export function adapterForTier(
  tier: ModelTier,
  tierAdapters: TierAdapters | undefined,
  runAdapter: AdapterName,
): AdapterName {
  return tierAdapters?.[tier] ?? runAdapter;
}

/** A node's bound, metered invoke plus the served-model provenance it carries. */
export interface NodeSeam {
  /** The metered invoke, pre-bound to the served model alias (when non-empty). */
  readonly invoke: LoopInvoke;
  /** What served the call — threaded into Brief/Outcome provenance. */
  readonly served: ServedModel;
}

/**
 * Bind a {@link ServedModel} onto `base` as a metered {@link NodeSeam}: every
 * call carries the served model alias (when the harness binds one, not the
 * default `''`) and the resolved effort arg (when the adapter supports it), and
 * its spend accumulates into `totals`. A caller-supplied `model`/`effort` in
 * the per-call options still wins (tests script raw invokes); the binding only
 * fills what the call left unset.
 */
export function buildNodeSeam(
  served: ServedModel,
  base: LoopInvoke,
  totals: { tokens: number; usd: number },
): NodeSeam {
  const metered = meteredInvoke(base, totals);
  const invoke: LoopInvoke = (prompt, options = {}) => {
    const model = options.model ?? (served.model === '' ? undefined : served.model);
    const effort = options.effort ?? served.effortArg;
    return metered(prompt, {
      ...options,
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    });
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
 * Normalize what served a node into a {@link ModelIdentity} [CLM-0081] (the
 * SUPPLY side, spec §5.7/§8.4). The served `model` is the harness ALIAS the
 * tier resolved to (`opus`, `gemini-3.1-pro`, or `''` = harness default); the
 * models faculty's vendored catalog maps it to the real model class. A `''`
 * (harness picked its own model — kernloop pinned none) normalizes to an honest
 * `unknown`, never a guess. Pure: the catalog is loaded once.
 */
export function servedIdentity(served: ServedModel): ModelIdentity {
  return resolveIdentity(served.model, catalog);
}

/**
 * Compact provenance ref naming the NORMALIZED served identity [CLM-0081], e.g.
 * `identity:claude-opus@4.8/large(table)` or, for a harness default,
 * `identity:unknown(unknown)`. It rides ALONGSIDE {@link servedRef} so the
 * trace records both the raw served alias and the real model class behind it —
 * and admits `unknown` honestly when kernloop did not pin the model. The
 * trailing `(resolvedBy)` discloses how confidently the class was named.
 */
export function identityRef(served: ServedModel): string {
  const id = servedIdentity(served);
  const variant = id.variant === null ? '' : `-${id.variant}`;
  const known = id.resolvedBy === 'unknown';
  const body = known ? id.family : `${id.family}${variant}@${id.generation}/${id.tier}`;
  return `identity:${body}(${id.resolvedBy})`;
}
