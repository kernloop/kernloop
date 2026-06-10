import { describe, expect, it } from 'vitest';
import {
  RATIFIED_PROFILE_HASH,
  RATIFIED_SANDBOX_PROFILE,
  SandboxProfileSchema,
  canonicalJson,
  profileHash,
} from './profile.js';

describe('RATIFIED_SANDBOX_PROFILE', () => {
  it('embeds the ratified profile verbatim', () => {
    expect(RATIFIED_SANDBOX_PROFILE).toEqual({
      name: 'kernloop-toolsmith-sandbox',
      version: '1.0.0',
      image: 'node:22-alpine',
      network: 'none',
      user: 'node',
      workdir: '/scratch',
      mounts:
        'a single fresh scratch directory read-write; declared input mounts read-only; nothing else',
      memory: '512m',
      cpus: 1,
      pidsLimit: 128,
      timeoutMs: 120000,
      decayWindowDays: 30,
      liveToolCapPerOverlay: 12,
    });
    expect(Object.isFrozen(RATIFIED_SANDBOX_PROFILE)).toBe(true);
  });

  it('exports the sha256 of its canonical JSON as RATIFIED_PROFILE_HASH', () => {
    expect(RATIFIED_PROFILE_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(profileHash(RATIFIED_SANDBOX_PROFILE)).toBe(RATIFIED_PROFILE_HASH);
  });

  it('hashes independently of key order (canonical JSON)', () => {
    const reordered = SandboxProfileSchema.parse(
      Object.fromEntries(Object.entries(RATIFIED_SANDBOX_PROFILE).reverse()),
    );
    expect(profileHash(reordered)).toBe(RATIFIED_PROFILE_HASH);
  });

  it('changes hash for any tampered field', () => {
    const tampered = SandboxProfileSchema.parse({
      ...RATIFIED_SANDBOX_PROFILE,
      timeoutMs: 999999,
    });
    expect(profileHash(tampered)).not.toBe(RATIFIED_PROFILE_HASH);
  });

  it('rejects a profile with any network mode other than none', () => {
    expect(
      SandboxProfileSchema.safeParse({ ...RATIFIED_SANDBOX_PROFILE, network: 'bridge' }).success,
    ).toBe(false);
  });
});

describe('canonicalJson', () => {
  it('sorts object keys recursively and preserves array order', () => {
    expect(canonicalJson({ b: [{ z: 1, a: 2 }], a: 'x' })).toBe('{"a":"x","b":[{"a":2,"z":1}]}');
  });

  it('drops undefined-valued keys like JSON.stringify does', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});
