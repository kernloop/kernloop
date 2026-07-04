import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import {
  FALSE_REFUTE_FLAG_RATE,
  corpusConsistencyErrors,
  loadResults,
  renderScorecard,
  runCheck,
  scoreFp,
} from '../parsimony-fp-check.mjs';

/** One results row: a scored, expected-confirmed, agreeing rep by default. */
function row(over = {}) {
  return {
    date: '2026-07-03',
    adapter: 'claude',
    caseId: 'case-a',
    rep: 1,
    scored: true,
    expected: 'confirmed',
    verdict: 'confirmed',
    refutedChecks: [],
    agree: true,
    ...over,
  };
}

describe('loadResults', () => {
  test('parses JSONL, ignoring blank lines', () => {
    const rows = loadResults('{"caseId":"a"}\n\n  \n{"caseId":"b"}\n');
    expect(rows.map((r) => r.caseId)).toEqual(['a', 'b']);
  });
});

describe('scoreFp — fail-loud on malformed measurement data', () => {
  test('throws on a row missing its verdict (a bad ledger must never skew a rate)', () => {
    expect(() => scoreFp([row({ verdict: undefined })])).toThrow(/malformed/);
  });
  test('throws on an unknown expected value', () => {
    expect(() => scoreFp([row({ expected: 'maybe' })])).toThrow(/malformed/);
  });
});

describe('scoreFp — the headline false-refute rate', () => {
  test('counts a refute of a truth-satisfied claim as a false refute', () => {
    const s = scoreFp([
      row(),
      row({ rep: 2, verdict: 'refuted', refutedChecks: ['intent'], agree: false }),
    ]);
    expect(s.falseRefutes).toBe(1);
    expect(s.falseRefuteRate).toBeCloseTo(1 / 2);
    expect(s.falseRefuteCaseIds).toEqual(['case-a']);
  });
  test('a refute of a truly-unmet claim is CORRECT, not a false refute', () => {
    const s = scoreFp([row({ expected: 'refuted', verdict: 'refuted' })]);
    expect(s.falseRefutes).toBe(0);
    expect(s.falseRefuteRate).toBeNull(); // zero expected-confirm samples
  });
  test('a zero denominator yields null (unmeasured), never a fake 0', () => {
    const s = scoreFp([]);
    expect(s.falseRefuteRate).toBeNull();
    expect(s.falseConfirmRate).toBeNull();
  });
});

describe('scoreFp — the false-confirm rate', () => {
  test('counts a confirm of an unmet claim as a false confirm', () => {
    const s = scoreFp([
      row({ caseId: 'over', expected: 'refuted', verdict: 'confirmed', agree: false }),
      row({ caseId: 'over', rep: 2, expected: 'refuted', verdict: 'refuted' }),
    ]);
    expect(s.falseConfirms).toBe(1);
    expect(s.falseConfirmRate).toBeCloseTo(1 / 2);
    expect(s.falseConfirmCaseIds).toEqual(['over']);
  });
});

describe('scoreFp — scope + parse-error exclusions', () => {
  test('out-of-scope (#435) rows are excluded from every rate but summarized', () => {
    const s = scoreFp([
      row(),
      row({ caseId: 'oos', scored: false, verdict: 'refuted', agree: false }),
    ]);
    expect(s.confirmExpectedN).toBe(1); // the oos refute is NOT a false refute
    expect(s.falseRefutes).toBe(0);
    expect(s.outOfScopeRows).toBe(1);
    expect(s.outOfScopeDisagreements).toBe(1);
  });
  test('a parse_error rep is reported separately, never counted as a verdict', () => {
    const s = scoreFp([row(), row({ rep: 2, verdict: 'parse_error', agree: false })]);
    expect(s.parseErrors).toBe(1);
    expect(s.confirmExpectedN).toBe(1); // denominator excludes the parse error
    expect(s.falseRefutes).toBe(0);
  });
});

describe('scoreFp — per-case stability + the Kc-burning class', () => {
  test('a case whose reps flip verdicts is unstable', () => {
    const s = scoreFp([row(), row({ rep: 2, verdict: 'refuted', agree: false })]);
    expect(s.unstableCases).toEqual(['case-a']);
    expect(s.persistentFalseRefuteCases).toEqual([]); // it flipped — not persistent
  });
  test('EVERY rep refuting a satisfied claim is the persistent (deterministic) class', () => {
    const s = scoreFp([
      row({ verdict: 'refuted', agree: false }),
      row({ rep: 2, verdict: 'refuted', agree: false }),
      row({ rep: 3, verdict: 'refuted', agree: false }),
    ]);
    expect(s.persistentFalseRefuteCases).toEqual(['case-a']);
    expect(s.unstableCases).toEqual([]); // stable — that is exactly the problem
  });
  test('a single-rep refute is NOT called persistent (needs >=2 reps of evidence)', () => {
    const s = scoreFp([row({ verdict: 'refuted', agree: false })]);
    expect(s.persistentFalseRefuteCases).toEqual([]);
  });
});

describe('renderScorecard', () => {
  test('names the headline rate and flags it prominently above the threshold', () => {
    const s = scoreFp([row(), row({ rep: 2, verdict: 'refuted', agree: false })]);
    const card = renderScorecard(s);
    expect(card).toContain('FALSE-REFUTE rate');
    expect(card).toContain('50.0% (1/2)');
    expect(s.falseRefuteRate).toBeGreaterThan(FALSE_REFUTE_FLAG_RATE);
    expect(card).toContain('FALSE-REFUTE RATE ABOVE');
    expect(card).toContain('human-ratified decision'); // never the scorer's call
  });
  test('carries no flag when the measured rate is under the threshold', () => {
    const card = renderScorecard(scoreFp([row()]));
    expect(card).not.toContain('FALSE-REFUTE RATE ABOVE');
    expect(card).toContain('n/a (0 samples)'); // false-confirm side unmeasured
  });
});

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'parsimony-fp-check-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

/** Write a minimal corpus case file into the scratch corpus dir. */
function writeCase(dir, id, truth, scored = true) {
  fs.mkdirSync(dir, { recursive: true });
  const c = {
    id,
    claimedPass: Object.keys(truth),
    groundTruth: truth,
    scored,
    labelProvenance: 'test fixture',
    diff: 'diff --git a/x b/x',
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(c));
}

describe('corpusConsistencyErrors — the ledger cannot drift from its labels', () => {
  test('flags an unknown caseId and an expected/scored mismatch; passes consistency', () => {
    const dir = path.join(scratch, 'corpus');
    writeCase(dir, 'good', { intent: true });
    const consistent = corpusConsistencyErrors([row({ caseId: 'good' })], dir);
    expect(consistent).toEqual([]);
    const drifted = corpusConsistencyErrors(
      [row({ caseId: 'ghost' }), row({ caseId: 'good', expected: 'refuted' })],
      dir,
    );
    expect(drifted).toHaveLength(2);
    expect(drifted[0]).toContain('not in the corpus');
    expect(drifted[1]).toContain('corpus derives confirmed');
  });
});

describe('runCheck', () => {
  test('throws LOUD on a ledger that disagrees with the corpus labels', () => {
    const dir = path.join(scratch, 'corpus2');
    writeCase(dir, 'only', { intent: true });
    const ledger = path.join(scratch, 'bad.jsonl');
    fs.writeFileSync(ledger, `${JSON.stringify(row({ caseId: 'only', expected: 'refuted' }))}\n`);
    expect(() => runCheck(ledger, dir)).toThrow(/disagrees with the corpus/);
  });
  test('the COMMITTED results ledger scores clean against the committed corpus', () => {
    // The real measurement (#436): corpus-consistent, and every scored rep
    // carries a real verdict or an honestly-recorded parse error.
    const s = runCheck();
    expect(s.total).toBeGreaterThanOrEqual(48); // >=16 scored+oos cases x 3 reps
    expect(s.cases).toBeGreaterThanOrEqual(12); // the corpus floor #436 asked for
    expect(s.confirmExpectedN + s.refuteExpectedN + s.parseErrors).toBe(s.scoredRows);
  });
});
