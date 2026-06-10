/**
 * Voter template data tests (CLM-0037): panel sizes and compositions match
 * spec §5.3 / §8.6, and every ported role prompt is non-trivial data.
 */
import { describe, expect, it } from 'vitest';
import {
  AI_ML,
  ARCHITECT,
  CONTRARIAN,
  DEVEX,
  PANEL_DEFAULT,
  PANEL_RATIFICATION,
  PM,
  SCOPE_STEWARD,
  SECURITY,
} from './voters.js';

const ALL = [ARCHITECT, SECURITY, DEVEX, AI_ML, PM, CONTRARIAN, SCOPE_STEWARD];

describe('voter templates', () => {
  it('ships the seven ported v1 roles with unique names and real prompts', () => {
    expect(ALL.map((v) => v.name)).toEqual([
      'architect',
      'security',
      'devex',
      'ai-ml',
      'pm',
      'contrarian',
      'scope-steward',
    ]);
    expect(new Set(ALL.map((v) => v.name)).size).toBe(7);
    for (const voter of ALL) {
      expect(voter.rolePrompt.length).toBeGreaterThan(200);
    }
  });

  it('keeps the v1 rejection-category taxonomy in every prompt', () => {
    for (const voter of ALL) {
      expect(voter.rolePrompt).toContain('YAGNI');
      expect(voter.rolePrompt).toContain('SCOPE_CREEP');
    }
  });
});

describe('panels (spec §5.3: 3 default, 7 at ratification)', () => {
  it('defaults to the 3-voter quick panel ported from v1 quickMode', () => {
    // v1 substituted scope_steward for pm so fast triage still covers
    // existence-justification — composition kept deliberately.
    expect(PANEL_DEFAULT.map((v) => v.name)).toEqual(['architect', 'security', 'scope-steward']);
  });

  it('convenes all seven roles at plan ratification', () => {
    expect(PANEL_RATIFICATION).toHaveLength(7);
    expect(PANEL_RATIFICATION.map((v) => v.name)).toEqual(ALL.map((v) => v.name));
  });

  it('the default panel is a subset of the ratification panel', () => {
    for (const voter of PANEL_DEFAULT) {
      expect(PANEL_RATIFICATION).toContain(voter);
    }
  });
});
