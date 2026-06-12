/**
 * Tests for suggest-tier lifecycle proposals (CLM-0092). The PRIMARY evidence
 * that the Observer turns fitness/drift into deprecation + distill proposals
 * and — the hard invariant — NEVER auto-acts: computing proposals files no
 * issue, demotes nothing, distills nothing, and leaves every proposal at
 * `suggest` tier for a human to ratify.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Outcome, OutcomeStatus } from '@kernloop/contracts';
import { createObserver, LifecycleProposalSchema, type Observer } from './index.js';

const tmpDirs: string[] = [];
function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-lifecycle-'));
  tmpDirs.push(dir);
  return path.join(dir, 'overlay.sqlite');
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeOutcome(overrides: Partial<Outcome> = {}): Outcome {
  return {
    taskId: 'task-1',
    status: 'success',
    signals: [],
    cost: { tokens: 100, usd: 0.5, wallClockMs: 1000 },
    traceRef: 'trace://task-1',
    distillCandidates: [],
    ...overrides,
  };
}

function observerWithTicker(): Observer {
  let now = 1000;
  return createObserver(tmpDb(), { clock: () => ++now });
}

/** Feed `statuses` to `subject`, one Outcome each with a distinct task id. */
function feed(observer: Observer, subject: string, statuses: OutcomeStatus[]): void {
  for (const [i, status] of statuses.entries()) {
    observer.ingestOutcome(makeOutcome({ taskId: `${subject}-${String(i)}`, status }), { subject });
  }
}

const ok: OutcomeStatus = 'success';
const bad: OutcomeStatus = 'failure';

describe('lifecycle proposals (CLM-0092)', () => {
  it('returns no proposals on a fresh, empty ledger — never crashes', () => {
    const observer = observerWithTicker();
    expect(observer.lifecycleProposals()).toEqual([]);
    observer.close();
  });

  it('proposes deprecation for a drifting subject (recent window below lifetime)', () => {
    const observer = observerWithTicker();
    // Lifetime 0.5 over 20; last-10 window all failures → drop 0.5 ≥ 0.2.
    feed(observer, 'flaky-tool', [
      ...Array<OutcomeStatus>(10).fill(ok),
      ...Array<OutcomeStatus>(10).fill(bad),
    ]);
    const proposals = observer.lifecycleProposals();
    const dep = proposals.find((p) => p.subject === 'flaky-tool');
    expect(dep?.kind).toBe('deprecation');
    expect(dep?.tier).toBe('suggest');
    expect(dep?.body).toMatch(/drift/);
    expect(dep?.body).toMatch(/SUGGESTION only/);
    // The proposal does NOT demote: it only suggests a human review.
    expect(dep?.taskShaped.goal).toMatch(/deprecation/);
    observer.close();
  });

  it('proposes deprecation for a below-floor subject (no drift, low lifetime)', () => {
    const observer = observerWithTicker();
    // Steady 40% success over a full window — below the 0.5 floor, no drift.
    feed(observer, 'weak-tool', [ok, ok, ok, ok, bad, bad, bad, bad, bad, bad]);
    const proposals = observer.lifecycleProposals();
    const dep = proposals.find((p) => p.subject === 'weak-tool');
    expect(dep?.kind).toBe('deprecation');
    expect(dep?.tier).toBe('suggest');
    expect(dep?.body).toMatch(/floor/);
    observer.close();
  });

  it('proposes distilling a high-fitness subject and cites a real successful trace', () => {
    const observer = observerWithTicker();
    feed(observer, 'star-tool', [ok, ok, ok, ok]); // 100% over 4
    const proposals = observer.lifecycleProposals();
    const distill = proposals.find((p) => p.subject === 'star-tool');
    expect(distill?.kind).toBe('distill');
    expect(distill?.tier).toBe('suggest');
    // The cited trace is the subject's most recent successful run's task id.
    expect(distill?.title).toContain('star-tool-3');
    expect(distill?.taskShaped.goal).toContain('star-tool-3');
    observer.close();
  });

  it('distill cites the last SUCCESSFUL run, skipping a trailing failure', () => {
    const observer = observerWithTicker();
    // 9 successes then a recent failure → 90% (≥ the 0.9 bar) still distill-worthy;
    // the cited trace must be the last SUCCESS (run 8), never the trailing failure.
    feed(observer, 'star-tool', [ok, ok, ok, ok, ok, ok, ok, ok, ok, bad]);
    const distill = observer.lifecycleProposals().find((p) => p.subject === 'star-tool');
    expect(distill?.kind).toBe('distill');
    expect(distill?.title).toContain('star-tool-8'); // the last success, not star-tool-9
    expect(distill?.title).not.toContain('star-tool-9');
    expect(distill?.taskShaped.goal).toContain('star-tool-8');
    observer.close();
  });

  it('emits no distill proposal below the high-fitness invocation minimum', () => {
    const observer = observerWithTicker();
    feed(observer, 'green-tool', [ok, ok]); // 100% but only 2 invocations < 3
    expect(observer.lifecycleProposals()).toEqual([]);
    observer.close();
  });

  it('every emitted proposal validates as a suggest-tier proposal', () => {
    const observer = observerWithTicker();
    feed(observer, 'star-tool', [ok, ok, ok, ok]);
    feed(observer, 'weak-tool', [ok, ok, ok, ok, bad, bad, bad, bad, bad, bad]);
    const proposals = observer.lifecycleProposals();
    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) {
      expect(() => LifecycleProposalSchema.parse(p)).not.toThrow();
      expect(p.tier).toBe('suggest');
    }
    observer.close();
  });

  it('thresholds are configurable', () => {
    const observer = observerWithTicker();
    feed(observer, 'mid-tool', [ok, ok, ok, bad]); // 75% over 4
    // Default high bar 0.9 → no distill; lower the bar → a distill proposal.
    expect(observer.lifecycleProposals()).toEqual([]);
    const lowered = observer.lifecycleProposals({ highFitnessBar: 0.7 });
    expect(lowered.find((p) => p.subject === 'mid-tool')?.kind).toBe('distill');
    observer.close();
  });

  it('THE INVARIANT: computing proposals files no issue and demotes nothing', () => {
    const observer = observerWithTicker();
    feed(observer, 'star-tool', [ok, ok, ok, ok]);
    feed(observer, 'weak-tool', [ok, ok, ok, ok, bad, bad, bad, bad, bad, bad]);
    const before = observer.fitnessLedger();
    observer.lifecycleProposals();
    observer.lifecycleProposals(); // idempotent — no side effect to compound
    // No issue was filed/persisted: the issues table is still empty.
    expect(observer.listIssues()).toEqual([]);
    // The ledger is byte-for-byte unchanged — no demotion, no mutation.
    expect(observer.fitnessLedger()).toEqual(before);
    observer.close();
  });
});
