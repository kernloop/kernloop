import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '@kernloop/contracts';
import { qualityGateManifest } from './manifest.js';

describe('qualityGateManifest', () => {
  it('parses against ManifestSchema', () => {
    expect(ManifestSchema.safeParse(qualityGateManifest).success).toBe(true);
  });

  it('registers the quality gate at advisory tier', () => {
    expect(qualityGateManifest.kind).toBe('gate');
    expect(qualityGateManifest.name).toBe('@kernloop/faculty-gates');
    expect(qualityGateManifest.tier).toBe('advisory');
    expect(qualityGateManifest.maturity).toBe('stable');
    expect(qualityGateManifest.capabilities.map((c) => c.name)).toEqual(['gate.quality']);
  });

  it('consumes TaskContract and emits Verdict, backed by CLM-0031 and CLM-0104', () => {
    expect(qualityGateManifest.contracts).toEqual({
      consumes: ['TaskContract'],
      emits: ['Verdict'],
    });
    expect(qualityGateManifest.claims).toEqual(['CLM-0031', 'CLM-0104']);
  });

  it('declares a zero-token, zero-usd mechanical cost profile', () => {
    expect(qualityGateManifest.cost.tokens).toBe(0);
    expect(qualityGateManifest.cost.usd).toBe(0);
  });
});
