/**
 * The kernel translation seam [CLM-0077] (spec §8.4) — PURE, fail-closed resolution of a
 * {@link ModelRequirement}'s `tier`/`effort` axes against an adapter's
 * declarative model-routing profile (`tierBinding` / `effort` on
 * {@link AdapterDefinition}).
 *
 * Constitutional guardrails (rules 1–4): this is a deterministic static lookup
 * and nothing more. It makes NO model call, holds NO concrete deployment policy
 * (the bindings are passed in as data), and has NO heuristics — no
 * retry-at-higher-tier, no cost-aware selection, no synthesis of a model that
 * was not declared. The kernel imports only the ModelTier/Effort TYPES from
 * contracts (CLM-0061 stays green); the composition root binds the adapter and
 * makes the call.
 *
 * Degradation is ALWAYS the lesser-or-equal direction and ALWAYS recorded:
 *  - an unpopulated tier degrades DOWNWARD (frontier→large→medium→small) to the
 *    nearest populated one, `degraded: true`;
 *  - an unsupported effort clamps to the nearest supported level AT OR BELOW
 *    (then the highest supported), `clamped: true`; an adapter with no effort
 *    param drops it (`servedEffort: 'unsupported'`).
 * Serving MORE than was asked is never silent (prime directive).
 *
 * @module kernel/adapters/translate
 */
import { EFFORT_ORDER, MODEL_TIER_ORDER, type Effort, type ModelTier } from '@kernloop/contracts';
import type { AdapterEffortProfile } from './definitions.js';

/** The concrete model an adapter serves for a requested tier, with honesty. */
export interface ResolvedTierModel {
  /** The model/alias the adapter binds for {@link servedTier} (`''` = harness default). */
  readonly model: string;
  /** The tier actually served — equals the request unless degraded downward. */
  readonly servedTier: ModelTier;
  /** True when the requested tier was unpopulated and resolution stepped down. */
  readonly degraded: boolean;
}

/** The effort an adapter actually applies, with honesty about any clamp/drop. */
export interface ResolvedEffort {
  /** The literal the CLI expects, or undefined when effort is dropped. */
  readonly value: string | undefined;
  /** The effort served, or `'unsupported'` when the adapter has no effort param. */
  readonly servedEffort: Effort | 'unsupported';
  /** True when the requested effort was clamped to a different supported level. */
  readonly clamped: boolean;
}

/**
 * Resolve a requested {@link ModelTier} to the adapter's bound model. Exact hit
 * wins; otherwise step DOWNWARD along {@link MODEL_TIER_ORDER} (frontier → large
 * → medium → small) to the nearest populated tier and record the degradation.
 * Never steps upward and never synthesizes a model. A binding with NO populated
 * tier at or below the request leaves `model: ''` (the harness default) at the
 * requested tier — honest absence, not a fabricated id.
 */
export function resolveTierModel(
  tier: ModelTier,
  tierBinding: Partial<Record<ModelTier, string>>,
): ResolvedTierModel {
  const exact = tierBinding[tier];
  if (exact !== undefined) return { model: exact, servedTier: tier, degraded: false };
  const start = MODEL_TIER_ORDER.indexOf(tier);
  for (let i = start + 1; i < MODEL_TIER_ORDER.length; i += 1) {
    const lower = MODEL_TIER_ORDER[i];
    const model = lower === undefined ? undefined : tierBinding[lower];
    if (model !== undefined && lower !== undefined) {
      return { model, servedTier: lower, degraded: true };
    }
  }
  // No tier at or below the request is populated — let the harness default.
  return { model: '', servedTier: tier, degraded: false };
}

/**
 * Resolve a requested {@link Effort} against an adapter's effort profile. With
 * NO profile the adapter has no effort param: the setting is DROPPED honestly
 * ({@link ResolvedEffort.servedEffort} `'unsupported'`). Otherwise an exact
 * level wins; an unsupported level clamps to the nearest supported one AT OR
 * BELOW the request, and — when none is at or below — to the highest supported
 * level (xhigh→high etc.). Every clamp is recorded.
 */
export function resolveEffort(effort: Effort, support?: AdapterEffortProfile): ResolvedEffort {
  if (support === undefined)
    return { value: undefined, servedEffort: 'unsupported', clamped: false };
  const exact = support.levels[effort];
  if (exact !== undefined) return { value: exact, servedEffort: effort, clamped: false };
  const start = EFFORT_ORDER.indexOf(effort);
  for (let i = start - 1; i >= 0; i -= 1) {
    const lower = EFFORT_ORDER[i];
    const value = lower === undefined ? undefined : support.levels[lower];
    if (value !== undefined && lower !== undefined) {
      return { value, servedEffort: lower, clamped: true };
    }
  }
  return highestSupported(support);
}

/** The highest supported effort level — the clamp target when none is at-or-below. */
function highestSupported(support: AdapterEffortProfile): ResolvedEffort {
  for (let i = EFFORT_ORDER.length - 1; i >= 0; i -= 1) {
    const level = EFFORT_ORDER[i];
    const value = level === undefined ? undefined : support.levels[level];
    if (value !== undefined && level !== undefined) {
      return { value, servedEffort: level, clamped: true };
    }
  }
  // A profile with an empty levels map is a declaration bug, not a model call:
  // treat it as no effort support rather than fabricating a level.
  return { value: undefined, servedEffort: 'unsupported', clamped: false };
}
