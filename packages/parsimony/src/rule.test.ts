/**
 * The compact parsimony rule [#417, EPIC #407 M4] — single-source + drift +
 * consistency proofs. The rule is defined ONCE (`COMPACT_PARSIMONY_RULE`) and
 * both the coder prompt and the per-harness copies derive from it; these tests
 * prove the committed copies are byte-identical to the rendered source (so any
 * hand-edit drift is caught) and that the rule names the REAL ladder rungs,
 * floor control ids, and marker grammar (so it cannot drift from the evaluator).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPACT_PARSIMONY_RULE,
  PARSIMONY_HARNESSES,
  renderHarnessCopy,
  renderSkillDoc,
} from './rule.js';
import { PARSIMONY_LADDER } from './ladder.js';
import { CONTROL_FLOOR } from './floor.js';
import { MARKER_TAG } from './marker.js';

// packages/parsimony/src → repo root is three levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const skillDir = path.join(repoRoot, 'skills', 'parsimony-restraint');

describe('compact parsimony rule — single source + drift', () => {
  it('each committed harness copy is byte-identical to renderHarnessCopy(harness) (drift gate)', () => {
    for (const harness of PARSIMONY_HARNESSES) {
      const committed = readFileSync(path.join(skillDir, 'copies', `${harness}.md`), 'utf8');
      expect(committed).toBe(renderHarnessCopy(harness));
    }
  });

  it('the committed SKILL.md is byte-identical to renderSkillDoc() (drift gate)', () => {
    const committed = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    expect(committed).toBe(renderSkillDoc());
  });

  it('every harness copy embeds the one canonical rule verbatim (single source)', () => {
    for (const harness of PARSIMONY_HARNESSES) {
      expect(renderHarnessCopy(harness)).toContain(COMPACT_PARSIMONY_RULE);
    }
    expect(renderSkillDoc()).toContain(COMPACT_PARSIMONY_RULE);
  });
});

describe('compact parsimony rule — consistency with the canonical vocabulary', () => {
  it('references the real kl:parsimony marker grammar', () => {
    expect(COMPACT_PARSIMONY_RULE).toContain(MARKER_TAG);
    expect(COMPACT_PARSIMONY_RULE).toContain(`${MARKER_TAG} rung=`);
  });

  it('names every real ladder rung and its outcome', () => {
    for (const rung of PARSIMONY_LADDER) {
      expect(COMPACT_PARSIMONY_RULE).toContain(`rung ${rung.rung} ${rung.name}`);
      expect(COMPACT_PARSIMONY_RULE).toContain(rung.outcome);
    }
  });

  it('names the real floor control ids (AC-3, SI-10) — not an invented vocabulary', () => {
    expect(COMPACT_PARSIMONY_RULE).toContain('AC-3');
    expect(COMPACT_PARSIMONY_RULE).toContain('SI-10');
    for (const entry of CONTROL_FLOOR) {
      expect(COMPACT_PARSIMONY_RULE).toContain(entry.name);
    }
  });
});
