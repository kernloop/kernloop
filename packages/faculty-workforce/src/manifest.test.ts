import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '@kernloop/contracts';
import { workforceManifest } from './manifest.js';

describe('workforceManifest', () => {
  it('parses against ManifestSchema', () => {
    expect(ManifestSchema.safeParse(workforceManifest).success).toBe(true);
  });

  it('registers the workforce faculty at suggest tier', () => {
    expect(workforceManifest.kind).toBe('faculty');
    expect(workforceManifest.name).toBe('@kernloop/faculty-workforce');
    expect(workforceManifest.tier).toBe('suggest');
    expect(workforceManifest.maturity).toBe('stable');
    expect(workforceManifest.capabilities.map((c) => c.name)).toEqual([
      'workforce.instantiate',
      'workforce.decompose',
    ]);
  });

  it('consumes and emits TaskContract, backed by CLM-0040 and CLM-0041', () => {
    expect(workforceManifest.contracts).toEqual({
      consumes: ['TaskContract'],
      emits: ['TaskContract'],
    });
    expect(workforceManifest.claims).toEqual(['CLM-0040', 'CLM-0041']);
  });

  it('declares a zero-token, zero-usd mechanical cost profile', () => {
    expect(workforceManifest.cost.tokens).toBe(0);
    expect(workforceManifest.cost.usd).toBe(0);
  });
});
