/**
 * buildParsimonyReceipt + deferredRisk [#411/#5, CLM-0171] — proves the receipt
 * assembles from an evaluated decision, and that #423 is closed: a non-control
 * (508/intent) deferral still produces a non-empty controlRisk via a sentinel, so
 * the receipt's deferred invariant holds for ANY applicable unsatisfied guard.
 */
import { describe, expect, it } from 'vitest';
import { buildParsimonyReceipt, deferredRisk, type ParsimonyDecision } from './build.js';
import type { FloorCheck } from './receipt.js';

const PASS_CHECK: FloorCheck = {
  name: 'audit_logging',
  catalog: 'nist-800-53r5',
  controlIds: ['AU-2'],
  status: 'pass',
};

function decision(over: Partial<ParsimonyDecision> = {}): ParsimonyDecision {
  return {
    receiptId: '01J9ZZZZZZZZZZZZZZZZZZZZZZ',
    ts: '2026-06-21T00:00:00Z',
    loopIter: 1,
    overlay: 'agent://builder@kernloop',
    subject: 'src/x.ts:1-10',
    ladder: { rung: 2, name: 'native', outcome: 'reuse_native' },
    floorChecks: [PASS_CHECK],
    rationaleDigest: 'sha256:abc',
    verifier: 'agent://verifier@isolated',
    owner: 'agent://builder@kernloop',
    ...over,
  };
}

describe('deferredRisk — #423 sentinel for non-control deferrals', () => {
  it('returns the distinct 800-53 control ids of deferred checks', () => {
    const checks: FloorCheck[] = [
      {
        name: 'access',
        catalog: 'nist-800-53r5',
        controlIds: ['AC-3', 'IA-2'],
        status: 'deferred',
      },
      PASS_CHECK,
    ];
    expect(deferredRisk(checks).sort()).toEqual(['AC-3', 'IA-2']);
  });

  it('synthesizes a <catalog>:<name> SENTINEL for a deferred check with no control id', () => {
    const checks: FloorCheck[] = [
      { name: 'accessibility', catalog: 'section-508', controlIds: [], status: 'deferred' },
    ];
    expect(deferredRisk(checks)).toEqual(['section-508:accessibility']); // non-empty (#423)
  });

  it('is empty exactly when nothing deferred', () => {
    expect(deferredRisk([PASS_CHECK])).toEqual([]);
  });
});

describe('buildParsimonyReceipt (#411, CLM-0171)', () => {
  it('builds a valid receipt with deferred=null when the floor fully passed', () => {
    const r = buildParsimonyReceipt(decision());
    expect(r.deferred).toBeNull();
    expect(r.rung).toBe(2);
    expect(r.outcome).toBe('reuse_native');
    expect(r.verification.status).toBe('pending');
    expect(r.verification.checkedFloor).toBe(false);
  });

  it('forces a deferred block whose controlRisk is non-empty even for a 508-only miss (#423)', () => {
    const r = buildParsimonyReceipt(
      decision({
        floorChecks: [
          { name: 'accessibility', catalog: 'section-508', controlIds: [], status: 'deferred' },
        ],
      }),
    );
    // The receipt's deferred invariant (a deferred check IFF a deferred block) holds
    // BECAUSE the sentinel keeps controlRisk non-empty — this would throw pre-#423.
    expect(r.deferred?.controlRisk).toEqual(['section-508:accessibility']);
    expect(r.deferred?.debtId).toBe(r.receiptId);
  });

  it('aggregates control + sentinel risk across mixed deferred checks', () => {
    const r = buildParsimonyReceipt(
      decision({
        floorChecks: [
          { name: 'access', catalog: 'nist-800-53r5', controlIds: ['AC-3'], status: 'deferred' },
          { name: 'accessibility', catalog: 'section-508', controlIds: [], status: 'deferred' },
        ],
      }),
    );
    expect(r.deferred?.controlRisk.sort()).toEqual(['AC-3', 'section-508:accessibility']);
  });
});
