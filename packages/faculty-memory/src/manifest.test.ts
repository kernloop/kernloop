import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '@kernloop/contracts';
import { memoryManifest } from './index.js';

describe('memoryManifest', () => {
  it('parses with ManifestSchema', () => {
    expect(ManifestSchema.parse(memoryManifest)).toEqual(memoryManifest);
  });

  it('declares the memory faculty surface exactly', () => {
    expect(memoryManifest.kind).toBe('faculty');
    expect(memoryManifest.name).toBe('@kernloop/faculty-memory');
    expect(memoryManifest.capabilities.map((c) => c.name)).toEqual([
      'memory.semantic.write',
      'memory.semantic.recall',
      'memory.episodic.write',
      'memory.episodic.read',
    ]);
    expect(memoryManifest.contracts).toEqual({ consumes: ['Outcome'], emits: [] });
    expect(memoryManifest.tier).toBe('suggest');
    expect(memoryManifest.maturity).toBe('stable');
    expect(memoryManifest.claims).toEqual(['CLM-0022', 'CLM-0023', 'CLM-0024', 'CLM-0025']);
  });
});
