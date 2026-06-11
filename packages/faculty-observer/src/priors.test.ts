/**
 * Tests for the routing-prior export (CLM-0070): learned routing priors —
 * per-subject success rate, invocations, last-used recency — read out of the
 * Observer fitness ledger into a reviewable, serializable document (spec §7).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Outcome, OutcomeStatus } from '@kernloop/contracts';
import { createObserver, PriorsExportSchema, type Observer } from './index.js';

const tmpDirs: string[] = [];
function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-priors-'));
  tmpDirs.push(dir);
  return path.join(dir, 'overlay.sqlite');
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function observer(): Observer {
  let now = 1000;
  return createObserver(tmpDb(), { clock: () => ++now });
}

function outcome(taskId: string, status: OutcomeStatus): Outcome {
  return {
    taskId,
    status,
    signals: [],
    cost: { tokens: 10, usd: 0.1, wallClockMs: 5 },
    traceRef: `trace://${taskId}`,
    distillCandidates: [],
  };
}

describe('exportPriors (CLM-0070)', () => {
  it('exports an empty, schema-valid document from an empty ledger', () => {
    const obs = observer();
    const doc = obs.exportPriors();
    expect(PriorsExportSchema.parse(doc)).toEqual(doc);
    expect(doc).toEqual({ version: '1', priors: [] });
    obs.close();
  });

  it('exports per-subject success rate as the routing fitness signal', () => {
    const obs = observer();
    // router-a: 3 of 4 succeed → 0.75 ; router-b: 1 of 1 → 1.0
    obs.ingestOutcome(outcome('t1', 'success'), { subject: 'router-a' });
    obs.ingestOutcome(outcome('t2', 'success'), { subject: 'router-a' });
    obs.ingestOutcome(outcome('t3', 'failure'), { subject: 'router-a' });
    obs.ingestOutcome(outcome('t4', 'success'), { subject: 'router-a' });
    obs.ingestOutcome(outcome('t5', 'success'), { subject: 'router-b' });

    const doc = obs.exportPriors();
    expect(PriorsExportSchema.parse(doc)).toEqual(doc);
    const bySubject = Object.fromEntries(doc.priors.map((p) => [p.subject, p]));
    expect(bySubject['router-a']).toMatchObject({ invocations: 4, successRate: 0.75 });
    expect(bySubject['router-b']).toMatchObject({ invocations: 1, successRate: 1 });
    expect(bySubject['router-a']?.lastUsedAt).toBeGreaterThan(0);
    obs.close();
  });

  it('orders priors most-recently-used first (the ledger ordering)', () => {
    const obs = observer();
    obs.ingestOutcome(outcome('t1', 'success'), { subject: 'old' });
    obs.ingestOutcome(outcome('t2', 'success'), { subject: 'new' });
    const doc = obs.exportPriors();
    expect(doc.priors[0]?.subject).toBe('new');
    expect(doc.priors[1]?.subject).toBe('old');
    obs.close();
  });

  it('survives a JSON round-trip unchanged (serializable)', () => {
    const obs = observer();
    obs.ingestOutcome(outcome('t1', 'success'), { subject: 'router-a' });
    const doc = obs.exportPriors();
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
    obs.close();
  });
});
