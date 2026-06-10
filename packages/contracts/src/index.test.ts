import { describe, expect, it } from 'vitest';
import {
  BriefSchema,
  CONTRACT_NAMES,
  KNOWN_CONTRACTS,
  ManifestSchema,
  OutcomeSchema,
  TaskContractSchema,
  VerdictSchema,
  contractsVersion,
} from './index.js';

describe('contractsVersion', () => {
  it('is a semver string starting at 1.0.0', () => {
    expect(contractsVersion).toBe('1.0.0');
    expect(contractsVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('KNOWN_CONTRACTS', () => {
  it('contains exactly the frozen five, keyed by CONTRACT_NAMES', () => {
    expect(Object.keys(KNOWN_CONTRACTS).sort()).toEqual([...CONTRACT_NAMES].sort());
    expect(Object.keys(KNOWN_CONTRACTS)).toHaveLength(5);
  });

  it('maps each name to its schema', () => {
    expect(KNOWN_CONTRACTS.TaskContract).toBe(TaskContractSchema);
    expect(KNOWN_CONTRACTS.Brief).toBe(BriefSchema);
    expect(KNOWN_CONTRACTS.Verdict).toBe(VerdictSchema);
    expect(KNOWN_CONTRACTS.Outcome).toBe(OutcomeSchema);
    expect(KNOWN_CONTRACTS.Manifest).toBe(ManifestSchema);
  });
});
