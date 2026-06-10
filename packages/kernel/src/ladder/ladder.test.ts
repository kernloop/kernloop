/**
 * Ladder suite (spec §3.1, §3.2): tier-order enforcement on routed actions
 * [CLM-0016], audited tier transitions with ratification-gated promotion to
 * enforce and automatic demotion on threshold breach [CLM-0017], with
 * audit-event assertions against the JSONL chain.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EvidenceThreshold } from '@kernloop/contracts';
import { createAuditStore, verifyChain, type AuditStore } from '../audit/index.js';
import type { AuditEnvelope } from '../audit/index.js';
import { Ladder, LadderError, TIER_ORDER, tierRank } from './ladder.js';

let dir: string;
let store: AuditStore;
let ladder: Ladder;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-ladder-'));
  store = createAuditStore(join(dir, 'audit.jsonl'), {
    clock: () => new Date('2026-06-09T00:00:00.000Z'),
  });
  ladder = new Ladder(store);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function auditEvents(): AuditEnvelope[] {
  let text = '';
  try {
    text = readFileSync(store.filePath, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AuditEnvelope);
}

const precision: EvidenceThreshold = { metric: 'precision', threshold: 0.8, windowN: 3 };

describe('tier order (spec §3.2)', () => {
  it('orders observe < suggest < advisory < enforce', () => {
    expect(TIER_ORDER.observe).toBeLessThan(TIER_ORDER.suggest);
    expect(TIER_ORDER.suggest).toBeLessThan(TIER_ORDER.advisory);
    expect(TIER_ORDER.advisory).toBeLessThan(TIER_ORDER.enforce);
    expect(tierRank('enforce')).toBe(3);
  });
});

describe('checkAction [CLM-0016]', () => {
  it('allows an action whose required tier is within actor tier and ceiling', () => {
    const decision = ladder.checkAction({
      actor: 'faculty-gates',
      actorTier: 'advisory',
      requiredTier: 'suggest',
      authorityCeiling: 'advisory',
    });
    expect(decision).toEqual({ allowed: true });
  });

  it('denies an action whose required tier exceeds the actor tier', () => {
    const decision = ladder.checkAction({
      actor: 'faculty-gates',
      actorTier: 'suggest',
      requiredTier: 'enforce',
      authorityCeiling: 'enforce',
    });
    expect(decision).toEqual({ allowed: false, reason: 'exceeds_actor_tier' });
  });

  it('denies an action whose required tier exceeds the authorityCeiling', () => {
    const decision = ladder.checkAction({
      actor: 'faculty-gates',
      actorTier: 'enforce',
      requiredTier: 'enforce',
      authorityCeiling: 'suggest',
    });
    expect(decision).toEqual({ allowed: false, reason: 'exceeds_authority_ceiling' });
  });

  it('allows when required tier equals both actor tier and ceiling', () => {
    const decision = ladder.checkAction({
      actor: 'faculty-gates',
      actorTier: 'enforce',
      requiredTier: 'enforce',
      authorityCeiling: 'enforce',
    });
    expect(decision).toEqual({ allowed: true });
  });

  it('audits every allow and every deny, and the chain verifies', () => {
    ladder.checkAction({
      actor: 'a',
      actorTier: 'advisory',
      requiredTier: 'observe',
      authorityCeiling: 'advisory',
    });
    ladder.checkAction({
      actor: 'b',
      actorTier: 'observe',
      requiredTier: 'enforce',
      authorityCeiling: 'enforce',
    });
    const events = auditEvents();
    expect(events.map((e) => e.type)).toEqual(['kernel.ladder.check', 'kernel.ladder.check']);
    expect(events[0]?.payload).toMatchObject({ actor: 'a', allowed: true, reason: null });
    expect(events[1]?.payload).toMatchObject({
      actor: 'b',
      allowed: false,
      reason: 'exceeds_actor_tier',
      actorTier: 'observe',
      requiredTier: 'enforce',
    });
    expect(verifyChain(store)).toEqual({ ok: true, length: 2 });
  });
});

describe('setTier [CLM-0017]', () => {
  it('records a ratified promotion and audits the transition', () => {
    ladder.setTier('faculty-gates', 'suggest', 'advisory', { ratifiedBy: 'williamz' });
    const [event] = auditEvents();
    expect(event?.type).toBe('kernel.ladder.tier_change');
    expect(event?.payload).toEqual({
      manifest: 'faculty-gates',
      from: 'suggest',
      to: 'advisory',
      direction: 'promotion',
      automatic: false,
      ratifiedBy: 'williamz',
    });
    expect(verifyChain(store).ok).toBe(true);
  });

  it('rejects promotion to enforce without ratifiedBy with a typed error (constitution rule 6)', () => {
    expect(() => ladder.setTier('faculty-gates', 'advisory', 'enforce')).toThrowError(
      expect.objectContaining({ name: 'LadderError', code: 'ratification_required' }) as Error,
    );
    expect(() =>
      ladder.setTier('faculty-gates', 'advisory', 'enforce', { ratifiedBy: '' }),
    ).toThrowError(LadderError);
    expect(auditEvents()).toHaveLength(0);
  });

  it('records a ratified promotion to enforce', () => {
    ladder.setTier('faculty-gates', 'advisory', 'enforce', { ratifiedBy: 'williamz' });
    const [event] = auditEvents();
    expect(event?.payload).toMatchObject({ to: 'enforce', ratifiedBy: 'williamz' });
  });

  it('audits a human-decided demotion with direction demotion and automatic false', () => {
    ladder.setTier('faculty-gates', 'advisory', 'suggest');
    const [event] = auditEvents();
    expect(event?.payload).toMatchObject({
      from: 'advisory',
      to: 'suggest',
      direction: 'demotion',
      automatic: false,
      ratifiedBy: null,
    });
  });
});

describe('recordEvidence — automatic demotion on threshold breach [CLM-0017]', () => {
  it('does not breach while the sliding window is not yet full', () => {
    ladder.setTier('faculty-gates', 'suggest', 'advisory', { ratifiedBy: 'williamz' });
    expect(ladder.recordEvidence('faculty-gates', precision, [0.1, 0.1])).toEqual({
      breached: false,
    });
  });

  it('does not breach when the window mean meets the threshold', () => {
    ladder.setTier('faculty-gates', 'suggest', 'advisory', { ratifiedBy: 'williamz' });
    expect(ladder.recordEvidence('faculty-gates', precision, [0.8, 0.8, 0.8])).toEqual({
      breached: false,
    });
    expect(auditEvents().filter((e) => e.type === 'kernel.ladder.tier_change')).toHaveLength(1);
  });

  it('demotes one tier automatically when the window mean breaches the threshold, and audits it', () => {
    ladder.setTier('faculty-gates', 'suggest', 'advisory', { ratifiedBy: 'williamz' });
    const result = ladder.recordEvidence('faculty-gates', precision, [0.9, 0.5, 0.5, 0.5]);
    expect(result).toEqual({
      breached: true,
      mean: 0.5,
      from: 'advisory',
      demotedTo: 'suggest',
    });
    const last = auditEvents().at(-1);
    expect(last?.type).toBe('kernel.ladder.tier_change');
    expect(last?.payload).toEqual({
      manifest: 'faculty-gates',
      from: 'advisory',
      to: 'suggest',
      direction: 'demotion',
      automatic: true,
      metric: 'precision',
      mean: 0.5,
      threshold: 0.8,
      windowN: 3,
    });
    expect(verifyChain(store).ok).toBe(true);
  });

  it('measures the mean over only the last windowN observations', () => {
    ladder.setTier('faculty-gates', 'suggest', 'advisory', { ratifiedBy: 'williamz' });
    // older perfect scores are outside the window; the recent three breach
    const result = ladder.recordEvidence('faculty-gates', precision, [1, 1, 1, 0.5, 0.5, 0.5]);
    expect(result.breached).toBe(true);
  });

  it('a second breach demotes one further tier', () => {
    ladder.setTier('faculty-gates', 'suggest', 'advisory', { ratifiedBy: 'williamz' });
    ladder.recordEvidence('faculty-gates', precision, [0.5, 0.5, 0.5]);
    const result = ladder.recordEvidence('faculty-gates', precision, [0.5, 0.5, 0.5]);
    expect(result).toMatchObject({ breached: true, from: 'suggest', demotedTo: 'observe' });
  });

  it('observe is the demotion floor: a breach there is audited but cannot demote further', () => {
    ladder.setTier('faculty-observer', 'suggest', 'observe');
    const result = ladder.recordEvidence('faculty-observer', precision, [0, 0, 0]);
    expect(result).toMatchObject({ breached: true, from: 'observe', demotedTo: 'observe' });
    const last = auditEvents().at(-1);
    expect(last?.payload).toMatchObject({ from: 'observe', to: 'observe', automatic: true });
  });

  it('rejects evidence for a manifest with no recorded tier with a typed error', () => {
    expect(() => ladder.recordEvidence('faculty-ghost', precision, [0, 0, 0])).toThrowError(
      expect.objectContaining({ code: 'unknown_manifest' }) as Error,
    );
  });
});
