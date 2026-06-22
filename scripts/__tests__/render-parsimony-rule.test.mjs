import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  driftedCopies,
  emit,
  harnessCopyPath,
  main,
  renderPlan,
  skillDocPath,
} from '../render-parsimony-rule.mjs';

const root = '/repo';

describe('paths', () => {
  test('harnessCopyPath points under skills/parsimony-restraint/copies', () => {
    expect(harnessCopyPath(root, 'claude')).toBe(
      path.join('/repo', 'skills', 'parsimony-restraint', 'copies', 'claude.md'),
    );
  });
  test('skillDocPath points at the skill home', () => {
    expect(skillDocPath(root)).toBe(
      path.join('/repo', 'skills', 'parsimony-restraint', 'SKILL.md'),
    );
  });
});

describe('renderPlan', () => {
  test('covers the skill home plus one copy per harness, each with rendered content', () => {
    const plan = renderPlan(root);
    expect(plan.map((p) => p.harness)).toEqual(['skill', 'claude', 'codex', 'gemini', 'opencode']);
    for (const p of plan) expect(p.want.length).toBeGreaterThan(0);
  });
});

describe('driftedCopies', () => {
  test('a missing or mismatched file drifts; a byte-identical one does not', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parsimony-rule-'));
    const plan = renderPlan(tmp);
    // Nothing written yet → everything drifts.
    expect(driftedCopies(plan)).toHaveLength(plan.length);
    // Write them all → nothing drifts.
    emit(false, plan);
    expect(driftedCopies(plan)).toHaveLength(0);
    // Corrupt one → exactly that one drifts.
    fs.writeFileSync(plan[1].file, 'tampered');
    const drift = driftedCopies(plan);
    expect(drift).toHaveLength(1);
    expect(drift[0].harness).toBe(plan[1].harness);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('emit / main', () => {
  test('check mode returns 0 when current and 1 on drift; write mode creates the files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parsimony-rule-'));
    // Drift before write.
    expect(main(tmp, true)).toBe(1);
    // Write, then check passes.
    expect(main(tmp, false)).toBe(0);
    expect(fs.existsSync(skillDocPath(tmp))).toBe(true);
    expect(main(tmp, true)).toBe(0);
    // Tamper → check fails again.
    fs.writeFileSync(harnessCopyPath(tmp, 'gemini'), 'drift');
    expect(main(tmp, true)).toBe(1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
