/**
 * Review-gate manifest tests (CLM-0047): the registration record parses,
 * stays at advisory tier, and carries the Epic-E promotion criterion.
 */
import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '@kernloop/contracts';
import { PROMOTION_CRITERION } from './calibrate.js';
import { reviewGateManifest } from './manifest.js';

describe('reviewGateManifest', () => {
  it('parses through ManifestSchema', () => {
    expect(ManifestSchema.safeParse(reviewGateManifest).success).toBe(true);
  });

  it('registers the review gate capability under its own name', () => {
    expect(reviewGateManifest.name).toBe('@kernloop/faculty-gates/review');
    expect(reviewGateManifest.kind).toBe('gate');
    expect(reviewGateManifest.capabilities.map((c) => c.name)).toEqual(['gate.review']);
  });

  it('consumes TaskContract + Brief and emits Verdict', () => {
    expect(reviewGateManifest.contracts).toEqual({
      consumes: ['TaskContract', 'Brief'],
      emits: ['Verdict'],
    });
  });

  it('declares advisory tier with the Epic-E promotion criterion', () => {
    expect(reviewGateManifest.tier).toBe('advisory');
    expect(reviewGateManifest.promotion).toEqual(PROMOTION_CRITERION);
  });

  it('is stable and backed by the review-gate claims', () => {
    expect(reviewGateManifest.maturity).toBe('stable');
    expect(reviewGateManifest.claims).toEqual(['CLM-0047', 'CLM-0048']);
  });

  it('declares modelTier cheap — adversarial diff reading runs on cheap models (spec §8.4)', () => {
    expect(reviewGateManifest.modelTier).toBe('cheap');
  });
});
