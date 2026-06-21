/**
 * Tests for the `kl:parsimony` marker grammar [#6]: the greppable format and the
 * tolerant receipt back-link parser.
 */
import { describe, expect, it } from 'vitest';
import { parsimonyMarker, parseMarker, MARKER_TAG } from './marker.js';
import type { ParsimonyReceipt } from './receipt.js';

/** A clean receipt: an applicable input-validation + audit-logging pass, no debt. */
const cleanReceipt: ParsimonyReceipt = {
  receiptId: '01J9CLEAN0000000000000000',
  ts: '2026-06-21T00:00:00.000Z',
  loopIter: 1,
  overlay: 'test',
  decisionType: 'parsimony',
  subject: 'packages/x/src/y.ts:10-20',
  rung: 2,
  outcome: 'reuse_native',
  rationaleDigest: 'sha256:abc',
  floorChecks: [
    { name: 'input_validation', catalog: 'nist-800-53r5', controlIds: ['SI-10'], status: 'pass' },
    {
      name: 'audit_logging',
      catalog: 'nist-800-53r5',
      controlIds: ['AU-2', 'AU-3', 'AU-10'],
      status: 'pass',
    },
    { name: 'intent', catalog: 'intent', controlIds: [], status: 'na' },
  ],
  deferred: null,
  verification: {
    method: 'blind_independent',
    verifier: 'v1',
    checkedFloor: false,
    status: 'pending',
  },
};

/** A deferred receipt: input_validation applied and was NOT satisfied. */
const deferredReceipt: ParsimonyReceipt = {
  ...cleanReceipt,
  receiptId: '01J9DEBT00000000000000000',
  outcome: 'minimal_impl',
  rung: 5,
  floorChecks: [
    {
      name: 'input_validation',
      catalog: 'nist-800-53r5',
      controlIds: ['SI-10'],
      status: 'deferred',
    },
    {
      name: 'accessibility',
      catalog: 'section-508',
      controlIds: [],
      status: 'deferred',
    },
  ],
  deferred: {
    debtId: '01J9DEBT00000000000000000',
    reason: 'parsimony floor deferred',
    controlRisk: ['SI-10', 'section-508:accessibility'],
    owner: 'william',
  },
};

describe('parsimonyMarker', () => {
  it('formats a clean (pass) receipt with defer=none, only applicable checks', () => {
    const marker = parsimonyMarker(cleanReceipt);
    expect(marker).toBe(
      'kl:parsimony rung=2 outcome=reuse_native floor=SI-10:pass,AU-2:pass defer=none receipt=01J9CLEAN0000000000000000',
    );
    // single-line, no na entry leaked in
    expect(marker.includes('\n')).toBe(false);
    expect(marker.includes(':na')).toBe(false);
  });

  it('formats a deferred receipt with defer=<debtId> and a :deferred floor entry', () => {
    const marker = parsimonyMarker(deferredReceipt);
    expect(marker).toContain('defer=01J9DEBT00000000000000000');
    expect(marker).toContain('SI-10:deferred');
    // non-control deferral falls back to its name handle
    expect(marker).toContain('accessibility:deferred');
    expect(marker.startsWith(MARKER_TAG)).toBe(true);
  });
});

describe('parseMarker', () => {
  it('round-trips: parseMarker(parsimonyMarker(r)).receiptId === r.receiptId', () => {
    for (const r of [cleanReceipt, deferredReceipt]) {
      const parsed = parseMarker(parsimonyMarker(r));
      expect(parsed).not.toBeNull();
      expect(parsed?.receiptId).toBe(r.receiptId);
    }
  });

  it('recovers the receipt id from a marker embedded mid-line (tolerant)', () => {
    const line = `// some code  ${parsimonyMarker(cleanReceipt)}  trailing`;
    expect(parseMarker(line)?.receiptId).toBe(cleanReceipt.receiptId);
  });

  it('returns null on a non-marker line', () => {
    expect(parseMarker('just a regular comment')).toBeNull();
    expect(parseMarker('')).toBeNull();
  });

  it('returns null on a marker tag with no receipt ref', () => {
    expect(parseMarker('kl:parsimony rung=2 outcome=skip')).toBeNull();
  });
});
