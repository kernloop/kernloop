import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '@kernloop/contracts';
import { observerManifest } from './manifest.js';

describe('observerManifest (spec §4, §5.5)', () => {
  it('parses through ManifestSchema with the observer capabilities at suggest tier', () => {
    const parsed = ManifestSchema.parse(observerManifest);
    expect(parsed.name).toBe('@kernloop/faculty-observer');
    expect(parsed.kind).toBe('faculty');
    expect(parsed.capabilities.map((c) => c.name)).toEqual([
      'observer.ingest',
      'observer.fitness',
      'observer.issues',
      'observer.lifecycle',
    ]);
    expect(parsed.contracts).toEqual({ consumes: ['Outcome', 'Verdict'], emits: [] });
    expect(parsed.tier).toBe('suggest');
    expect(parsed.maturity).toBe('stable');
    expect(parsed.claims).toEqual(['CLM-0055', 'CLM-0056', 'CLM-0092']);
  });
});
