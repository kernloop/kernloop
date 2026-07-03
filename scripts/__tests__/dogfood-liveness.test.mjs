import { describe, expect, test } from 'vitest';
import {
  THRESHOLDS,
  loadLedger,
  renderScorecard,
  runCheck,
  scoreLiveness,
} from '../dogfood-liveness.mjs';

describe('loadLedger', () => {
  test('parses JSONL, ignoring blank lines', () => {
    const receipts = loadLedger('{"id":"a"}\n\n  \n{"id":"b"}\n');
    expect(receipts.map((r) => r.id)).toEqual(['a', 'b']);
  });

  test('fails loud on a malformed line rather than silently skipping it', () => {
    // Mirrors vote-parity-check.mjs's loadLedger: a corrupt ledger entry is a
    // data-integrity problem, not something to paper over.
    expect(() => loadLedger('{"id":"a"}\nnot json\n')).toThrow();
  });
});

describe('scoreLiveness — empty ledger', () => {
  test('reports an honest no-receipts-yet state, not a warning', () => {
    const s = scoreLiveness([], '2026-07-03');
    expect(s.hasReceipts).toBe(false);
    expect(s.total).toBe(0);
    expect(s.staleReceipt).toBe(false);
    expect(s.successDrought).toBe(false);
  });

  test('renders the empty state without an ⚠', () => {
    const text = renderScorecard(scoreLiveness([], '2026-07-03'));
    expect(text).toContain('no receipts yet');
    expect(text).not.toContain('⚠');
  });
});

describe('scoreLiveness — fresh success', () => {
  test('a receipt from today with status success warns on nothing', () => {
    const s = scoreLiveness([{ date: '2026-07-03', status: 'success' }], '2026-07-03');
    expect(s.daysSinceReceipt).toBe(0);
    expect(s.daysSinceSuccess).toBe(0);
    expect(s.staleReceipt).toBe(false);
    expect(s.successDrought).toBe(false);
  });
});

describe('scoreLiveness — stale receipt', () => {
  test('warns when days since the last receipt exceeds the threshold', () => {
    const s = scoreLiveness(
      [{ date: '2026-06-01', status: 'success' }],
      '2026-07-03', // 32 days later
    );
    expect(s.daysSinceReceipt).toBeGreaterThan(THRESHOLDS.daysSinceReceipt);
    expect(s.staleReceipt).toBe(true);
  });

  test('does not warn just under the threshold', () => {
    const s = scoreLiveness([{ date: '2026-06-25', status: 'success' }], '2026-07-03'); // 8 days
    expect(s.staleReceipt).toBe(false);
  });
});

describe('scoreLiveness — success drought', () => {
  test('a recent non-success receipt with an old (or no) success warns on drought only', () => {
    const receipts = [
      { date: '2026-01-01', status: 'success' },
      { date: '2026-07-02', status: 'partial' },
    ];
    const s = scoreLiveness(receipts, '2026-07-03');
    expect(s.staleReceipt).toBe(false); // most recent receipt is yesterday
    expect(s.successDrought).toBe(true); // last success is ~183 days back
  });

  test('no success receipt at all is treated as a drought', () => {
    const s = scoreLiveness([{ date: '2026-07-03', status: 'killed-deterministic' }], '2026-07-03');
    expect(s.daysSinceSuccess).toBeNull();
    expect(s.successDrought).toBe(true);
  });
});

describe('renderScorecard', () => {
  test('flags both warnings when both thresholds are exceeded', () => {
    const s = scoreLiveness([{ date: '2026-01-01', status: 'partial' }], '2026-07-03');
    const text = renderScorecard(s);
    expect(text).toContain('⚠ no dogfood receipt');
    expect(text).toContain('⚠ no SUCCESS receipt');
  });

  test('prints a clean verdict when within thresholds', () => {
    const s = scoreLiveness([{ date: '2026-07-01', status: 'success' }], '2026-07-03');
    const text = renderScorecard(s);
    expect(text).toContain('✓ within thresholds.');
  });

  test('always names the observe-tier, never-fails-the-build stance', () => {
    const text = renderScorecard(scoreLiveness([], '2026-07-03'));
    const text2 = renderScorecard(
      scoreLiveness([{ date: '2026-07-03', status: 'success' }], '2026-07-03'),
    );
    expect(text).toContain('OBSERVE TIER');
    expect(text2).toContain('NEVER fails the build');
  });
});

describe('the real committed ledger', () => {
  test('parses and counts at least the 3 known receipts (DF1-DF3), at least 1 success', () => {
    // Wall-clock-independent: only counts and statuses are asserted, never days.
    const s = runCheck(undefined, '2026-07-03');
    expect(s.total).toBeGreaterThanOrEqual(3);
    expect(s.successes).toBeGreaterThanOrEqual(1);
  });

  test('runCheck on a missing ledger path returns the honest empty state', () => {
    const s = runCheck('/nonexistent/path/to/ledger.jsonl', '2026-07-03');
    expect(s.hasReceipts).toBe(false);
  });
});
