/**
 * Parsimony Decision Receipt schema [#408, CLM-0168]. The receipt is the PAYLOAD of
 * a `parsimony.receipt` audit event — these tests pin its shape: a valid receipt
 * round-trips, a malformed one THROWS (never coerced), the floor is genuinely
 * multi-catalog (not 800-53-only), and the deferred-floor invariant is detectable.
 */
import { describe, expect, it } from 'vitest';
import {
  PARSIMONY_RECEIPT_EVENT,
  hasDeferredFloor,
  parseParsimonyReceipt,
  type ParsimonyReceipt,
} from './receipt.js';

function valid(over: Partial<ParsimonyReceipt> = {}): ParsimonyReceipt {
  return {
    receiptId: '01J9ZZZZZZZZZZZZZZZZZZZZZZ',
    ts: '2026-06-21T00:00:00Z',
    loopIter: 42,
    overlay: 'agent://builder@kernloop',
    decisionType: 'parsimony',
    subject: 'src/loop/commit.ts:88-120',
    rung: 2,
    outcome: 'reuse_native',
    rationaleDigest: 'sha256:abc',
    floorChecks: [
      { name: 'input_validation', catalog: 'nist-800-53r5', controlIds: ['SI-10'], status: 'pass' },
      {
        name: 'audit_logging',
        catalog: 'nist-800-53r5',
        controlIds: ['AU-2', 'AU-3'],
        status: 'pass',
      },
    ],
    deferred: null,
    verification: {
      method: 'blind_independent',
      verifier: 'agent://verifier@isolated',
      checkedFloor: true,
      status: 'confirmed',
    },
    ...over,
  };
}

describe('ParsimonyReceipt schema (#408, CLM-0168)', () => {
  it('round-trips a valid receipt through parse without mutation', () => {
    const receipt = valid();
    const parsed = parseParsimonyReceipt(JSON.parse(JSON.stringify(receipt)));
    expect(parsed).toEqual(receipt);
  });

  it('the event type rides the existing hash-chained audit log', () => {
    expect(PARSIMONY_RECEIPT_EVENT).toBe('parsimony.receipt');
  });

  it('is MULTI-CATALOG — accepts a Section-508 floor entry with NO 800-53 control id', () => {
    const r = valid({
      floorChecks: [
        { name: 'accessibility', catalog: 'section-508', controlIds: [], status: 'pass' },
        { name: 'requested', catalog: 'intent', controlIds: [], status: 'pass' },
      ],
    });
    expect(parseParsimonyReceipt(r).floorChecks[0]?.catalog).toBe('section-508');
  });

  it('THROWS on an unknown catalog — a floor entry cannot lie about its catalog', () => {
    const r = {
      ...valid(),
      floorChecks: [{ name: 'x', catalog: 'pci-dss', controlIds: [], status: 'pass' }],
    };
    expect(() => parseParsimonyReceipt(r)).toThrow();
  });

  it('THROWS on an unknown field (strict) and a rung out of 0..5', () => {
    expect(() => parseParsimonyReceipt({ ...valid(), extra: 1 })).toThrow();
    expect(() => parseParsimonyReceipt({ ...valid(), rung: 6 })).toThrow();
  });

  it('a deferred shortcut is a first-class block with its control risk', () => {
    const r = valid({
      floorChecks: [
        {
          name: 'access_enforcement',
          catalog: 'nist-800-53r5',
          controlIds: ['AC-3'],
          status: 'deferred',
        },
      ],
      deferred: {
        debtId: 'debt-1',
        reason: 'authZ check skipped under YAGNI',
        controlRisk: ['AC-3'],
        owner: 'agent://builder@kernloop',
      },
    });
    const parsed = parseParsimonyReceipt(r);
    expect(hasDeferredFloor(parsed)).toBe(true);
    expect(parsed.deferred?.controlRisk).toEqual(['AC-3']);
  });

  it('hasDeferredFloor is false when every applicable floor entry passed', () => {
    expect(hasDeferredFloor(valid())).toBe(false);
  });

  it('enforces the DEFERRED INVARIANT: a deferred-status check with no deferred block THROWS', () => {
    const r = valid({
      floorChecks: [
        { name: 'access', catalog: 'nist-800-53r5', controlIds: ['AC-3'], status: 'deferred' },
      ],
      deferred: null, // lies: a control was deferred but no debt recorded
    });
    expect(() => parseParsimonyReceipt(r)).toThrow(/deferred invariant/);
  });

  it('enforces the DEFERRED INVARIANT: a deferred block with no deferred-status check THROWS', () => {
    const r = valid({
      // all checks pass, yet a debt block is present — the record would lie
      deferred: { debtId: 'd', reason: 'x', controlRisk: ['AC-3'], owner: 'a' },
    });
    expect(() => parseParsimonyReceipt(r)).toThrow(/deferred invariant/);
  });

  it('rejects a verification method other than blind_independent', () => {
    const r = { ...valid(), verification: { ...valid().verification, method: 'self_attested' } };
    expect(() => parseParsimonyReceipt(r)).toThrow();
  });
});

describe('ParsimonyReceiptSchema is the payload only (chain fields excluded)', () => {
  it('REJECTS chain fields (prevHash/hash/seq) — those come from the audit envelope', () => {
    // strict: a payload carrying envelope-owned chain fields is invalid, never coerced.
    expect(() => parseParsimonyReceipt({ ...valid(), prevHash: 'sha256:x' })).toThrow();
    expect(() => parseParsimonyReceipt({ ...valid(), hash: 'sha256:y' })).toThrow();
    expect(() => parseParsimonyReceipt({ ...valid(), seq: 7 })).toThrow();
  });
});
