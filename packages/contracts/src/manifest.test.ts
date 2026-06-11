import { describe, expect, it } from 'vitest';
import { ManifestKindSchema, ManifestSchema, type Manifest } from './manifest.js';

const valid: Manifest = {
  name: 'faculty-compiler',
  version: '0.1.0',
  kind: 'faculty',
  capabilities: [{ name: 'compile-brief', description: 'TaskContract → Brief' }],
  contracts: { consumes: ['TaskContract'], emits: ['Brief'] },
  cost: { tokens: 2000, usd: 0.05, latencyMs: 4000 },
  tier: 'suggest',
  promotion: { metric: 'precision', threshold: 0.95, windowN: 50 },
  claims: ['CLM-0007'],
  maturity: 'stable',
};

describe('ManifestKindSchema', () => {
  it('accepts all six kinds', () => {
    for (const kind of ['faculty', 'strategy', 'gate', 'agentTemplate', 'skill', 'workshopTool']) {
      expect(ManifestKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('rejects unknown kinds', () => {
    for (const bad of ['plugin', 'Faculty', 'tool', '', null]) {
      expect(ManifestKindSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('ManifestSchema', () => {
  it('parses a valid Manifest', () => {
    expect(ManifestSchema.parse(valid)).toEqual(valid);
  });

  it('parses without the optional promotion field and with empty claims', () => {
    const experimental: Record<string, unknown> = {
      ...valid,
      claims: [],
      maturity: 'experimental',
    };
    delete experimental['promotion'];
    expect(ManifestSchema.parse(experimental)).toEqual(experimental);
  });

  it('round-trips through JSON serialization', () => {
    expect(ManifestSchema.parse(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it('accepts the optional two-axis model requirement, defaulting its axes [CLM-0076]', () => {
    const withModel = ManifestSchema.parse({ ...valid, model: { tier: 'large' } });
    expect(withModel.model).toEqual({ tier: 'large', effort: 'medium', capabilities: [] });
    // The field is optional — a manifest with no model parses unchanged.
    expect(ManifestSchema.parse(valid).model).toBeUndefined();
    // An invalid requirement is rejected (strict).
    expect(ManifestSchema.safeParse({ ...valid, model: { tier: 'huge' } }).success).toBe(false);
  });

  it('rejects when a required field is missing', () => {
    for (const field of [
      'name',
      'version',
      'kind',
      'capabilities',
      'contracts',
      'cost',
      'tier',
      'claims',
      'maturity',
    ]) {
      const broken: Record<string, unknown> = { ...valid };
      delete broken[field];
      expect(ManifestSchema.safeParse(broken).success).toBe(false);
    }
  });

  it('rejects unknown tier, kind, and maturity enum values', () => {
    expect(ManifestSchema.safeParse({ ...valid, tier: 'sudo' }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...valid, kind: 'daemon' }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...valid, maturity: 'alpha' }).success).toBe(false);
  });

  it('rejects contract refs outside the frozen five', () => {
    const contracts = { consumes: ['TaskContract'], emits: ['Event'] };
    expect(ManifestSchema.safeParse({ ...valid, contracts }).success).toBe(false);
  });

  it('rejects malformed claim ids', () => {
    expect(ManifestSchema.safeParse({ ...valid, claims: ['CLM-12'] }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...valid, claims: ['claim-0001'] }).success).toBe(false);
  });

  it('rejects negative cost profile values and unknown keys', () => {
    const cost = { tokens: -1, usd: 0.05, latencyMs: 4000 };
    expect(ManifestSchema.safeParse({ ...valid, cost }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...valid, author: 'me' }).success).toBe(false);
  });
});
