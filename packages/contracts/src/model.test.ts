/**
 * ModelRequirement contract [CLM-0076]: a two-axis model demand (tier +
 * effort + capabilities) with sensible defaults, strict about unknown axes,
 * and ordinal tier/effort ladders the kernel translation seam degrades along.
 */
import { describe, expect, it } from 'vitest';
import {
  EFFORT_ORDER,
  EffortSchema,
  MODEL_TIER_ORDER,
  ModelCapabilitySchema,
  ModelRequirementSchema,
  ModelTierSchema,
} from './model.js';

describe('ModelRequirementSchema', () => {
  it('applies defaults for every axis (medium tier, medium effort, no capabilities)', () => {
    expect(ModelRequirementSchema.parse({})).toEqual({
      tier: 'medium',
      effort: 'medium',
      capabilities: [],
    });
  });

  it('parses a fully specified requirement', () => {
    expect(
      ModelRequirementSchema.parse({
        tier: 'frontier',
        effort: 'xhigh',
        capabilities: ['vision', 'toolUse'],
      }),
    ).toEqual({ tier: 'frontier', effort: 'xhigh', capabilities: ['vision', 'toolUse'] });
  });

  it('fills only the unset axis (partial requirement)', () => {
    expect(ModelRequirementSchema.parse({ tier: 'large' })).toEqual({
      tier: 'large',
      effort: 'medium',
      capabilities: [],
    });
  });

  it('rejects an unknown tier, effort, capability, or extra axis (strict)', () => {
    expect(ModelRequirementSchema.safeParse({ tier: 'huge' }).success).toBe(false);
    expect(ModelRequirementSchema.safeParse({ effort: 'max' }).success).toBe(false);
    expect(ModelRequirementSchema.safeParse({ capabilities: ['telepathy'] }).success).toBe(false);
    expect(ModelRequirementSchema.safeParse({ provider: 'openai' }).success).toBe(false);
  });
});

describe('ordinal ladders', () => {
  it('tiers run richest → leanest (the downward degradation direction)', () => {
    expect(MODEL_TIER_ORDER).toEqual(['frontier', 'large', 'medium', 'small']);
    expect(ModelTierSchema.options).toEqual([...MODEL_TIER_ORDER]);
  });

  it('efforts run leanest → richest (the clamp ladder)', () => {
    expect(EFFORT_ORDER).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(EffortSchema.options).toEqual([...EFFORT_ORDER]);
  });

  it('capabilities are the declared model-feature vocabulary', () => {
    expect(ModelCapabilitySchema.options).toEqual(['toolUse', 'vision', 'longContext', 'jsonMode']);
  });
});
