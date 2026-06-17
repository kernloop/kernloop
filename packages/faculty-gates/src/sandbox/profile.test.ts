/**
 * Ratified gate-profile invariants (#236): the profile is a valid exec profile,
 * `--network none` is structural, the image is DIGEST-pinned, and the hash is a
 * stable content gate (any field change is a deliberate re-ratification).
 */
import { describe, expect, it } from 'vitest';
import {
  GATE_IMAGE,
  RATIFIED_GATE_PROFILE,
  RATIFIED_GATE_PROFILE_HASH,
  gateProfileHash,
} from './profile.js';

describe('RATIFIED_GATE_PROFILE (#236)', () => {
  it('is network:none, non-root, and capped', () => {
    expect(RATIFIED_GATE_PROFILE.network).toBe('none');
    expect(RATIFIED_GATE_PROFILE.user).not.toBe('root');
    expect(RATIFIED_GATE_PROFILE.user).toBe('node');
    expect(RATIFIED_GATE_PROFILE.pidsLimit).toBeGreaterThan(0);
    expect(RATIFIED_GATE_PROFILE.memory).toMatch(/^\d+[bkmg]$/);
    expect(RATIFIED_GATE_PROFILE.cpus).toBeGreaterThan(0);
    expect(RATIFIED_GATE_PROFILE.timeoutMs).toBeGreaterThan(0);
  });

  it('pins the image by digest (not a mutable tag)', () => {
    expect(GATE_IMAGE).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(RATIFIED_GATE_PROFILE.image).toBe(GATE_IMAGE);
  });

  it('hash is stable and content-bound (a changed field changes the hash)', () => {
    expect(RATIFIED_GATE_PROFILE_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(gateProfileHash(RATIFIED_GATE_PROFILE)).toBe(RATIFIED_GATE_PROFILE_HASH);
    const tampered = { ...RATIFIED_GATE_PROFILE, memory: '8g' as const };
    expect(gateProfileHash(tampered)).not.toBe(RATIFIED_GATE_PROFILE_HASH);
  });
});
