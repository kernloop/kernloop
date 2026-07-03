#!/usr/bin/env node
/**
 * Dogfooding-liveness check (#531, OBSERVE TIER) — mirrors the vote-parity
 * ledger pattern (`scripts/vote-parity-check.mjs`): a committed receipts
 * ledger is the honest liveness source, never the gitignored per-host audit
 * chain (`.kernloop/audit.jsonl`, machine-local + HMAC-keyed — see #531's
 * corrected-design comment). Each real dogfood run appends one receipt to
 * `evals/dogfood/ledger.jsonl`; this check computes how long it has been
 * since the last receipt, and since the last SUCCESS receipt, and warns past
 * a threshold. A LIVENESS FINDING never gates the build (stale/drought
 * warnings exit 0) — the issue explicitly asks that a failing gate be a
 * SEPARATE, later ratification decision, not a default upward from observe
 * tier. MALFORMED ledger data is different: an unparseable line or a receipt
 * without a valid `YYYY-MM-DD` date fails loud (a bad ledger must never
 * silently mask a real drought).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(root, 'evals/dogfood/ledger.jsonl');

/** Default warning thresholds (days), overridable via function args — never
 * ratified as a build-failing gate here; see the module doc-comment. */
export const THRESHOLDS = {
  daysSinceReceipt: 14,
  daysSinceSuccess: 30,
};

/** Parse a JSONL ledger string into receipt objects (blank lines ignored). */
export function loadLedger(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

/** Whole days between two `YYYY-MM-DD` date strings (b - a), floored at 0. */
function daysBetween(aDateStr, bDateStr) {
  const a = new Date(`${aDateStr}T00:00:00Z`);
  const b = new Date(`${bDateStr}T00:00:00Z`);
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

/** Return a receipt's `date`, failing LOUD when it is missing or not a real
 * `YYYY-MM-DD` date. Without this, a dateless receipt would NaN through
 * `daysBetween`, staleness would read false, and a bad ledger would MASK a
 * real drought — the opposite of fail-loud. Malformed ledger data is a
 * data-integrity error, never a silent skip. */
function validDate(receipt) {
  const d = receipt.date;
  const parses =
    typeof d === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime());
  if (!parses) {
    throw new Error(
      `malformed dogfood receipt (id ${String(receipt.id ?? '?')}): missing or invalid date ${JSON.stringify(d)} — expected YYYY-MM-DD`,
    );
  }
  return d;
}

/**
 * Score a ledger's liveness as of `now` (an injectable `YYYY-MM-DD` string —
 * the CLI `main` below supplies the real clock; tests never do). Pure — no
 * I/O, no exit. An empty ledger returns an honest "no receipts yet" state;
 * a receipt with a missing/invalid `date` throws (see `validDate`).
 */
export function scoreLiveness(receipts, now, thresholds = THRESHOLDS) {
  const total = receipts.length;
  const successes = receipts.filter((r) => r.status === 'success');
  if (total === 0) {
    return {
      total: 0,
      successes: 0,
      daysSinceReceipt: null,
      daysSinceSuccess: null,
      staleReceipt: false,
      successDrought: false,
      hasReceipts: false,
    };
  }
  const lastReceiptDate = receipts.map(validDate).sort().at(-1);
  const daysSinceReceipt = daysBetween(lastReceiptDate, now);
  const lastSuccessDate = successes.map(validDate).sort().at(-1) ?? null;
  const daysSinceSuccess = lastSuccessDate === null ? null : daysBetween(lastSuccessDate, now);
  return {
    total,
    successes: successes.length,
    daysSinceReceipt,
    daysSinceSuccess,
    staleReceipt: daysSinceReceipt > thresholds.daysSinceReceipt,
    successDrought: daysSinceSuccess === null || daysSinceSuccess > thresholds.daysSinceSuccess,
    hasReceipts: true,
  };
}

/** Format the scorecard for humans. */
export function renderScorecard(s, thresholds = THRESHOLDS) {
  if (!s.hasReceipts) {
    return [
      'dogfood liveness (#531) — OBSERVE TIER',
      '  no receipts yet in evals/dogfood/ledger.jsonl',
      '  (this is an honest empty state, not a failure — a liveness finding never fails the build)',
    ].join('\n');
  }
  const lines = [
    'dogfood liveness (#531) — OBSERVE TIER',
    `  receipts: ${String(s.total)} total, ${String(s.successes)} success`,
    `  days since last receipt: ${String(s.daysSinceReceipt)} (warn > ${String(thresholds.daysSinceReceipt)})`,
    `  days since last SUCCESS receipt: ${s.daysSinceSuccess === null ? 'never' : String(s.daysSinceSuccess)} (warn > ${String(thresholds.daysSinceSuccess)})`,
  ];
  if (s.staleReceipt) {
    lines.push(
      `  ⚠ no dogfood receipt in over ${String(thresholds.daysSinceReceipt)} days — loop activity may have gone dark.`,
    );
  }
  if (s.successDrought) {
    lines.push(
      `  ⚠ no SUCCESS receipt in over ${String(thresholds.daysSinceSuccess)} days (or none ever) — self-hosting claims may be stale.`,
    );
  }
  if (!s.staleReceipt && !s.successDrought) {
    lines.push('  ✓ within thresholds.');
  }
  lines.push(
    '  NOTE: observe tier — a liveness finding NEVER fails the build. Promotion to a',
    '  failing gate is a separate, future ratification decision (never defaulted upward).',
    '  (Malformed ledger data is different: it fails loud — bad data must not mask a drought.)',
  );
  return lines.join('\n');
}

/** Read the real ledger (missing file ⇒ empty), score it, return the verdict
 * (no exit). `now` defaults to the real clock — fine for this CLI script;
 * the no-wall-clock rule binds tests, which must always inject `now`. */
export function runCheck(ledgerPath = LEDGER, now = new Date().toISOString().slice(0, 10)) {
  const text = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf8') : '';
  const receipts = loadLedger(text);
  return scoreLiveness(receipts, now);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // OBSERVE TIER: a LIVENESS FINDING never exits nonzero — stale/drought
  // warnings are printed and the process exits 0. Malformed ledger data
  // (unparseable line, missing/invalid date) throws out of runCheck and
  // exits nonzero, loud and by design.
  const s = runCheck();
  console.error(renderScorecard(s));
  process.exit(0);
}
