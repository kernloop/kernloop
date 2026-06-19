/**
 * #328 Inc1 (CLM-0152): the composition root derives the engine's
 * `reviewDrivesIteration` from the review gate's AUTHORITY-LADDER tier — the
 * ratification-guarded source — not the static manifest tier. These tests pin
 * the derivation in isolation: behaviour stays advisory (false) until a ratified
 * `setTier`→`enforce` promotion records the gate at enforce.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Ladder, createAuditStore } from '@kernloop/kernel';
import { reviewGateManifest, voteGateManifest } from '@kernloop/faculty-gates';
import { reviewGateDrivesIteration } from './engine-build.js';

describe('reviewGateDrivesIteration (#328 Inc1, CLM-0152)', () => {
  let dir: string;
  let ladder: Ladder;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kl-rev-drives-'));
    const store = createAuditStore(join(dir, 'audit.jsonl'), {
      clock: () => new Date('2026-06-19T00:00:00.000Z'),
    });
    ladder = new Ladder(store);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is false when the review gate is unseen or non-enforce (default — review stays a non-blocking hint)', () => {
    // Unseen ⇒ tierOf undefined ⇒ false (preserves the CLM-0064 honesty guard).
    expect(reviewGateDrivesIteration({ ladder })).toBe(false);
    // Seeded/declared advisory ⇒ still false.
    ladder.setTier(reviewGateManifest.name, 'suggest', 'advisory');
    expect(reviewGateDrivesIteration({ ladder })).toBe(false);
  });

  it('is true ONLY after a ratified enforce promotion of the review gate (the #328 Inc2 path)', () => {
    ladder.setTier(reviewGateManifest.name, 'advisory', 'enforce', {
      ratifiedBy: 'consensus_vote:2026-06-19',
    });
    expect(reviewGateDrivesIteration({ ladder })).toBe(true);
  });

  it('keys on the REVIEW gate specifically — an enforce VOTE gate does not flip review iteration', () => {
    ladder.setTier(voteGateManifest.name, 'advisory', 'enforce', { ratifiedBy: 'x' });
    expect(reviewGateDrivesIteration({ ladder })).toBe(false);
  });
});
