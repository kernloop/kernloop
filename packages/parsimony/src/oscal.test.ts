/**
 * The HONESTY PROOF for the parsimony OSCAL projection [#8/#414, EPIC #407].
 *
 * The point of #8 is that a parsimony decision emits catalog-mapped, schema-VALID
 * OSCAL assessment evidence. So these tests load the VENDORED, OFFICIAL, UNMODIFIED
 * NIST OSCAL Assessment Results JSON Schema (`schemas/oscal_assessment-results_schema.json`,
 * OSCAL v1.1.3 — provenance in `schemas/README.md`), compile it with `ajv`
 * (+ `ajv-formats` for the `date-time`/`uri-reference` formats the schema declares),
 * and assert `toOscalAssessmentResults(...)` output validates against the REAL schema.
 * If ajv reports errors, the projection is wrong — the failing test is the signal,
 * never a licence to weaken the schema or the claim.
 *
 * Source: https://github.com/usnistgov/OSCAL/releases/download/v1.1.3/oscal_assessment-results_schema.json
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv';
import addFormats from 'ajv-formats';
import { beforeAll, describe, expect, it } from 'vitest';
import { isSentinelRisk, toOscalAssessmentResults, type OscalMeta } from './oscal.js';
import type { ParsimonyReceipt } from './receipt.js';

const SCHEMA_PATH = fileURLToPath(
  new URL('../schemas/oscal_assessment-results_schema.json', import.meta.url),
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Record<string, any>;

const META: OscalMeta = {
  uuid: '11111111-1111-4111-8111-111111111111',
  lastModified: '2026-06-21T00:00:00Z',
};

// The vendored schema is draft-07; the default Ajv export targets draft-07/2019.
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

/** Validate + surface ajv errors so a failure shows EXACTLY what is not OSCAL. */
function expectValid(doc: unknown): void {
  const ok = validate(doc);
  if (!ok) throw new Error(`OSCAL schema validation failed:\n${ajv.errorsText(validate.errors)}`);
  expect(ok).toBe(true);
}

describe('the vendored OSCAL validator genuinely DISCRIMINATES (not vacuous)', () => {
  // Without this, every `expectValid` below could pass against a no-op validator that
  // accepts anything — making the whole "validates against the real OSCAL schema" claim
  // hollow. These prove the compiled schema actually rejects non-OSCAL input.
  it('rejects an empty object, a garbage object, and a doc missing required fields', () => {
    expect(validate({})).toBe(false);
    expect(validate({ foo: 1 })).toBe(false);
    // a near-miss: the right top key but a non-UUID id + no required metadata/results
    expect(validate({ 'assessment-results': { uuid: 'not-a-uuid' } })).toBe(false);
  });
});

/** A clean receipt: applicable floor checks all PASS, no deferral, pending verify. */
const cleanReceipt: ParsimonyReceipt = {
  receiptId: '01J9CLEAN0000000000000000',
  ts: '2026-06-21T00:00:00Z',
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
      controlIds: ['AU-2', 'AU-3'],
      status: 'pass',
      evidenceRef: 'test:foo.test.ts::logs',
    },
    { name: 'intent', catalog: 'intent', controlIds: [], status: 'na' },
  ],
  deferred: null,
  verification: {
    method: 'blind_independent',
    verifier: 'v1',
    checkedFloor: true,
    status: 'confirmed',
  },
};

/** A receipt whose deferral risks a real NIST 800-53 control (bare token `AC-3`). */
const nistDeferralReceipt: ParsimonyReceipt = {
  ...cleanReceipt,
  receiptId: '01J9NIST00000000000000000',
  subject: 'packages/x/src/auth.ts:1-40',
  floorChecks: [
    { name: 'access_control', catalog: 'nist-800-53r5', controlIds: ['AC-3'], status: 'deferred' },
  ],
  deferred: {
    debtId: 'DEBT-NIST-1',
    reason: 'access-control check skipped pending review',
    controlRisk: ['AC-3'],
    owner: 'alice',
  },
};

/** A receipt whose deferral is a Section-508 SENTINEL (`section-508:accessibility`) —
 * a real deferral with NO 800-53 control, so its finding must carry NO control link. */
const sentinelDeferralReceipt: ParsimonyReceipt = {
  ...cleanReceipt,
  receiptId: '01J9508000000000000000000',
  subject: 'packages/ui/src/button.tsx:1-30',
  floorChecks: [
    { name: 'accessibility', catalog: 'section-508', controlIds: [], status: 'deferred' },
  ],
  deferred: {
    debtId: 'DEBT-508-1',
    reason: 'aria labels deferred',
    controlRisk: ['section-508:accessibility'],
    owner: 'bob',
  },
};

/** A receipt whose blind verification was REFUTED — yields control-linked findings. */
const refutedReceipt: ParsimonyReceipt = {
  ...cleanReceipt,
  receiptId: '01J9REFUTED000000000000000',
  subject: 'packages/x/src/z.ts:5-9',
  floorChecks: [
    { name: 'input_validation', catalog: 'nist-800-53r5', controlIds: ['SI-10'], status: 'pass' },
  ],
  deferred: null,
  verification: {
    method: 'blind_independent',
    verifier: 'v2',
    checkedFloor: true,
    status: 'refuted',
  },
};

describe('toOscalAssessmentResults — validates against the REAL vendored NIST OSCAL schema', () => {
  beforeAll(() => {
    // Confirm we vendored the real schema, not a hand-rolled subset.
    expect(schema.$id).toContain('oscal');
    expect(schema.required).toContain('assessment-results');
  });

  it('(a) all-pass floor → observations, no findings — valid OSCAL', () => {
    const doc = toOscalAssessmentResults([cleanReceipt], META);
    expectValid(doc);
    const result = doc['assessment-results'].results[0];
    expect(result.observations).toHaveLength(2); // the two applicable checks; `na` omitted
    expect(result.findings).toBeUndefined();
  });

  it('(b) NIST-control deferral → a finding linked to the control id — valid OSCAL', () => {
    const doc = toOscalAssessmentResults([nistDeferralReceipt], META);
    expectValid(doc);
    const f = doc['assessment-results'].results[0].findings ?? [];
    expect(f).toHaveLength(1);
    expect(f[0].target.type).toBe('objective-id');
    expect(f[0].target['target-id']).toBe('AC-3');
    expect(f[0].props?.some((p) => p.name === 'control-id' && p.value === 'AC-3')).toBe(true);
  });

  it('(c) 508 SENTINEL deferral → a finding WITHOUT a NIST control link — valid OSCAL', () => {
    const doc = toOscalAssessmentResults([sentinelDeferralReceipt], META);
    expectValid(doc);
    const f = doc['assessment-results'].results[0].findings ?? [];
    expect(f).toHaveLength(1);
    expect(f[0].target.type).toBe('statement-id'); // NOT objective-id → no control link
    expect(f[0].props?.some((p) => p.name === 'control-id')).toBe(false);
    expect(
      f[0].props?.some(
        (p) => p.name === 'non-control-risk' && p.value === 'section-508:accessibility',
      ),
    ).toBe(true);
    // reviewed-controls must NOT name the sentinel as a control.
    const sel = doc['assessment-results'].results[0]['reviewed-controls']['control-selections'][0];
    expect(sel['include-all']).toEqual({});
  });

  it('(d) refuted verification → control-linked findings — valid OSCAL', () => {
    const doc = toOscalAssessmentResults([refutedReceipt], META);
    expectValid(doc);
    const f = doc['assessment-results'].results[0].findings ?? [];
    expect(f).toHaveLength(1);
    expect(f[0].target['target-id']).toBe('SI-10');
    expect(f[0].target.status.state).toBe('not-satisfied');
  });

  it('(e) multiple receipts → one valid OSCAL document aggregating all', () => {
    const doc = toOscalAssessmentResults(
      [cleanReceipt, nistDeferralReceipt, sentinelDeferralReceipt, refutedReceipt],
      META,
    );
    expectValid(doc);
    const result = doc['assessment-results'].results[0];
    expect((result.findings ?? []).length).toBe(3); // AC-3, sentinel, SI-10
    // reviewed-controls names the bare controls (AC-3, SI-10) but not the sentinel.
    const sel = result['reviewed-controls']['control-selections'][0];
    const ids = (sel['include-controls'] ?? []).map((c) => c['control-id']);
    expect(ids).toContain('AC-3');
    expect(ids).toContain('SI-10');
    expect(ids.some((id) => id.includes(':'))).toBe(false);
  });

  it('produces deterministic output for identical inputs (pure)', () => {
    const a = toOscalAssessmentResults([nistDeferralReceipt], META);
    const b = toOscalAssessmentResults([nistDeferralReceipt], META);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('an empty receipt set is still a valid OSCAL document', () => {
    expectValid(toOscalAssessmentResults([], META));
  });

  it('a refuted receipt ignores `na` floor checks when building findings', () => {
    const refutedWithNa: ParsimonyReceipt = {
      ...refutedReceipt,
      receiptId: '01J9REFNA00000000000000000',
      floorChecks: [
        {
          name: 'input_validation',
          catalog: 'nist-800-53r5',
          controlIds: ['SI-10'],
          status: 'pass',
        },
        { name: 'access_control', catalog: 'nist-800-53r5', controlIds: ['AC-3'], status: 'na' },
      ],
    };
    const doc = toOscalAssessmentResults([refutedWithNa], META);
    expectValid(doc);
    const f = doc['assessment-results'].results[0].findings ?? [];
    // SI-10 (applicable) → finding; AC-3 (`na`) → no finding.
    expect(f.map((x) => x.target['target-id'])).toEqual(['SI-10']);
  });
});

describe('isSentinelRisk — the bare-control vs sentinel disambiguation (#423)', () => {
  it('a bare NIST control id (AC-3) is NOT a sentinel → links to a control', () => {
    expect(isSentinelRisk('AC-3')).toBe(false);
    expect(isSentinelRisk('SI-10')).toBe(false);
  });

  it('a <catalog>:<name> sentinel token IS a sentinel → no control link', () => {
    expect(isSentinelRisk('section-508:accessibility')).toBe(true);
    expect(isSentinelRisk('wcag:contrast')).toBe(true);
    expect(isSentinelRisk('intent:scope')).toBe(true);
    expect(isSentinelRisk('nist-800-53r5:custom')).toBe(true);
  });
});
