import { describe, expect, it } from 'vitest';
import {
  AgentTemplateSchema,
  MODEL_TIER_COST,
  SHIPPED_TEMPLATES,
  SHIPPED_TEMPLATE_NAMES,
} from './templates.js';

describe('shipped templates', () => {
  it('ships exactly the five spec §5.4 templates', () => {
    expect(SHIPPED_TEMPLATE_NAMES).toEqual(['pm', 'coder', 'reviewer', 'documenter', 'researcher']);
    expect(Object.keys(SHIPPED_TEMPLATES).sort()).toEqual([...SHIPPED_TEMPLATE_NAMES].sort());
  });

  it('every shipped template is schema-valid and keyed by its own name', () => {
    for (const [key, t] of Object.entries(SHIPPED_TEMPLATES)) {
      expect(AgentTemplateSchema.safeParse(t).success).toBe(true);
      expect(t.name).toBe(key);
    }
  });

  it('researcher is a single template with the research skill pack, not a faculty', () => {
    const researcher = SHIPPED_TEMPLATES['researcher'];
    expect(researcher).toBeDefined();
    expect(researcher?.skills).toContain('research');
  });

  it('declares a cost profile for each of the four model tiers, ordered by spend', () => {
    expect(Object.keys(MODEL_TIER_COST).sort()).toEqual(['frontier', 'large', 'medium', 'small']);
    expect(MODEL_TIER_COST.small.usd).toBeLessThan(MODEL_TIER_COST.medium.usd);
    expect(MODEL_TIER_COST.medium.usd).toBeLessThan(MODEL_TIER_COST.large.usd);
    expect(MODEL_TIER_COST.large.usd).toBeLessThan(MODEL_TIER_COST.frontier.usd);
  });

  it('re-tiers the five templates onto the two-axis ModelRequirement [CLM-0076]', () => {
    expect(SHIPPED_TEMPLATES['coder']?.model).toEqual({
      tier: 'large',
      effort: 'high',
      capabilities: [],
    });
    expect(SHIPPED_TEMPLATES['pm']?.model.tier).toBe('large');
    expect(SHIPPED_TEMPLATES['researcher']?.model).toEqual({
      tier: 'large',
      effort: 'high',
      capabilities: [],
    });
    expect(SHIPPED_TEMPLATES['reviewer']?.model.tier).toBe('medium');
    expect(SHIPPED_TEMPLATES['documenter']?.model).toEqual({
      tier: 'medium',
      effort: 'high',
      capabilities: [],
    });
  });

  it('rejects templates with an empty role prompt, bad name, or out-of-range budget share', () => {
    const base = SHIPPED_TEMPLATES['coder'];
    expect(AgentTemplateSchema.safeParse({ ...base, rolePrompt: '' }).success).toBe(false);
    expect(AgentTemplateSchema.safeParse({ ...base, name: 'Not Kebab' }).success).toBe(false);
    expect(AgentTemplateSchema.safeParse({ ...base, budgetShare: 0 }).success).toBe(false);
    expect(AgentTemplateSchema.safeParse({ ...base, budgetShare: 1.5 }).success).toBe(false);
    // model must be a valid ModelRequirement — an unknown tier is rejected.
    expect(
      AgentTemplateSchema.safeParse({ ...base, model: { tier: 'huge', effort: 'high' } }).success,
    ).toBe(false);
  });
});
