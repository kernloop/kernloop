/**
 * The parsimony gate loop node [#411/#5, EPIC #407] — the Check layer. Asserts the
 * advisory gate's contract: a clean diff emits a receipt with no deferral and a pass
 * Verdict with no findings; a diff the assessor reports an applicable-unsatisfied
 * floor entry against emits a receipt carrying the forced `deferred` block plus a
 * `warn` finding; a malformed assessment is a typed clean error (NO fabricated
 * receipt); and the receipt rides the hash-chained audit log as a `parsimony.receipt`
 * event. Scripted assessor invoke + in-memory kern, mirroring the vote/review suites.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type Verdict } from '@kernloop/contracts';
import {
  PARSIMONY_RECEIPT_EVENT,
  parseParsimonyReceipt,
  type ParsimonyReceipt,
} from '@kernloop/parsimony';
import { buildLoopExecutors, type LoopRefs } from './executors.js';
import { LoopParseError, type LoopInvoke } from './invoke.js';
import { readEnvelopes } from '../tools/audit.js';
import { boundHelpers, ctxFor, task, COST } from './executors.testkit.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-parsimony-exec-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const { kernloopFor, bindingsFor } = boundHelpers(scratch);

/** A diff stash for the unit child, so the gate has something to assess. */
const refsWithDiff: LoopRefs = {
  writtenByChild: { [task.id]: [{ path: 'src/x.ts', content: 'export const x = 1;\n' }] },
};

/** An assessor invoke returning a canned assessment object. */
function assessor(assessment: unknown): LoopInvoke {
  return () => Promise.resolve({ output: JSON.stringify(assessment), cost: COST });
}

/** A CLEAN assessment: rung 1 (stdlib), no floor entry applies. */
const cleanAssessment = {
  rung: 1,
  signals: { need: true, stdlib: true, native: false, dep: false, oneLine: false },
  floorContext: {
    crossesTrustBoundary: false,
    risksDataLoss: false,
    enforcesAccess: false,
    hasUserInterface: false,
    acts: false,
    wasRequested: true,
  },
  satisfied: { intent: true },
  rationale: 'reuses the stdlib; nothing crosses a trust boundary',
};

/** A DEFERRING assessment: input crosses a trust boundary but input_validation is unsatisfied. */
const deferringAssessment = {
  rung: 5,
  signals: { need: true, stdlib: false, native: false, dep: false, oneLine: false },
  floorContext: {
    crossesTrustBoundary: true,
    risksDataLoss: false,
    enforcesAccess: false,
    hasUserInterface: false,
    acts: false,
    wasRequested: true,
  },
  satisfied: { intent: true }, // input_validation absent ⇒ fail-closed to unsatisfied
  rationale: 'parses external input but skips validation',
};

function receipts(auditPath: string): ParsimonyReceipt[] {
  return readEnvelopes(auditPath)
    .filter((e) => e.type === PARSIMONY_RECEIPT_EVENT)
    .map((e) => parseParsimonyReceipt(e.payload));
}

describe('parsimony executor — advisory Check-layer gate [CLM-0172]', () => {
  it('a CLEAN diff emits a receipt with deferred=null and a PASS Verdict with no findings', async () => {
    const kern = kernloopFor('parsimony-clean');
    const executors = buildLoopExecutors(
      bindingsFor(kern, refsWithDiff, assessor(cleanAssessment)),
    );
    const verdict = (await executors['parsimony']?.(undefined, ctxFor(3))) as Verdict;
    expect(verdict.gate).toBe('parsimony');
    expect(verdict.result).toBe('pass');
    expect(verdict.findings).toEqual([]);
    const r = receipts(kern.paths.audit);
    expect(r).toHaveLength(1);
    expect(r[0]?.deferred).toBeNull();
    expect(r[0]?.subject).toBe(task.id);
    expect(r[0]?.rationaleDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r[0]?.verification.status).toBe('pending'); // blind verifier runs in #7
    kern.close();
  });

  it('an applicable-UNSATISFIED floor entry forces a deferred block + a warn finding', async () => {
    const kern = kernloopFor('parsimony-deferred');
    const executors = buildLoopExecutors(
      bindingsFor(kern, refsWithDiff, assessor(deferringAssessment)),
    );
    const verdict = (await executors['parsimony']?.(undefined, ctxFor(3))) as Verdict;
    // Advisory: still PASS, but the deferral surfaces as a warn finding naming the risk.
    expect(verdict.result).toBe('pass');
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.severity).toBe('warn');
    expect(verdict.findings[0]?.message).toContain('input_validation');
    expect(verdict.findings[0]?.message).toContain('SI-10');
    const r = receipts(kern.paths.audit);
    expect(r).toHaveLength(1);
    expect(r[0]?.deferred).not.toBeNull();
    expect(r[0]?.deferred?.controlRisk).toContain('SI-10');
    kern.close();
  });

  it('a MALFORMED assessor output is a typed clean error — NO fabricated receipt', async () => {
    const kern = kernloopFor('parsimony-malformed');
    const garbage: LoopInvoke = () =>
      Promise.resolve({ output: 'I cannot produce JSON for this.', cost: COST });
    const executors = buildLoopExecutors(bindingsFor(kern, refsWithDiff, garbage));
    await expect(executors['parsimony']?.(undefined, ctxFor(3))).rejects.toBeInstanceOf(
      LoopParseError,
    );
    // No receipt was emitted on a fabricated/absent assessment.
    expect(receipts(kern.paths.audit)).toHaveLength(0);
    kern.close();
  });

  it('emits the receipt as a `parsimony.receipt` event on the hash-chained log', async () => {
    const kern = kernloopFor('parsimony-event');
    const executors = buildLoopExecutors(
      bindingsFor(kern, refsWithDiff, assessor(cleanAssessment)),
    );
    await executors['parsimony']?.(undefined, ctxFor(3));
    const types = readEnvelopes(kern.paths.audit).map((e) => e.type);
    expect(types).toContain(PARSIMONY_RECEIPT_EVENT);
    kern.close();
  });

  it('abstains honestly when no diff was stashed (a resume past implement)', async () => {
    const kern = kernloopFor('parsimony-nodiff');
    const executors = buildLoopExecutors(bindingsFor(kern, {}, assessor(cleanAssessment)));
    const verdict = (await executors['parsimony']?.(undefined, ctxFor(3))) as Verdict;
    expect(verdict.result).toBe('abstain');
    expect(receipts(kern.paths.audit)).toHaveLength(0); // nothing to assess ⇒ no receipt
    kern.close();
  });
});
