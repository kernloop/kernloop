import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '@kernloop/contracts';
import { toolsmithManifest } from './index.js';

describe('toolsmithManifest', () => {
  it('parses with ManifestSchema', () => {
    expect(ManifestSchema.parse(toolsmithManifest)).toEqual(toolsmithManifest);
  });

  it('declares the toolsmith faculty surface exactly', () => {
    expect(toolsmithManifest.kind).toBe('faculty');
    expect(toolsmithManifest.name).toBe('@kernloop/faculty-toolsmith');
    expect(toolsmithManifest.capabilities.map((c) => c.name)).toEqual([
      'toolsmith.forge',
      'toolsmith.retire',
      'toolsmith.lifecycle',
    ]);
    expect(toolsmithManifest.contracts).toEqual({
      consumes: ['TaskContract'],
      emits: ['Outcome'],
    });
    expect(toolsmithManifest.tier).toBe('suggest');
    expect(toolsmithManifest.maturity).toBe('stable');
    expect(toolsmithManifest.claims).toEqual(['CLM-0051', 'CLM-0052', 'CLM-0053', 'CLM-0054']);
  });
});
