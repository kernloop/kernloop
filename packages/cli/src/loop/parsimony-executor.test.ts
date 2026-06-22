/**
 * The parsimony gate loop node [#411/#5, EPIC #407] — the Check layer with the
 * INTENSITY DIAL + ENFORCEMENT (#9/#415, CLM-0177). Asserts the per-intensity gate
 * contract:
 *  - off   — NO assessor/verifier model call, NO receipt, an abstain Verdict.
 *  - lite  — advisory: assess + verify + emit receipt; PASS even on a refute or a
 *            deferral (each a `warn` finding only).
 *  - full  — DEFAULT: a refute → REJECT (the child re-iterates); a confirm → PASS;
 *            a deferral stays a `warn` finding (debt allowed at full).
 *  - ultra — full PLUS a deferral → REJECT; a refute → REJECT.
 *  - escalateOnRefute — a rejecting outcome emits `escalate` instead of `reject`.
 * Plus: a clean diff's receipt + blind verification, the blindness of the verifier,
 * the vacuous-confirm path, a malformed assessment is a typed clean error (no
 * fabricated receipt), and the receipt rides the hash-chained audit log. Scripted
 * assessor invoke + in-memory kern, mirroring the vote/review suites.
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

/** A blind-verifier REFUTE verdict (a claimed-pass guard the diff does not provide). */
const REFUTE = JSON.stringify({
  status: 'refuted',
  refutedChecks: ['intent'],
  reason: 'the diff does not actually satisfy intent',
});

/** An overlay yaml pinning the parsimony intensity (and disabling the quality sandbox). */
function overlayYaml(name: string, intensity: string, escalateOnRefute = false): string {
  return [
    `id: ${name}`,
    'gates:',
    '  quality:',
    '    sandbox:',
    '      enabled: false',
    '  parsimony:',
    `    intensity: ${intensity}`,
    `    escalateOnRefute: ${String(escalateOnRefute)}`,
    '',
  ].join('\n');
}

/**
 * A combined invoke: returns the canned assessment for the ASSESSOR prompt and a
 * blind-verifier verdict for the VERIFIER prompt (#413). `verifier` defaults to a
 * CONFIRM; pass a refute to exercise enforcement. The verifier prompt is captured so
 * a test can assert it is BLIND to the assessor's rationale.
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

/** Run the parsimony gate once for `intensity`, returning the Verdict + the kern. */
async function runGate(
  name: string,
  intensity: string,
  invoke: LoopInvoke,
  escalateOnRefute = false,
): Promise<{ verdict: Verdict; auditPath: string; close: () => void }> {
  const kern = kernloopFor(name, overlayYaml(name, intensity, escalateOnRefute));
  const executors = buildLoopExecutors(bindingsFor(kern, refsWithDiff, invoke));
  const verdict = (await executors['parsimony']?.(undefined, ctxFor(3))) as Verdict;
  return { verdict, auditPath: kern.paths.audit, close: () => kern.close() };
}

describe('parsimony intensity: off — no work [CLM-0177]', () => {
  it('off does NO assessor/verifier model call, emits NO receipt, abstains', async () => {
    const invoke = assessor(cleanAssessment);
    let assessorCalls = 0;
    const counting: LoopInvoke = (prompt) => {
      if (!prompt.includes('BLIND PARSIMONY VERIFIER')) assessorCalls += 1;
      return invoke(prompt);
    };
    const { verdict, auditPath, close } = await runGate('parsimony-off', 'off', counting);
    expect(verdict.gate).toBe('parsimony');
    expect(verdict.result).toBe('abstain');
    expect(verdict.findings).toEqual([]);
    expect(verdict.cost).toEqual({ tokens: 0, usd: 0, wallClockMs: 0 });
    expect(invoke.verifierPrompts).toHaveLength(0); // no verifier call
    expect(assessorCalls).toBe(0); // no assessor call
    expect(receipts(auditPath)).toHaveLength(0); // no receipt
    close();
  });
});

describe('parsimony intensity: lite — advisory [CLM-0177]', () => {
  it('a CLEAN diff emits a receipt with deferred=null and a PASS Verdict with no findings', async () => {
    const { verdict, auditPath, close } = await runGate(
      'parsimony-lite-clean',
      'lite',
      assessor(cleanAssessment),
    );
    expect(verdict.result).toBe('pass');
    expect(verdict.findings).toEqual([]);
    const r = receipts(auditPath);
    expect(r).toHaveLength(1);
    expect(r[0]?.deferred).toBeNull();
    expect(r[0]?.subject).toBe(task.id);
    expect(r[0]?.rationaleDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r[0]?.verification.status).toBe('confirmed');
    expect(r[0]?.verification.checkedFloor).toBe(true);
    close();
  });

  it('a REFUTED blind verification adds a warn finding but the Verdict still PASSES (advisory)', async () => {
    const { verdict, auditPath, close } = await runGate(
      'parsimony-lite-refute',
      'lite',
      assessor(cleanAssessment, REFUTE),
    );
    expect(verdict.result).toBe('pass'); // advisory: refute is a warn, not a reject
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.severity).toBe('warn');
    expect(verdict.findings[0]?.message).toContain('REFUTED');
    expect(verdict.findings[0]?.message).toContain('intent');
    expect(receipts(auditPath)[0]?.verification.status).toBe('refuted');
    close();
  });

  // Title preserved for CLM-0172 (the prior advisory-deferral evidence) — at lite
  // (today's advisory semantics) an applicable-unsatisfied floor entry warns and passes.
  it('an applicable-UNSATISFIED floor entry forces a deferred block + a warn finding', async () => {
    const { verdict, auditPath, close } = await runGate(
      'parsimony-lite-defer',
      'lite',
      assessor(deferringAssessment),
    );
    expect(verdict.result).toBe('pass');
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.severity).toBe('warn');
    expect(verdict.findings[0]?.message).toContain('input_validation');
    expect(verdict.findings[0]?.message).toContain('SI-10');
    const r = receipts(auditPath);
    expect(r[0]?.deferred).not.toBeNull();
    expect(r[0]?.deferred?.controlRisk).toContain('SI-10');
    close();
  });

  it('the blind verifier is NOT given the assessor rationale (blind verification)', async () => {
    const invoke = assessor(cleanAssessment);
    const { close } = await runGate('parsimony-lite-blind', 'lite', invoke);
    expect(invoke.verifierPrompts).toHaveLength(1);
    const prompt = invoke.verifierPrompts[0] ?? '';
    expect(prompt).not.toContain(cleanAssessment.rationale);
    expect(prompt).toContain('BLIND PARSIMONY VERIFIER');
    expect(prompt).toContain('intent');
    close();
  });
});

describe('parsimony intensity: full (DEFAULT) — enforce on refute [CLM-0177]', () => {
  it('full is the schema default ⇒ a fresh overlay enforces (a refute rejects)', async () => {
    // No `gates.parsimony` block at all ⇒ intensity defaults to full.
    const kern = kernloopFor('parsimony-default');
    const executors = buildLoopExecutors(
      bindingsFor(kern, refsWithDiff, assessor(cleanAssessment, REFUTE)),
    );
    const verdict = (await executors['parsimony']?.(undefined, ctxFor(3))) as Verdict;
    expect(verdict.result).toBe('reject');
    kern.close();
  });

  it('a CONFIRMED verification PASSES (the receipt rides the log)', async () => {
    const { verdict, auditPath, close } = await runGate(
      'parsimony-full-confirm',
      'full',
      assessor(cleanAssessment),
    );
    expect(verdict.result).toBe('pass');
    expect(verdict.findings).toEqual([]);
    expect(receipts(auditPath)).toHaveLength(1);
    close();
  });

  it('a REFUTED verification REJECTS with an error finding naming the refuted guard(s)', async () => {
    const { verdict, auditPath, close } = await runGate(
      'parsimony-full-refute',
      'full',
      assessor(cleanAssessment, REFUTE),
    );
    expect(verdict.result).toBe('reject'); // ENFORCE: the child re-iterates
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.severity).toBe('error');
    expect(verdict.findings[0]?.message).toContain('REFUTED');
    expect(verdict.findings[0]?.message).toContain('intent');
    // The receipt is still emitted (the verdict is honest evidence).
    expect(receipts(auditPath)[0]?.verification.status).toBe('refuted');
    close();
  });

  it('a DEFERRAL with a confirmed verification PASSES (debt is allowed at full)', async () => {
    const { verdict, auditPath, close } = await runGate(
      'parsimony-full-defer',
      'full',
      assessor(deferringAssessment), // verifier confirms (vacuous: no claimed-pass beyond intent)
    );
    expect(verdict.result).toBe('pass'); // debt allowed: deferral is a warn, not a reject
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.severity).toBe('warn');
    expect(verdict.findings[0]?.message).toContain('input_validation');
    expect(receipts(auditPath)[0]?.deferred).not.toBeNull();
    close();
  });
});

describe('parsimony intensity: ultra — no debt allowed [CLM-0177]', () => {
  it('a DEFERRAL REJECTS at ultra (no debt) with an error finding naming the control risk', async () => {
    const { verdict, auditPath, close } = await runGate(
      'parsimony-ultra-defer',
      'ultra',
      assessor(deferringAssessment),
    );
    expect(verdict.result).toBe('reject'); // ultra: a deferral rejects
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.severity).toBe('error');
    expect(verdict.findings[0]?.message).toContain('input_validation');
    expect(verdict.findings[0]?.message).toContain('SI-10');
    expect(receipts(auditPath)[0]?.deferred).not.toBeNull();
    close();
  });

  it('a REFUTED verification also REJECTS at ultra', async () => {
    const { verdict, close } = await runGate(
      'parsimony-ultra-refute',
      'ultra',
      assessor(cleanAssessment, REFUTE),
    );
    expect(verdict.result).toBe('reject');
    close();
  });

  it('a clean confirmed diff with no deferral PASSES even at ultra', async () => {
    const { verdict, close } = await runGate(
      'parsimony-ultra-clean',
      'ultra',
      assessor(cleanAssessment),
    );
    expect(verdict.result).toBe('pass');
    close();
  });
});

describe('parsimony escalateOnRefute — halt for a human, not re-iterate [CLM-0177]', () => {
  it('a refute at full ESCALATES instead of rejecting when escalateOnRefute is on', async () => {
    const { verdict, close } = await runGate(
      'parsimony-escalate-full',
      'full',
      assessor(cleanAssessment, REFUTE),
      true,
    );
    expect(verdict.result).toBe('escalate');
    close();
  });

  it('a deferral at ultra ESCALATES when escalateOnRefute is on', async () => {
    const { verdict, close } = await runGate(
      'parsimony-escalate-ultra',
      'ultra',
      assessor(deferringAssessment),
      true,
    );
    expect(verdict.result).toBe('escalate');
    close();
  });
});

describe('parsimony — vacuous-confirm and honesty invariants [CLM-0177]', () => {
  it('NO claimed-pass guard ⇒ verification CONFIRMS vacuously WITHOUT a verifier call', async () => {
    // Nothing requested + a trust boundary but no validation ⇒ ZERO `pass` checks.
    // At ULTRA the deferral must STILL reject despite the vacuous confirm (#7 cond 1).
    const noPass = {
      ...deferringAssessment,
      floorContext: { ...deferringAssessment.floorContext, wasRequested: false },
      satisfied: {},
    };
    const invoke = assessor(noPass);
    const { verdict, auditPath, close } = await runGate('parsimony-vacuous-ultra', 'ultra', invoke);
    expect(invoke.verifierPrompts).toHaveLength(0); // no claimed-pass ⇒ NO verifier call
    expect(receipts(auditPath)[0]?.verification.status).toBe('confirmed'); // vacuously confirmed
    expect(verdict.result).toBe('reject'); // the deferral blocks despite the vacuous confirm
    close();
  });

  it('the same vacuous-confirm deferral only WARNS (passes) at full (debt allowed)', async () => {
    const noPass = {
      ...deferringAssessment,
      floorContext: { ...deferringAssessment.floorContext, wasRequested: false },
      satisfied: {},
    };
    const { verdict, close } = await runGate('parsimony-vacuous-full', 'full', assessor(noPass));
    expect(verdict.result).toBe('pass');
    close();
  });

  it('a MALFORMED assessor output is a typed clean error — NO fabricated receipt', async () => {
    const kern = kernloopFor('parsimony-malformed', overlayYaml('parsimony-malformed', 'full'));
    const garbage: LoopInvoke = () =>
      Promise.resolve({ output: 'I cannot produce JSON for this.', cost: COST });
    const executors = buildLoopExecutors(bindingsFor(kern, refsWithDiff, garbage));
    await expect(executors['parsimony']?.(undefined, ctxFor(3))).rejects.toBeInstanceOf(
      LoopParseError,
    );
    expect(receipts(kern.paths.audit)).toHaveLength(0);
    kern.close();
  });

  it('emits the receipt as a `parsimony.receipt` event on the hash-chained log', async () => {
    const { auditPath, close } = await runGate(
      'parsimony-event',
      'full',
      assessor(cleanAssessment),
    );
    const types = readEnvelopes(auditPath).map((e) => e.type);
    expect(types).toContain(PARSIMONY_RECEIPT_EVENT);
    close();
  });

  it('abstains honestly when no diff was stashed (a resume past implement)', async () => {
    const kern = kernloopFor('parsimony-nodiff', overlayYaml('parsimony-nodiff', 'full'));
    const executors = buildLoopExecutors(bindingsFor(kern, {}, assessor(cleanAssessment)));
    const verdict = (await executors['parsimony']?.(undefined, ctxFor(3))) as Verdict;
    expect(verdict.result).toBe('abstain');
    expect(receipts(kern.paths.audit)).toHaveLength(0);
    kern.close();
  });
});
