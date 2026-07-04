#!/usr/bin/env node
/**
 * Parsimony-verifier FP-rate scorer (#436) — mirrors the vote-parity ledger
 * pattern (scripts/vote-parity-check.mjs): the committed results ledger
 * (`evals/parsimony-fp/results.jsonl`, appended by the operator-run
 * `evals/parsimony-fp/run-fp-eval.mjs` against the REAL blind verifier) is the
 * honest measurement source; this scorer is deterministic over it and CI-safe
 * (no model calls). It reports the numbers #436 asks for:
 *
 *  - FALSE-REFUTE rate (the load-bearing number): the verifier says `refuted`
 *    while ground truth says every claimed guard is satisfied. At enforce/full
 *    (CLM-0177) each such verdict rejects a legitimate child; a PERSISTENT one
 *    burns the full Kc re-iteration budget (the #436 risk class).
 *  - FALSE-CONFIRM rate: the verifier confirms a claimed guard the diff does
 *    NOT provide (the pass-over-claim the verifier exists to catch).
 *  - PER-CASE STABILITY: whether the same case flips verdicts across reps
 *    (the verdict is a nondeterministic model call; reps expose flake vs
 *    deterministic disagreement — only the latter wedges re-iteration).
 *
 * This is a MEASUREMENT, observe-tier: rates never gate the build, and no gate
 * default changes on their basis without a separate human ratification (#415
 * flipped advisory→enforce by ratification; any flip back is the same class).
 * MALFORMED ledger/corpus data is different — it fails LOUD (a bad ledger must
 * never silently mask a real error rate), and a committed row whose `expected`
 * contradicts the corpus ground truth fails loud too (tamper-evidence).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = path.join(root, 'evals/parsimony-fp/results.jsonl');
const CORPUS_DIR = path.join(root, 'evals/parsimony-fp/corpus');

/** The prominence threshold for the headline number: a measured false-refute
 * rate above this is flagged loudly in the scorecard (never a build failure —
 * acting on it is a ratification decision, see the module doc). */
export const FALSE_REFUTE_FLAG_RATE = 0.05;

/** Parse a JSONL results string into row objects (blank lines ignored). */
export function loadResults(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

const VERDICTS = new Set(['confirmed', 'refuted', 'parse_error']);

/** Validate one row's shape; malformed measurement data fails LOUD, never
 * silently skewing a rate (same fail-loud stance as dogfood-liveness). */
function assertRow(row, i) {
  const ok =
    typeof row.caseId === 'string' &&
    typeof row.scored === 'boolean' &&
    (row.expected === 'confirmed' || row.expected === 'refuted') &&
    VERDICTS.has(row.verdict) &&
    Number.isInteger(row.rep);
  if (!ok) {
    throw new Error(
      `results row ${i + 1} is malformed (caseId/scored/expected/verdict/rep): ${JSON.stringify(row).slice(0, 200)}`,
    );
  }
}

/** Group rows per caseId, preserving encounter order of cases. */
function byCase(rows) {
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.caseId) ?? [];
    list.push(row);
    groups.set(row.caseId, list);
  }
  return groups;
}

/**
 * Score a results ledger. Pure — no I/O, no exit. Rates are computed over
 * SCORED rows with a real verdict (parse errors are a harness/contract failure
 * the gate would THROW on, reported separately — never counted as a verdict);
 * out-of-scope rows (#435 na-lying-adjacent cases) are summarized but excluded
 * from every headline rate. A zero denominator yields a null rate (unmeasured,
 * never a fake 0).
 */
export function scoreFp(rows) {
  rows.forEach(assertRow);
  const scored = rows.filter((r) => r.scored === true);
  const outOfScope = rows.filter((r) => r.scored !== true);
  const parseErrors = scored.filter((r) => r.verdict === 'parse_error');
  const judged = scored.filter((r) => r.verdict !== 'parse_error');
  const confirmExpected = judged.filter((r) => r.expected === 'confirmed');
  const refuteExpected = judged.filter((r) => r.expected === 'refuted');
  const falseRefutes = confirmExpected.filter((r) => r.verdict === 'refuted');
  const falseConfirms = refuteExpected.filter((r) => r.verdict === 'confirmed');
  const rate = (num, den) => (den === 0 ? null : num / den);
  const unstable = [];
  const persistentFalseRefuteCases = [];
  for (const [caseId, list] of byCase(judged)) {
    const verdicts = new Set(list.map((r) => r.verdict));
    if (list.length >= 2 && verdicts.size > 1) unstable.push(caseId);
    // The #436 risk class: EVERY rep of a truth-satisfied case refuted — a
    // deterministic disagreement re-iteration cannot fix (>=2 reps required).
    if (
      list.length >= 2 &&
      list[0].expected === 'confirmed' &&
      list.every((r) => r.verdict === 'refuted')
    ) {
      persistentFalseRefuteCases.push(caseId);
    }
  }
  return {
    total: rows.length,
    scoredRows: scored.length,
    outOfScopeRows: outOfScope.length,
    outOfScopeDisagreements: outOfScope.filter((r) => r.agree === false).length,
    parseErrors: parseErrors.length,
    cases: byCase(judged).size,
    confirmExpectedN: confirmExpected.length,
    refuteExpectedN: refuteExpected.length,
    falseRefutes: falseRefutes.length,
    falseRefuteCaseIds: [...new Set(falseRefutes.map((r) => r.caseId))].sort(),
    falseRefuteRate: rate(falseRefutes.length, confirmExpected.length),
    falseConfirms: falseConfirms.length,
    falseConfirmCaseIds: [...new Set(falseConfirms.map((r) => r.caseId))].sort(),
    falseConfirmRate: rate(falseConfirms.length, refuteExpected.length),
    unstableCases: unstable.sort(),
    persistentFalseRefuteCases: persistentFalseRefuteCases.sort(),
  };
}

/** Format the scorecard for humans; the false-refute rate is the headline. */
export function renderScorecard(s) {
  const pct = (r) => (r === null ? 'n/a (0 samples)' : `${(r * 100).toFixed(1)}%`);
  const flag =
    s.falseRefuteRate !== null && s.falseRefuteRate > FALSE_REFUTE_FLAG_RATE
      ? `  ⚠ FALSE-REFUTE RATE ABOVE ${(FALSE_REFUTE_FLAG_RATE * 100).toFixed(0)}% — at enforce/full each such verdict rejects a\n  legitimate child; persistent ones burn the full Kc budget (#436). Weigh this\n  before relying on the default; changing any gate default is a separate\n  human-ratified decision, never this scorer's call.\n`
      : '';
  return [
    `parsimony-verifier FP rates (#436) — ${String(s.scoredRows)} scored reps over ${String(s.cases)} cases (${String(s.outOfScopeRows)} out-of-scope reps excluded)`,
    `  FALSE-REFUTE rate (headline: refutes a truth-satisfied claim): ${pct(s.falseRefuteRate)} (${String(s.falseRefutes)}/${String(s.confirmExpectedN)})${s.falseRefuteCaseIds.length > 0 ? ` — cases: ${s.falseRefuteCaseIds.join(', ')}` : ''}`,
    `  false-confirm rate (confirms an unmet claim):                  ${pct(s.falseConfirmRate)} (${String(s.falseConfirms)}/${String(s.refuteExpectedN)})${s.falseConfirmCaseIds.length > 0 ? ` — cases: ${s.falseConfirmCaseIds.join(', ')}` : ''}`,
    `  per-case stability: ${String(s.unstableCases.length)} case(s) flip across reps${s.unstableCases.length > 0 ? ` [${s.unstableCases.join(', ')}]` : ''}`,
    `  persistent false-refutes (every rep refutes a satisfied claim — the Kc-burning class): ${String(s.persistentFalseRefuteCases.length)}${s.persistentFalseRefuteCases.length > 0 ? ` [${s.persistentFalseRefuteCases.join(', ')}]` : ''}`,
    `  parse errors (gate would THROW, not fabricate — excluded from rates): ${String(s.parseErrors)}`,
    `  out-of-scope (#435 na-lying-adjacent) disagreements, recorded not scored: ${String(s.outOfScopeDisagreements)}/${String(s.outOfScopeRows)}`,
    flag + `  NOTE: a MEASUREMENT, observe-tier — small hand-labeled corpus (see the corpus`,
    `  README for label provenance + exclusions), nondeterminism bounded only by the`,
    `  recorded reps. Rates never gate the build; acting on them is a ratification.`,
  ].join('\n');
}

/**
 * Tamper-evidence: every committed row's caseId must exist in the corpus and
 * its `expected` must equal the verdict the corpus ground truth derives, so a
 * results ledger cannot drift from (or quietly rewrite) the labels it claims
 * to measure. Returns the error list (empty = consistent).
 */
export function corpusConsistencyErrors(rows, corpusDir = CORPUS_DIR) {
  const expectations = new Map();
  for (const f of fs.readdirSync(corpusDir).filter((n) => n.endsWith('.json'))) {
    const c = JSON.parse(fs.readFileSync(path.join(corpusDir, f), 'utf8'));
    const expected = c.claimedPass.every((g) => c.groundTruth[g] === true)
      ? 'confirmed'
      : 'refuted';
    expectations.set(c.id, { expected, scored: c.scored });
  }
  const errors = [];
  rows.forEach((row, i) => {
    const c = expectations.get(row.caseId);
    if (c === undefined) errors.push(`row ${i + 1}: caseId "${row.caseId}" not in the corpus`);
    else if (c.expected !== row.expected || c.scored !== row.scored) {
      errors.push(
        `row ${i + 1}: ${row.caseId} recorded expected=${row.expected}/scored=${String(row.scored)} but the corpus derives ${c.expected}/${String(c.scored)}`,
      );
    }
  });
  return errors;
}

/** Read the real ledger, verify corpus consistency, score it. No exit. */
export function runCheck(resultsPath = RESULTS, corpusDir = CORPUS_DIR) {
  const rows = loadResults(fs.readFileSync(resultsPath, 'utf8'));
  const errors = corpusConsistencyErrors(rows, corpusDir);
  if (errors.length > 0) {
    throw new Error(`results ledger disagrees with the corpus labels:\n  ${errors.join('\n  ')}`);
  }
  return scoreFp(rows);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // The only FAILURE modes are data-integrity ones (runCheck/scoreFp throw on a
  // malformed or corpus-inconsistent ledger). Measured rates report, never gate:
  // this harness is observe-tier evidence for a future ratification decision.
  console.error(renderScorecard(runCheck()));
}
