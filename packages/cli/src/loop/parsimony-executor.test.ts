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

/** A blind-verifier CONFIRM verdict (the default for a clean diff). */
const CONFIRM = JSON.stringify({ status: 'confirmed', refutedChecks: [], reason: 'guards hold' });

/**
 * A combined invoke: returns the canned assessment for the ASSESSOR prompt and a
 * blind-verifier verdict for the VERIFIER prompt (#413). `verifier` defaults to a
 * CONFIRM; pass a refute to exercise the advisory warn path. The verifier prompt is
 * captured so a test can assert it is BLIND to the assessor's rationale.
 */
function assessor(
  assessment: unknown,
  verifier: string = CONFIRM,
): LoopInvoke & { verifierPrompts: string[] } {
  const verifierPrompts: string[] = [];
  const invoke = ((prompt: string) => {
    if (prompt.includes('BLIND PARSIMONY VERIFIER')) {
      verifierPrompts.push(prompt);
      return Promise.resolve({ output: verifier, cost: COST });
    }
    return Promise.resolve({ output: JSON.stringify(assessment), cost: COST });
  }) as LoopInvoke & { verifierPrompts: string[] };
  invoke.verifierPrompts = verifierPrompts;
  return invoke;
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
    // The blind verifier (#413/#7) ran and CONFIRMED — verification is now real evidence.
    expect(r[0]?.verification.status).toBe('confirmed');
    expect(r[0]?.verification.checkedFloor).toBe(true);
    kern.close();
  });

  it('a REFUTED blind verification adds a warn finding but the Verdict still PASSES (advisory)', async () => {
    const kern = kernloopFor('parsimony-refuted');
    const refute = JSON.stringify({
      status: 'refuted',
      refutedChecks: ['intent'],
      reason: 'the diff does not actually satisfy intent',
    });
    const executors = buildLoopExecutors(
      bindingsFor(kern, refsWithDiff, assessor(cleanAssessment, refute)),
    );
    const verdict = (await executors['parsimony']?.(undefined, ctxFor(3))) as Verdict;
    // ADVISORY in this PR: a refute is a warn finding, NOT a reject (#9 makes it reject).
    expect(verdict.result).toBe('pass');
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.severity).toBe('warn');
    expect(verdict.findings[0]?.message).toContain('REFUTED');
    expect(verdict.findings[0]?.message).toContain('intent');
    const r = receipts(kern.paths.audit);
    expect(r[0]?.verification.status).toBe('refuted');
    expect(r[0]?.verification.checkedFloor).toBe(true);
    kern.close();
  });

  it('the blind verifier is NOT given the assessor rationale (blind verification)', async () => {
    const kern = kernloopFor('parsimony-blind');
    const invoke = assessor(cleanAssessment); // rationale: "reuses the stdlib; nothing crosses..."
    const executors = buildLoopExecutors(bindingsFor(kern, refsWithDiff, invoke));
    await executors['parsimony']?.(undefined, ctxFor(3));
    expect(invoke.verifierPrompts).toHaveLength(1);
    const prompt = invoke.verifierPrompts[0] ?? '';
    // The verifier prompt must NOT carry the assessor's self-justification.
    expect(prompt).not.toContain(cleanAssessment.rationale);
    expect(prompt).toContain('BLIND PARSIMONY VERIFIER');
    expect(prompt).toContain('intent'); // it DOES get the claimed-pass guard names
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

  it('NO claimed-pass guard ⇒ verification CONFIRMS vacuously WITHOUT a verifier call', async () => {
    const kern = kernloopFor('parsimony-vacuous');
    // Nothing requested + a trust boundary but no validation ⇒ intent is `na`,
    // input_validation is `deferred`: ZERO `pass` checks ⇒ nothing to verify.
    const noPass = {
      ...deferringAssessment,
      floorContext: { ...deferringAssessment.floorContext, wasRequested: false },
      satisfied: {}, // nothing claimed satisfied
    };
    const invoke = assessor(noPass);
    const executors = buildLoopExecutors(bindingsFor(kern, refsWithDiff, invoke));
    const verdict = (await executors['parsimony']?.(undefined, ctxFor(3))) as Verdict;
    expect(verdict.result).toBe('pass');
    expect(invoke.verifierPrompts).toHaveLength(0); // no claimed-pass ⇒ NO verifier call
    const r = receipts(kern.paths.audit);
    expect(r[0]?.verification.status).toBe('confirmed'); // vacuously confirmed
    expect(r[0]?.verification.checkedFloor).toBe(true);
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
