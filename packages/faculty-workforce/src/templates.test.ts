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

  it('declares a cost profile for each model tier', () => {
    expect(Object.keys(MODEL_TIER_COST).sort()).toEqual(['cheap', 'frontier']);
    expect(MODEL_TIER_COST.cheap.usd).toBeLessThan(MODEL_TIER_COST.frontier.usd);
  });

  it('rejects templates with an empty role prompt, bad name, or out-of-range budget share', () => {
    const base = SHIPPED_TEMPLATES['coder'];
    expect(AgentTemplateSchema.safeParse({ ...base, rolePrompt: '' }).success).toBe(false);
    expect(AgentTemplateSchema.safeParse({ ...base, name: 'Not Kebab' }).success).toBe(false);
    expect(AgentTemplateSchema.safeParse({ ...base, budgetShare: 0 }).success).toBe(false);
    expect(AgentTemplateSchema.safeParse({ ...base, budgetShare: 1.5 }).success).toBe(false);
    expect(AgentTemplateSchema.safeParse({ ...base, modelTier: 'medium' }).success).toBe(false);
  });
});
