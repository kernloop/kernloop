import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '@kernloop/contracts';
import { voteGateManifest } from './manifest.js';
import { qualityGateManifest } from '../manifest.js';

describe('voteGateManifest', () => {
  it('parses against ManifestSchema', () => {
    expect(ManifestSchema.safeParse(voteGateManifest).success).toBe(true);
  });

  it('registers the vote gate at advisory tier', () => {
    expect(voteGateManifest.kind).toBe('gate');
    expect(voteGateManifest.name).toBe('@kernloop/faculty-gates/vote');
    expect(voteGateManifest.tier).toBe('advisory');
    expect(voteGateManifest.maturity).toBe('stable');
    expect(voteGateManifest.capabilities.map((c) => c.name)).toEqual(['gate.vote']);
  });

  it('consumes TaskContract and Brief, emits Verdict, backed by CLM-0037..0039', () => {
    expect(voteGateManifest.contracts).toEqual({
      consumes: ['TaskContract', 'Brief'],
      emits: ['Verdict'],
    });
    expect(voteGateManifest.claims).toEqual(['CLM-0037', 'CLM-0038', 'CLM-0039']);
  });

  it('does not collide with the quality gate manifest in a name@version registry', () => {
    expect(`${voteGateManifest.name}@${voteGateManifest.version}`).not.toBe(
      `${qualityGateManifest.name}@${qualityGateManifest.version}`,
    );
  });
});
