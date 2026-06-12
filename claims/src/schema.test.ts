import { describe, expect, it } from 'vitest';
import { ClaimSchema, EvidenceRefSchema, parseEvidenceRef } from './schema.js';

const validClaim = {
  id: 'CLM-0001',
  statement: 'Contracts are zod-validated: malformed messages are rejected at parse time.',
  evidence: ['test:packages/contracts/src/task-contract.test.ts::rejects wrong field types'],
  status: 'verified',
  owner: 'williamzujkowski',
  since: '0.1.0',
};

describe('parseEvidenceRef', () => {
  it('parses a test ref into path and test name', () => {
    expect(parseEvidenceRef('test:a/b.test.ts::does the thing')).toEqual({
      kind: 'test',
      raw: 'test:a/b.test.ts::does the thing',
      path: 'a/b.test.ts',
      testName: 'does the thing',
    });
  });

  it('parses a ci ref into a job name', () => {
    expect(parseEvidenceRef('ci:test')).toEqual({ kind: 'ci', raw: 'ci:test', job: 'test' });
  });

  it('parses a doc ref into path and anchor', () => {
    expect(parseEvidenceRef('doc:README.md#claims')).toEqual({
      kind: 'doc',
      raw: 'doc:README.md#claims',
      path: 'README.md',
      anchor: 'claims',
    });
  });

  it('parses an eval ref into an artifact path', () => {
    expect(parseEvidenceRef('eval:evals/review-set.json')).toEqual({
      kind: 'eval',
      raw: 'eval:evals/review-set.json',
      path: 'evals/review-set.json',
    });
  });

  it('parses a code ref into a path and symbol (no doc pattern)', () => {
    expect(parseEvidenceRef('code:src/router.ts#Router.route')).toEqual({
      kind: 'code',
      raw: 'code:src/router.ts#Router.route',
      path: 'src/router.ts',
      symbol: 'Router.route',
    });
  });

  it('parses a code ref with an @doc regex', () => {
    expect(parseEvidenceRef('code:src/loop.ts#CANONICAL_LOOP@doc:/canonical loop/')).toEqual({
      kind: 'code',
      raw: 'code:src/loop.ts#CANONICAL_LOOP@doc:/canonical loop/',
      path: 'src/loop.ts',
      symbol: 'CANONICAL_LOOP',
      docPattern: 'canonical loop',
    });
  });

  it('rejects refs with an unknown kind prefix', () => {
    expect(parseEvidenceRef('bench:foo')).toHaveProperty('error');
  });

  it('rejects malformed test, ci, doc, eval, and code refs', () => {
    expect(parseEvidenceRef('test:no-separator')).toHaveProperty('error');
    expect(parseEvidenceRef('test:::name-without-path')).toHaveProperty('error');
    expect(parseEvidenceRef('ci:')).toHaveProperty('error');
    expect(parseEvidenceRef('doc:README.md')).toHaveProperty('error');
    expect(parseEvidenceRef('doc:README.md#')).toHaveProperty('error');
    expect(parseEvidenceRef('eval:')).toHaveProperty('error');
    expect(parseEvidenceRef('code:src/router.ts')).toHaveProperty('error');
    expect(parseEvidenceRef('code:src/router.ts#')).toHaveProperty('error');
    expect(parseEvidenceRef('code:#Router')).toHaveProperty('error');
    expect(parseEvidenceRef('code:src/a.ts#Foo@doc:/unterminated')).toHaveProperty('error');
    expect(parseEvidenceRef('code:src/a.ts#Foo@doc://')).toHaveProperty('error');
  });
});

describe('EvidenceRefSchema', () => {
  it('transforms a raw string into its discriminated form', () => {
    expect(EvidenceRefSchema.parse('ci:test')).toEqual({ kind: 'ci', raw: 'ci:test', job: 'test' });
  });

  it('rejects malformed refs with the parse error message', () => {
    const result = EvidenceRefSchema.safeParse('nope');
    expect(result.success).toBe(false);
  });
});

describe('ClaimSchema', () => {
  it('parses a valid claim and parses its evidence refs', () => {
    const claim = ClaimSchema.parse(validClaim);
    expect(claim.evidence[0]?.kind).toBe('test');
    expect(claim.status).toBe('verified');
  });

  it('rejects a malformed id', () => {
    expect(ClaimSchema.safeParse({ ...validClaim, id: 'CLM-1' }).success).toBe(false);
    expect(ClaimSchema.safeParse({ ...validClaim, id: 'clm-0001' }).success).toBe(false);
  });

  it('rejects a multi-line or unterminated statement', () => {
    expect(ClaimSchema.safeParse({ ...validClaim, statement: 'two\nlines.' }).success).toBe(false);
    expect(
      ClaimSchema.safeParse({ ...validClaim, statement: 'no terminal punctuation' }).success,
    ).toBe(false);
  });

  it('rejects an empty evidence array', () => {
    expect(ClaimSchema.safeParse({ ...validClaim, evidence: [] }).success).toBe(false);
    expect(
      ClaimSchema.safeParse({ ...validClaim, status: 'experimental', evidence: [] }).success,
    ).toBe(false);
  });

  it('accepts a planned claim with an empty evidence array', () => {
    const claim = ClaimSchema.parse({ ...validClaim, status: 'planned', evidence: [] });
    expect(claim.status).toBe('planned');
    expect(claim.evidence).toEqual([]);
  });

  it('still parses evidence refs present on a planned claim', () => {
    const claim = ClaimSchema.parse({ ...validClaim, status: 'planned' });
    expect(claim.evidence[0]?.kind).toBe('test');
  });

  it('rejects an unknown status value', () => {
    expect(ClaimSchema.safeParse({ ...validClaim, status: 'aspirational' }).success).toBe(false);
  });

  it('rejects a malformed owner handle and a non-semver since', () => {
    expect(ClaimSchema.safeParse({ ...validClaim, owner: '-bad' }).success).toBe(false);
    expect(ClaimSchema.safeParse({ ...validClaim, since: 'v0.1' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(ClaimSchema.safeParse({ ...validClaim, confidence: 1 }).success).toBe(false);
  });
});
