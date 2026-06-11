/**
 * ModelRequirement — a component's two-axis model demand [CLM-0076] (spec §8.4
 * "tiered adapters … declared in manifests"). A 6th contract module: it rides on the
 * Manifest (a frozen-five member) as one optional field, but it is NOT itself
 * a frozen-five contract — the bus carries the five, this describes what model
 * a governed component asks for.
 *
 * Two axes, deliberately orthogonal:
 *  - `tier` — the model class, an ORDINAL ladder frontier > large > medium >
 *    small. A harness/adapter binds a tier to a concrete model; when a tier is
 *    unpopulated the kernel translation seam steps DOWNWARD to the nearest
 *    populated one (never upward, never synthesized) and records the
 *    degradation — honesty over silently serving more than was asked.
 *  - `effort` — how hard the model should think (low < medium < high < xhigh).
 *    An adapter that exposes an effort/reasoning param honors it; one that does
 *    not drops it honestly (recorded `unsupported`), never faking the setting.
 *
 * `capabilities` is the set of model features a component needs (tool use,
 * vision, long context, JSON mode) — declarative demand the catalog/overlay
 * (a later phase) matches against an adapter's advertised capabilities. This
 * module defines the vocabulary; it makes no model call and holds no concrete
 * model ids (those are adapter/overlay data, spec §3.1 "no routing here").
 */
import { z } from 'zod';

/**
 * Model tier — an ordinal class ladder (spec §8.4). Order matters: the
 * translation seam degrades DOWNWARD along {@link MODEL_TIER_ORDER} only.
 */
export const ModelTierSchema = z.enum(['frontier', 'large', 'medium', 'small']);
export type ModelTier = z.infer<typeof ModelTierSchema>;

/** Tiers from richest to leanest — the only direction degradation may travel. */
export const MODEL_TIER_ORDER = ['frontier', 'large', 'medium', 'small'] as const;

/**
 * Reasoning effort — an ordinal ladder (low < medium < high < xhigh). An
 * adapter clamps an unsupported level to the nearest supported one AT OR BELOW
 * (then the highest supported) and records the clamp; an adapter with no effort
 * param drops it honestly.
 */
export const EffortSchema = z.enum(['low', 'medium', 'high', 'xhigh']);
export type Effort = z.infer<typeof EffortSchema>;

/** Effort levels from leanest to richest — the clamp ladder. */
export const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh'] as const;

/** A model feature a component may require of the adapter that serves it. */
export const ModelCapabilitySchema = z.enum(['toolUse', 'vision', 'longContext', 'jsonMode']);
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;

/**
 * A component's model demand. All three axes default, so a manifest/template
 * may declare a partial requirement (or omit it entirely) and still parse to a
 * complete, honest value — `medium` tier, `medium` effort, no extra
 * capabilities. `strictObject`: an unknown axis is a typo that would let the
 * declaration lie about what it asked for (prime directive), so it is rejected.
 */
export const ModelRequirementSchema = z.strictObject({
  tier: ModelTierSchema.default('medium'),
  effort: EffortSchema.default('medium'),
  capabilities: z.array(ModelCapabilitySchema).default([]),
});
export type ModelRequirement = z.infer<typeof ModelRequirementSchema>;
