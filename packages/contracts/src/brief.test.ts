import { describe, expect, it } from 'vitest';
import { BriefSchema, type Brief } from './brief.js';

const valid: Brief = {
  taskId: 'task-001',
  sections: [
    {
      name: 'goal',
      content: 'Build the contracts package.',
      tokens: 7,
      priority: 1,
      provenance: [{ ref: 'task:task-001' }],
    },
    {
      name: 'memory',
      content: 'Prior session used zod strictObject.',
      tokens: 9,
      priority: 0.5,
      provenance: [{ ref: 'memory:episodic/42' }],
    },
  ],
  budget: { allotted: 4000, used: 16 },
  compilerVersion: '0.1.0',
};

describe('BriefSchema', () => {
  it('parses a valid Brief', () => {
    expect(BriefSchema.parse(valid)).toEqual(valid);
  });

  it('round-trips through JSON serialization', () => {
    expect(BriefSchema.parse(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it('rejects when a required field is missing', () => {
    for (const field of ['taskId', 'sections', 'budget', 'compilerVersion']) {
      const broken: Record<string, unknown> = { ...valid };
      delete broken[field];
      expect(BriefSchema.safeParse(broken).success).toBe(false);
    }
  });

  it('rejects sections missing provenance or with negative tokens', () => {
    const section = valid.sections[0]!;
    const noProvenance: Record<string, unknown> = { ...section };
    delete noProvenance['provenance'];
    expect(BriefSchema.safeParse({ ...valid, sections: [noProvenance] }).success).toBe(false);
    expect(
      BriefSchema.safeParse({ ...valid, sections: [{ ...section, tokens: -1 }] }).success,
    ).toBe(false);
  });

  it('rejects negative or fractional budget numbers', () => {
    expect(BriefSchema.safeParse({ ...valid, budget: { allotted: -1, used: 0 } }).success).toBe(
      false,
    );
    expect(BriefSchema.safeParse({ ...valid, budget: { allotted: 10.5, used: 0 } }).success).toBe(
      false,
    );
  });

  it('rejects wrong field types and unknown keys', () => {
    expect(BriefSchema.safeParse({ ...valid, sections: 'all of it' }).success).toBe(false);
    expect(BriefSchema.safeParse({ ...valid, compiler: 'v2' }).success).toBe(false);
  });
});
