import { describe, expect, it } from 'vitest';
import { VerdictResultSchema, VerdictSchema, type Verdict } from './verdict.js';

const valid: Verdict = {
  taskId: 'task-001',
  gate: 'quality',
  result: 'approve',
  confidence: 0.9,
  findings: [{ severity: 'warn', message: 'coverage near floor', path: 'src/index.ts' }],
  voters: [{ voter: 'claude', vote: 'approve', reasoning: 'all checks green' }],
  cost: { tokens: 800, usd: 0.02, wallClockMs: 1200 },
};

describe('VerdictResultSchema', () => {
  it('accepts all five result values', () => {
    for (const result of ['approve', 'reject', 'abstain', 'pass', 'fail']) {
      expect(VerdictResultSchema.parse(result)).toBe(result);
    }
  });

  it('rejects unknown result values', () => {
    for (const bad of ['approved', 'PASS', 'maybe', '', null]) {
      expect(VerdictResultSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('VerdictSchema', () => {
  it('parses a valid Verdict', () => {
    expect(VerdictSchema.parse(valid)).toEqual(valid);
  });

  it('parses without the optional voters field', () => {
    const solo: Record<string, unknown> = { ...valid };
    delete solo['voters'];
    expect(VerdictSchema.parse(solo)).toEqual(solo);
  });

  it('round-trips through JSON serialization', () => {
    expect(VerdictSchema.parse(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it('rejects when a required field is missing', () => {
    for (const field of ['taskId', 'gate', 'result', 'confidence', 'findings', 'cost']) {
      const broken: Record<string, unknown> = { ...valid };
      delete broken[field];
      expect(VerdictSchema.safeParse(broken).success).toBe(false);
    }
  });

  it('rejects an unknown result enum value', () => {
    expect(VerdictSchema.safeParse({ ...valid, result: 'lgtm' }).success).toBe(false);
  });

  it('rejects confidence outside [0, 1] and non-numeric confidence', () => {
    expect(VerdictSchema.safeParse({ ...valid, confidence: -0.1 }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...valid, confidence: 1.1 }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...valid, confidence: 'high' }).success).toBe(false);
  });

  it('rejects malformed findings and voter records', () => {
    const badFinding = [{ severity: 'critical', message: 'x' }];
    expect(VerdictSchema.safeParse({ ...valid, findings: badFinding }).success).toBe(false);
    const badVoter = [{ voter: 'claude', vote: 'veto', reasoning: '' }];
    expect(VerdictSchema.safeParse({ ...valid, voters: badVoter }).success).toBe(false);
  });

  it('rejects negative cost and unknown keys', () => {
    expect(VerdictSchema.safeParse({ ...valid, cost: { tokens: -1, usd: 0 } }).success).toBe(false);
    expect(VerdictSchema.safeParse({ ...valid, blocking: true }).success).toBe(false);
  });
});
