import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '@kernloop/contracts';
import { scrumManifest } from './manifest.js';

describe('scrumManifest', () => {
  it('parses against ManifestSchema', () => {
    expect(ManifestSchema.safeParse(scrumManifest).success).toBe(true);
  });

  it('registers the scrum faculty at suggest tier', () => {
    expect(scrumManifest.kind).toBe('faculty');
    expect(scrumManifest.name).toBe('@kernloop/faculty-scrum');
    expect(scrumManifest.tier).toBe('suggest');
    expect(scrumManifest.maturity).toBe('stable');
    expect(scrumManifest.capabilities.map((c) => c.name)).toEqual(['scrum.decompose-goal']);
  });

  it('consumes and emits TaskContract, backed by CLM-0096', () => {
    expect(scrumManifest.contracts).toEqual({
      consumes: ['TaskContract'],
      emits: ['TaskContract'],
    });
    expect(scrumManifest.claims).toEqual(['CLM-0096']);
  });

  it('declares a zero-token, zero-usd mechanical cost profile', () => {
    expect(scrumManifest.cost.tokens).toBe(0);
    expect(scrumManifest.cost.usd).toBe(0);
  });
});
