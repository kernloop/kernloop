import { describe, expect, it } from 'vitest';
import {
  CapabilitySchema,
  CheckSchema,
  ClaimRefSchema,
  ContractRefSchema,
  CostProfileSchema,
  CostSchema,
  EvidenceRequirementSchema,
  EvidenceThresholdSchema,
  FindingSchema,
  MaturitySchema,
  SignalSchema,
  SourceSchema,
  TierSchema,
} from './common.js';

describe('TierSchema', () => {
  it('accepts each of the four ladder tiers', () => {
    for (const tier of ['observe', 'suggest', 'advisory', 'enforce']) {
      expect(TierSchema.parse(tier)).toBe(tier);
    }
  });

  it('rejects unknown tier values', () => {
    for (const bad of ['admin', 'OBSERVE', 'enforced', '', 4, null, undefined]) {
      expect(TierSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('MaturitySchema', () => {
  it('accepts experimental and stable', () => {
    expect(MaturitySchema.parse('experimental')).toBe('experimental');
    expect(MaturitySchema.parse('stable')).toBe('stable');
  });

  it('rejects unknown maturity values', () => {
    for (const bad of ['beta', 'Stable', '', 1, null]) {
      expect(MaturitySchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('ContractRefSchema', () => {
  it('accepts exactly the frozen five names', () => {
    for (const name of ['TaskContract', 'Brief', 'Verdict', 'Outcome', 'Manifest']) {
      expect(ContractRefSchema.parse(name)).toBe(name);
    }
  });

  it('rejects anything that is not one of the five', () => {
    for (const bad of ['taskcontract', 'Event', 'Claim', '', null]) {
      expect(ContractRefSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('ClaimRefSchema', () => {
  it('accepts CLM-NNNN claim ids', () => {
    expect(ClaimRefSchema.parse('CLM-0001')).toBe('CLM-0001');
    expect(ClaimRefSchema.parse('CLM-9999')).toBe('CLM-9999');
  });

  it('rejects malformed claim ids', () => {
    for (const bad of ['CLM-1', 'CLM-00001', 'clm-0001', 'CLM_0001', 'CLM-00a1', '', 1]) {
      expect(ClaimRefSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('EvidenceRequirementSchema', () => {
  it('accepts a typed evidence ref', () => {
    const v = { kind: 'test', ref: 'packages/contracts/src/common.test.ts::x' };
    expect(EvidenceRequirementSchema.parse(v)).toEqual(v);
  });

  it('rejects unknown kinds, empty refs, and missing fields', () => {
    expect(EvidenceRequirementSchema.safeParse({ kind: 'vibe', ref: 'x' }).success).toBe(false);
    expect(EvidenceRequirementSchema.safeParse({ kind: 'test', ref: '' }).success).toBe(false);
    expect(EvidenceRequirementSchema.safeParse({ kind: 'test' }).success).toBe(false);
  });
});

describe('CheckSchema', () => {
  it('accepts a named command check', () => {
    const v = { name: 'typecheck', command: 'pnpm typecheck' };
    expect(CheckSchema.parse(v)).toEqual(v);
  });

  it('rejects empty names, missing command, and unknown keys', () => {
    expect(CheckSchema.safeParse({ name: '', command: 'x' }).success).toBe(false);
    expect(CheckSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(CheckSchema.safeParse({ name: 'x', command: 'y', shell: 'sh' }).success).toBe(false);
  });
});

describe('SourceSchema', () => {
  it('accepts a provenance ref and rejects empty/missing refs', () => {
    expect(SourceSchema.parse({ ref: 'memory:abc' })).toEqual({ ref: 'memory:abc' });
    expect(SourceSchema.safeParse({ ref: '' }).success).toBe(false);
    expect(SourceSchema.safeParse({}).success).toBe(false);
  });
});

describe('FindingSchema', () => {
  it('accepts severity-tagged findings, with and without path', () => {
    expect(FindingSchema.parse({ severity: 'info', message: 'ok' }).path).toBeUndefined();
    const v = { severity: 'blocker', message: 'broken', path: 'src/a.ts' };
    expect(FindingSchema.parse(v)).toEqual(v);
  });

  it('rejects unknown severities and empty messages', () => {
    expect(FindingSchema.safeParse({ severity: 'fatal', message: 'x' }).success).toBe(false);
    expect(FindingSchema.safeParse({ severity: 'warn', message: '' }).success).toBe(false);
  });
});

describe('CostSchema', () => {
  it('accepts totals with optional wallClockMs and byAdapter breakdown', () => {
    const v = {
      tokens: 1200,
      usd: 0.42,
      wallClockMs: 5300,
      byAdapter: { claude: { tokens: 1200, usd: 0.42 } },
    };
    expect(CostSchema.parse(v)).toEqual(v);
    expect(CostSchema.parse({ tokens: 0, usd: 0 })).toEqual({ tokens: 0, usd: 0 });
  });

  it('rejects negative or fractional-token costs', () => {
    expect(CostSchema.safeParse({ tokens: -1, usd: 0 }).success).toBe(false);
    expect(CostSchema.safeParse({ tokens: 1.5, usd: 0 }).success).toBe(false);
    expect(CostSchema.safeParse({ tokens: 0, usd: -0.01 }).success).toBe(false);
    expect(CostSchema.safeParse({ tokens: 0, usd: 0, wallClockMs: -1 }).success).toBe(false);
    const badAdapter = { tokens: 0, usd: 0, byAdapter: { claude: { tokens: -1, usd: 0 } } };
    expect(CostSchema.safeParse(badAdapter).success).toBe(false);
  });
});

describe('SignalSchema', () => {
  it('accepts a named pass/fail signal with optional detail', () => {
    const v = { name: 'tests', passed: true, detail: '212/212' };
    expect(SignalSchema.parse(v)).toEqual(v);
  });

  it('rejects missing passed flag and non-boolean values', () => {
    expect(SignalSchema.safeParse({ name: 'tests' }).success).toBe(false);
    expect(SignalSchema.safeParse({ name: 'tests', passed: 'yes' }).success).toBe(false);
  });
});

describe('CapabilitySchema', () => {
  it('accepts a named capability and rejects empty names', () => {
    expect(CapabilitySchema.parse({ name: 'compile-brief' })).toEqual({ name: 'compile-brief' });
    expect(CapabilitySchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('CostProfileSchema', () => {
  it('accepts expected tokens/usd/latency and rejects negatives', () => {
    const v = { tokens: 500, usd: 0.1, latencyMs: 2000 };
    expect(CostProfileSchema.parse(v)).toEqual(v);
    expect(CostProfileSchema.safeParse({ tokens: 500, usd: 0.1, latencyMs: -1 }).success).toBe(
      false,
    );
    expect(CostProfileSchema.safeParse({ tokens: 500, usd: 0.1 }).success).toBe(false);
  });
});

describe('EvidenceThresholdSchema', () => {
  it('accepts a metric threshold over a sliding window', () => {
    const v = { metric: 'precision', threshold: 0.95, windowN: 50 };
    expect(EvidenceThresholdSchema.parse(v)).toEqual(v);
  });

  it('rejects non-positive or fractional window sizes', () => {
    const base = { metric: 'precision', threshold: 0.95 };
    expect(EvidenceThresholdSchema.safeParse({ ...base, windowN: 0 }).success).toBe(false);
    expect(EvidenceThresholdSchema.safeParse({ ...base, windowN: -5 }).success).toBe(false);
    expect(EvidenceThresholdSchema.safeParse({ ...base, windowN: 2.5 }).success).toBe(false);
  });
});
