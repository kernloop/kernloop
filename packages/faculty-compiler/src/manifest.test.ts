import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '@kernloop/contracts';
import { compilerManifest } from './index.js';

describe('compilerManifest', () => {
  it('parses with ManifestSchema', () => {
    expect(ManifestSchema.parse(compilerManifest)).toEqual(compilerManifest);
  });

  it('declares the compiler faculty exactly as specified', () => {
    expect(compilerManifest.name).toBe('@kernloop/faculty-compiler');
    expect(compilerManifest.version).toBe('0.1.0');
    expect(compilerManifest.kind).toBe('faculty');
    expect(compilerManifest.capabilities.map((c) => c.name)).toEqual(['brief.compile']);
    expect(compilerManifest.contracts).toEqual({ consumes: ['TaskContract'], emits: ['Brief'] });
    expect(compilerManifest.tier).toBe('observe');
    expect(compilerManifest.maturity).toBe('stable');
    expect(compilerManifest.claims).toEqual(['CLM-0029', 'CLM-0030']);
  });
});
