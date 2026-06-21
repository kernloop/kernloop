/**
 * The parsimony gate loop node [#411/#5, EPIC #407] — the Check layer of the
 * parsimony subsystem. Runs per fan-out child AFTER the review gate: it makes ONE
 * assessor model call over the child's diff, evaluates the restraint ladder and the
 * Control Floor, and EMITS a `parsimony.receipt` event onto the hash-chained audit
 * log. It returns an ADVISORY pass Verdict carrying any deferred-floor control risk
 * as `warn` findings.
 *
 * CHECK LAYER COMPLETES (#413/#7): a SECOND, independent, rationale-BLIND model call
 * (`verifyFloor`, parsimony-verify.ts) now re-checks the assessor's CLAIMED-PASS floor
 * guards against the same diff and sets the receipt's `verification` verdict to a REAL
 * `confirmed`/`refuted` (with `checkedFloor:true`) instead of `pending`. The verdict
 * is now genuine evidence.
 *
 * HONEST SCOPE: the gate STAYS ADVISORY. It still returns a PASS Verdict regardless of
 * the verdict; a `refuted` verification adds a `warn` finding naming the refuted
 * guard(s) but does NOT reject/block (so the loop completes exactly as before — this
 * change is additive, non-behavior-changing). ENFORCEMENT — rejecting on a refute, and
 * intensity gating — is #9, a SEPARATE later PR. Mirrors the review-gate executor: same
 * child-id + written-diff plumbing and the same `publishVerdict` audit.
 */
import { createHash, randomUUID } from 'node:crypto';
import { VerdictSchema, type Finding, type Verdict } from '@kernloop/contracts';
import {
  PARSIMONY_RECEIPT_EVENT,
  ParsimonyReceiptSchema,
  buildParsimonyReceipt,
  evaluateFloor,
  evaluateLadder,
  type FloorCheck,
  type ParsimonyReceipt,
  type Verification,
} from '@kernloop/parsimony';
import { appendEvent, type JsonValue } from '@kernloop/kernel';
import type { NodeExecutor } from '@kernloop/workflows';
import { publishVerdict } from '../executors.js';
import { writtenDiff } from './prompts.js';
import { assessParsimony, type AssessSeam, type ParsimonyAssessment } from './parsimony-assess.js';
import { verifyFloor, type VerifySeam } from './parsimony-verify.js';
import type { LoopBindings } from './executors.js';

/** The blind verifier's overlay id (#413/#7). The receipt's verification now carries
 * this verifier's REAL `confirmed`/`refuted` verdict (`checkedFloor:true`). */
const BLIND_VERIFIER = 'agent://verifier@isolated';

/** A `warn` finding naming the floor guard(s) the blind verifier REFUTED — the
 * advisory Verdict surfaces a claimed-but-unverified guard. #9 makes a refute REJECT
 * (at intensity full); here it is advisory only (the gate still passes). */
function refuteFinding(refutedChecks: readonly string[], subject: string): Finding[] {
  if (refutedChecks.length === 0) return [];
  return [
    {
      severity: 'warn' as const,
      message: `parsimony floor REFUTED on ${subject}: blind verifier rejects claimed guard(s) ${refutedChecks.join(', ')}`,
    },
  ];
}

/** A `warn` finding per deferred floor check, naming the control(s) at risk so the
 * advisory Verdict surfaces an unmitigated shortcut even before #7 can block it. */
function deferralFindings(checks: readonly FloorCheck[], subject: string): Finding[] {
  return checks
    .filter((c) => c.status === 'deferred')
    .map((c) => {
      const risk = c.controlIds.length > 0 ? c.controlIds.join(', ') : `${c.catalog}:${c.name}`;
      return {
        severity: 'warn' as const,
        message: `parsimony floor deferred on ${subject}: ${c.name} (control risk: ${risk})`,
      };
    });
}

/** An honest abstain Verdict — there was no diff to assess (a resume past implement),
 * so the gate fabricates nothing (parity with the review gate). */
function abstainVerdict(childId: string): Verdict {
  return VerdictSchema.parse({
    taskId: childId,
    gate: 'parsimony',
    result: 'abstain',
    confidence: 0,
    findings: [],
    cost: { tokens: 0, usd: 0, wallClockMs: 0 },
  });
}

/**
 * BLIND VERIFICATION (#413/#7) — a SECOND, independent model call re-checking the
 * CLAIMED-PASS floor guards against the diff, BLIND to the assessor's rationale (it
 * gets the diff + the guard NAMES only; the rationale is never passed). It routes
 * through the SAME review-tier invoke as the assessor. With NO claimed-pass guard
 * there is nothing the verifier could refute, so the verification CONFIRMS VACUOUSLY
 * WITHOUT a model call (honest: no spend, and the floor WAS checked — there was simply
 * no claimed guard). `checkedFloor` is true either way: the floor was examined.
 */
async function runBlindVerification(
  b: LoopBindings,
  childId: string,
  diff: string,
  floorChecks: readonly FloorCheck[],
): Promise<{
  verification: Verification;
  refutedChecks: string[];
  cost: { tokens: number; usd: number };
}> {
  const base: Verification = {
    method: 'blind_independent',
    verifier: BLIND_VERIFIER,
    checkedFloor: true,
    status: 'confirmed',
  };
  const claimedPass = floorChecks.filter((c) => c.status === 'pass');
  if (claimedPass.length === 0) {
    return { verification: base, refutedChecks: [], cost: { tokens: 0, usd: 0 } };
  }
  const verifySeam: VerifySeam = {
    overlayDir: b.kern.paths.dir,
    childId,
    invoke: b.invokeFor('review').invoke,
  };
  const result = await verifyFloor(verifySeam, diff, claimedPass);
  return {
    verification: { ...base, status: result.status },
    refutedChecks: result.refutedChecks,
    cost: result.cost,
  };
}

/** Build the receipt with `verification` PENDING (the verifier verdict is set after).
 * The assessor's rationale is hashed into `rationaleDigest`, never stored (so the
 * blind verifier never sees it). */
function buildBaseReceipt(
  b: LoopBindings,
  childId: string,
  loopIter: number,
  assessment: ParsimonyAssessment,
  floorChecks: readonly FloorCheck[],
): ParsimonyReceipt {
  const overlay = b.kern.config.id;
  return buildParsimonyReceipt({
    receiptId: randomUUID(),
    ts: new Date().toISOString(),
    loopIter,
    overlay,
    subject: childId,
    ladder: evaluateLadder(assessment.signals),
    floorChecks,
    rationaleDigest: `sha256:${createHash('sha256').update(assessment.rationale).digest('hex')}`,
    verifier: BLIND_VERIFIER, // verification verdict resolved by the blind verifier
    owner: overlay,
  });
}

/**
 * Assess the diff, evaluate the ladder + floor, run the BLIND verifier (#413), EMIT the
 * `parsimony.receipt` event with the real verification verdict, and return the advisory
 * pass Verdict. A malformed assessment OR verifier verdict throws here (raw output
 * preserved) — NO receipt is emitted on a fabricated assessment.
 */
async function assessAndReceipt(
  b: LoopBindings,
  childId: string,
  loopIter: number,
  diff: string,
): Promise<Verdict> {
  // The assessor is a REASONING/tool-free judgment over text, like review — so it
  // routes through the review-tier seam (no parallel tier map; node-model.ts stays
  // the single source of truth, CLM-0078).
  const seam: AssessSeam = {
    overlayDir: b.kern.paths.dir,
    childId,
    invoke: b.invokeFor('review').invoke,
  };
  const { assessment, cost } = await assessParsimony(seam, diff);
  const floorChecks = evaluateFloor(assessment.floorContext, assessment.satisfied);
  const baseReceipt = buildBaseReceipt(b, childId, loopIter, assessment, floorChecks);
  const verify = await runBlindVerification(b, childId, diff, floorChecks);
  return emitReceiptAndAdvise(b, childId, floorChecks, baseReceipt, verify, cost);
}

/**
 * Override the receipt's verification with the blind verifier's REAL verdict and
 * re-validate (schema-valid by construction — only `verification` changed; the deferred
 * invariant is independent of it), EMIT it as a `parsimony.receipt` event on the
 * hash-chained, HMAC-keyed audit log, and return the ADVISORY pass Verdict. The Verdict
 * is PASS regardless of deferrals OR a refute — each surfaces as a `warn` finding only.
 * #9 makes a REFUTED verification (at intensity full) a rejecting Verdict.
 */
function emitReceiptAndAdvise(
  b: LoopBindings,
  childId: string,
  floorChecks: readonly FloorCheck[],
  baseReceipt: ParsimonyReceipt,
  verify: {
    verification: Verification;
    refutedChecks: string[];
    cost: { tokens: number; usd: number };
  },
  assessCost: { tokens: number; usd: number },
): Verdict {
  const receipt = ParsimonyReceiptSchema.parse({
    ...baseReceipt,
    verification: verify.verification,
  });
  // Round-trip to JsonValue so an optional-but-absent field (a check's `evidenceRef`)
  // is dropped as JSON requires — the stored payload is exactly the serialized receipt.
  appendEvent(b.kern.store, {
    type: PARSIMONY_RECEIPT_EVENT,
    payload: JSON.parse(JSON.stringify(receipt)) as JsonValue,
  });
  return VerdictSchema.parse({
    taskId: childId,
    gate: 'parsimony',
    result: 'pass',
    confidence: 1,
    findings: [
      ...deferralFindings(floorChecks, childId),
      ...refuteFinding(verify.refutedChecks, childId),
    ],
    cost: {
      tokens: assessCost.tokens + verify.cost.tokens,
      usd: assessCost.usd + verify.cost.usd,
      wallClockMs: 0,
    },
  });
}

/**
 * The parsimony gate node. Reads the child's diff exactly as the review gate does;
 * with no diff (a resume that landed past implement) there is nothing to assess, so
 * it abstains honestly rather than fabricating a receipt — parity with review.
 */
export function parsimonyExecutor(b: LoopBindings): NodeExecutor {
  return async (_input, ctx) => {
    const childId = ctx.child?.id ?? ctx.taskId;
    const files = b.refs.writtenByChild?.[childId] ?? [];
    const verdict =
      files.length === 0
        ? abstainVerdict(childId)
        : await assessAndReceipt(b, childId, ctx.iteration, writtenDiff(files));
    await publishVerdict(b.kern, verdict);
    return verdict;
  };
}
