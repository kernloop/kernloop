import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '@kernloop/contracts';
import { instantiateAgent, WORKFORCE_VERSION } from './instantiate.js';
import { MODEL_TIER_COST, SHIPPED_TEMPLATES, SHIPPED_TEMPLATE_NAMES } from './templates.js';

const overlay = 'overlay-test';

describe('instantiateAgent', () => {
  it('each of the five shipped templates instantiates to a ManifestSchema-valid agentTemplate manifest', () => {
    for (const name of SHIPPED_TEMPLATE_NAMES) {
      const template = SHIPPED_TEMPLATES[name];
      expect(template).toBeDefined();
      if (template === undefined) continue;
      const manifest = instantiateAgent(template, { overlay });
      expect(ManifestSchema.safeParse(manifest).success).toBe(true);
      expect(manifest.kind).toBe('agentTemplate');
      expect(manifest.name).toBe(`workforce/${name}`);
      expect(manifest.version).toBe(WORKFORCE_VERSION);
      expect(manifest.capabilities.map((c) => c.name)).toEqual([`agent.${name}`]);
      expect(manifest.contracts).toEqual({ consumes: ['TaskContract'], emits: ['Outcome'] });
      expect(manifest.cost).toEqual(MODEL_TIER_COST[template.model.tier]);
      // The two-axis requirement is stamped onto the manifest [CLM-0076].
      expect(manifest.model).toEqual(template.model);
    }
  });

  it('shipped templates instantiate stable at suggest tier with empty claims', () => {
    for (const name of SHIPPED_TEMPLATE_NAMES) {
      const template = SHIPPED_TEMPLATES[name];
      if (template === undefined) throw new Error(`missing shipped template ${name}`);
      const manifest = instantiateAgent(template, { overlay });
      expect(manifest.tier).toBe('suggest');
      expect(manifest.maturity).toBe('stable');
      expect(manifest.claims).toEqual([]);
    }
  });

  it('a custom template enters at suggest tier with experimental maturity', () => {
    const coder = SHIPPED_TEMPLATES['coder'];
    if (coder === undefined) throw new Error('missing shipped template coder');
    const manifest = instantiateAgent(coder, {
      overlay,
      overrides: { name: 'sql-specialist', skills: ['implementation', 'sql'] },
    });
    expect(manifest.name).toBe('workforce/sql-specialist');
    expect(manifest.capabilities.map((c) => c.name)).toEqual(['agent.sql-specialist']);
    expect(manifest.tier).toBe('suggest');
    expect(manifest.maturity).toBe('experimental');
    expect(ManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('any override makes the instantiation experimental, even keeping the shipped name', () => {
    const reviewer = SHIPPED_TEMPLATES['reviewer'];
    if (reviewer === undefined) throw new Error('missing shipped template reviewer');
    const manifest = instantiateAgent(reviewer, {
      overlay,
      overrides: { model: { tier: 'small', effort: 'low', capabilities: [] } },
    });
    expect(manifest.name).toBe('workforce/reviewer');
    expect(manifest.maturity).toBe('experimental');
    expect(manifest.tier).toBe('suggest');
    expect(manifest.cost).toEqual(MODEL_TIER_COST.small);
    expect(manifest.model).toEqual({ tier: 'small', effort: 'low', capabilities: [] });
  });

  it('a whole-cloth template not in the shipped library is experimental', () => {
    const manifest = instantiateAgent(
      {
        name: 'triager',
        rolePrompt: 'Triage incoming issues.',
        skills: [],
        model: { tier: 'small', effort: 'low', capabilities: [] },
        budgetShare: 0.05,
      },
      { overlay },
    );
    expect(manifest.maturity).toBe('experimental');
    expect(manifest.tier).toBe('suggest');
  });

  it('records overlay and model tier in the capability description', () => {
    const pm = SHIPPED_TEMPLATES['pm'];
    if (pm === undefined) throw new Error('missing shipped template pm');
    const manifest = instantiateAgent(pm, { overlay: 'repo-x' });
    expect(manifest.capabilities[0]?.description).toContain('overlay repo-x');
    expect(manifest.capabilities[0]?.description).toContain('large tier');
    expect(manifest.capabilities[0]?.description).toContain('high effort');
  });

  it('rejects an invalid template and invalid options', () => {
    const pm = SHIPPED_TEMPLATES['pm'];
    if (pm === undefined) throw new Error('missing shipped template pm');
    expect(() => instantiateAgent({ ...pm, rolePrompt: '' }, { overlay })).toThrow();
    expect(() => instantiateAgent(pm, { overlay: '' })).toThrow();
    expect(() => instantiateAgent(pm, { overlay, overrides: { budgetShare: 2 } })).toThrow();
  });
});
