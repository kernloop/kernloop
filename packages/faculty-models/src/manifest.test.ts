/**
 * The models faculty manifest [CLM-0080]: a valid registration record at the
 * `observe` tier (it normalizes, it does not act), declaring its claims and no
 * bus contracts.
 */
import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '@kernloop/contracts';
import { modelsManifest } from './manifest.js';

describe('modelsManifest', () => {
  it('is a valid Manifest at the observe tier', () => {
    expect(() => ManifestSchema.parse(modelsManifest)).not.toThrow();
    expect(modelsManifest.tier).toBe('observe');
    expect(modelsManifest.kind).toBe('faculty');
  });

  it('participates in no bus contracts and makes no model demand', () => {
    expect(modelsManifest.contracts.consumes).toEqual([]);
    expect(modelsManifest.contracts.emits).toEqual([]);
    expect(modelsManifest.model).toBeUndefined();
  });

  it('declares its backing claims', () => {
    expect(modelsManifest.claims).toContain('CLM-0080');
    expect(modelsManifest.claims).toContain('CLM-0081');
  });
});
