import { describe, expect, test } from 'vitest';
import {
  CRITERIA,
  loadLedger,
  renderScorecard,
  runCheck,
  scoreParity,
} from '../vote-parity-check.mjs';

/** A counted (independence-verified, pre-registered) data point. */
function dp(over = {}) {
  return {
    id: 'x',
    decisionType: 'contract',
    native: { disposition: 'approve' },
    external: { disposition: 'approve' },
    independenceVerified: true,
    counted: true,
    organic: true,
    externalDangerous: false,
    ...over,
  };
}

describe('loadLedger', () => {
  test('parses JSONL, ignoring blank lines', () => {
    const dps = loadLedger('{"id":"a"}\n\n  \n{"id":"b"}\n');
    expect(dps.map((d) => d.id)).toEqual(['a', 'b']);
  });
});

describe('scoreParity — counted vs provisional', () => {
  test('a point only counts when independence is verified AND flagged counted', () => {
    const s = scoreParity([
      dp({ id: 'counted' }),
      dp({ id: 'no-indep', independenceVerified: false }),
      dp({ id: 'not-flagged', counted: false }),
    ]);
    expect(s.counted).toBe(1);
    expect(s.provisional).toBe(2);
  });
});

describe('scoreParity — the hard false-approve gate (#348 §2)', () => {
  test('flags a false-approve: native APPROVES while external REJECTS', () => {
    const s = scoreParity([
      dp({ native: { disposition: 'approve' }, external: { disposition: 'reject' } }),
    ]);
    expect(s.falseApproves).toHaveLength(1);
    expect(s.criteriaMet).toBe(false);
  });
  test('a false-REJECT (native rejects, external approves) is SAFE — not a false-approve', () => {
    const s = scoreParity([
      dp({ native: { disposition: 'reject' }, external: { disposition: 'approve' } }),
    ]);
    expect(s.falseApproves).toHaveLength(0);
    expect(s.falseRejects).toBe(1);
  });
});

describe('scoreParity — agreement, diversity, dangerous coverage', () => {
  test('agreement rate = matching dispositions / counted', () => {
    const s = scoreParity([
      dp(),
      dp(),
      dp({ native: { disposition: 'reject' }, external: { disposition: 'approve' } }),
    ]);
    expect(s.agreementRate).toBeCloseTo(2 / 3);
  });
  test('counts distinct decision types and organic dangerous cases', () => {
    const s = scoreParity([
      dp({ decisionType: 'contract', externalDangerous: true, organic: true }),
      dp({ decisionType: 'tier', externalDangerous: true, organic: false }),
      dp({ decisionType: 'scope' }),
    ]);
    expect(s.decisionTypes).toEqual(['contract', 'scope', 'tier']);
    expect(s.dangerous).toBe(2);
    expect(s.dangerousOrganic).toBe(1);
  });
});

describe('scoreParity — criteriaMet requires EVERY ratified bar', () => {
  test('a full window meeting all bars is met; one short bar fails it', () => {
    const types = ['contract', 'claims-semantics', 'tier', 'scope'];
    const full = Array.from({ length: CRITERIA.windowN }, (_v, i) =>
      dp({
        decisionType: types[i % types.length],
        externalDangerous: i < CRITERIA.dangerousCases,
        organic: true,
      }),
    );
    expect(scoreParity(full).criteriaMet).toBe(true);
    // Drop the dangerous-case coverage below the bar ⇒ not met, even with 20 agreeing points.
    const noDanger = full.map((d) => ({ ...d, externalDangerous: false }));
    expect(scoreParity(noDanger).criteriaMet).toBe(false);
  });
  test('dangerous cases must be a MAJORITY organic', () => {
    const types = ['contract', 'claims-semantics', 'tier', 'scope'];
    const base = Array.from({ length: CRITERIA.windowN }, (_v, i) =>
      dp({ decisionType: types[i % types.length] }),
    );
    // Exactly 5 dangerous, but only 2 organic (minority) ⇒ not met.
    base[0] = dp({ externalDangerous: true, organic: true });
    base[1] = dp({ externalDangerous: true, organic: true });
    base[2] = dp({ externalDangerous: true, organic: false });
    base[3] = dp({ externalDangerous: true, organic: false });
    base[4] = dp({ externalDangerous: true, organic: false });
    expect(scoreParity(base).criteriaMet).toBe(false);
  });
});

describe('the real committed ledger', () => {
  const s = runCheck();
  test('has ZERO false-approves in the counted window (the load-bearing invariant)', () => {
    expect(s.falseApproves).toHaveLength(0);
  });
  test('seeds the 3 pre-criteria data points as PROVISIONAL (not counted)', () => {
    expect(s.counted).toBe(0);
    expect(s.provisional).toBe(3);
  });
  test('renders an honest scorecard naming the human-ratified, necessary-not-sufficient framing', () => {
    const text = renderScorecard(s);
    expect(text).toContain('human-ratified');
    expect(text).toContain('necessary-not-sufficient');
  });
});
