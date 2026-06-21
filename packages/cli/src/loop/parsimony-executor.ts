/**
 * The parsimony gate loop node [#411/#5, EPIC #407] — the Check layer of the
 * parsimony subsystem. Runs per fan-out child AFTER the review gate: it makes ONE
 * assessor model call over the child's diff, evaluates the restraint ladder and the
 * Control Floor, runs a SECOND blind floor verifier, and EMITS a `parsimony.receipt`
 * event onto the hash-chained audit log.
 *
 * INTENSITY DIAL + ENFORCEMENT (#9/#415). The overlay's `gates.parsimony.intensity`
 * (off|lite|full|ultra, DEFAULT full) controls how the gate's verdict GATES the loop:
 *
 * - off   — NO work: an immediate abstain Verdict, no assessor/verifier model calls,
 *           no receipt. Fully disables parsimony; cheapest.
 * - lite  — ADVISORY (the pre-#9 behavior): assess + verify + emit receipt; result
 *           `pass`; deferrals + refutes are `warn` findings only, never reject.
 * - full  — DEFAULT: assess + verify + emit receipt. A REFUTED blind verification →
 *           result `reject` (the child RE-ITERATES with the floor findings folded in,
 *           bounded by Kc) — or `escalate` when `escalateOnRefute`. A confirmed
 *           verification → `pass`. A DEFERRED floor check stays a `warn` finding
 *           (debt is ALLOWED at full).
 * - ultra — full PLUS: any DEFERRED floor check ALSO rejects (no debt allowed; same
 *           escalate-vs-reject rule via `escalateOnRefute`).
 *
 * HOW A REJECT DRIVES RE-ITERATION: the parsimony node is a child sub-gate exactly
 * like quality/review. When intensity is full/ultra the CLI sets
 * `parsimonyDrivesIteration` on the engine (engine-build.ts), so the workflows engine
 * routes a parsimony `reject` through the SAME child-iterate back-edge as a quality
 * reject (steps.ts `advanceChildGate` → `childBranch` → `reiterateChild`): the floor
 * findings fold into `child.findings`, `child.iteration` bumps, and implement re-runs
 * (bounded by Kc). An `escalate` Verdict halts the child for a human (#192). At lite
 * the gate is non-driving (its findings only fold in as hints, never re-implement).
 *
 * HONEST RESIDUAL (#7 consensus, recorded on #415 — do NOT claim evasion-proof):
 *   1. The blind verifier is ANSWER-KEY-ANCHORED. It re-checks the guards the assessor
 *      CLAIMED `pass` and refutes a claimed-pass the diff does not actually provide
 *      (pass-OVER-claims). It does NOT independently derive the FloorContext from the
 *      diff, so it does NOT catch applicability-UNDER-claims: an assessor that reports
 *      a floor flag false / a guard `na` when the diff REALLY crosses that boundary
 *      bypasses both the verifier (nothing claimed-pass to refute) AND the deferral
 *      (nothing deferred). Catching that gap — the verifier deriving the FloorContext
 *      itself and the executor refuting on a missed boundary — is a filed follow-up
 *      (#435). The claim scopes this honestly.
 *   2. VACUOUS-CONFIRM: with zero claimed-`pass` guards the verifier confirms WITHOUT a
 *      model call (nothing to refute). At full/ultra this is sound ONLY because a
 *      vacuous confirm cannot whitewash deferred checks — the deferral logic below runs
 *      INDEPENDENTLY of the verification status (a deferred check is a `warn` at full /
 *      a reject at ultra regardless of a vacuous `confirmed`). See
 *      {@link decideVerdict}.
 *   3. OVER-CAP REFUTE: a diff over MAX_ASSESS_CHUNKS is refuted by verifyFloor outright
 *      (it cannot be fully verified). At full/ultra that rejects a legitimate huge
 *      change; the refute finding NAMES the reason (too-large vs guard-unmet) so an
 *      operator can tell why ({@link refuteFinding}).
 *   4. DETERMINISTIC-FALSE-REFUTE COST: a re-iterated reject costs ONE extra child
 *      attempt only when the next attempt fixes the refute. A verifier that PERSISTENTLY
 *      misreads a guard the diff genuinely satisfies (a fixed diff, not transient noise)
 *      cannot be fixed by re-iterating — it burns the FULL Kc budget, re-charging
 *      assessor+verifier each attempt, then terminates with a parsimony reject. Bounded
 *      (never an infinite wedge) but worst-case Kc×(assess+verify), not one. The blind
 *      verifier's false-refute rate is unmeasured; the FP-rate harness is a follow-up
 *      (#436). `off`/`lite` are the zero-cost / advisory escape hatches.
 */
import { createHash, randomUUID } from 'node:crypto';
import { VerdictSchema, type Finding, type Verdict, type VerdictResult } from '@kernloop/contracts';
import {
  PARSIMONY_RECEIPT_EVENT,
  ParsimonyReceiptSchema,
  buildParsimonyReceipt,
  evaluateFloor,
  evaluateLadder,
  floorHasDeferral,
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

/** The blind verifier's overlay id (#413/#7). The receipt's verification carries
 * this verifier's REAL `confirmed`/`refuted` verdict (`checkedFloor:true`). */
const BLIND_VERIFIER = 'agent://verifier@isolated';

/** The parsimony intensity dial (#9/#415); the overlay default is `full`. */
export type ParsimonyIntensity = 'off' | 'lite' | 'full' | 'ultra';

/** Whether this intensity ENFORCES (a rejecting verdict gates the loop) vs is
 * advisory (lite: pass-only) or disabled (off). full + ultra enforce. */
function enforces(intensity: ParsimonyIntensity): boolean {
  return intensity === 'full' || intensity === 'ultra';
}

/** A finding naming the floor guard(s) the blind verifier REFUTED. The text
 * DISTINGUISHES an over-cap refute ("too large to verify") from a guard-unmet
 * refute (a claimed-pass the diff does not provide) so an operator can tell why a
 * legitimate huge change was rejected vs an actual unmet guard (#7 condition 2).
 * Severity is `error` when the gate enforces (the verdict will reject), `warn` at
 * lite (advisory). */
function refuteFinding(
  refutedChecks: readonly string[],
  subject: string,
  intensity: ParsimonyIntensity,
): Finding[] {
  if (refutedChecks.length === 0) return [];
  const severity = enforces(intensity) ? ('error' as const) : ('warn' as const);
  return [
    {
      severity,
      message: `parsimony floor REFUTED on ${subject}: blind verifier rejects claimed guard(s) ${refutedChecks.join(', ')} (either a guard is actually unmet by the diff, or the diff was too large to fully verify — see the parsimony.receipt verification)`,
    },
  ];
}

/** A finding per deferred floor check, naming the control(s) at risk. Severity is
 * `error` at ULTRA (a deferral rejects there — no debt allowed) and `warn`
 * otherwise (debt is allowed at lite/full). */
function deferralFindings(
  checks: readonly FloorCheck[],
  subject: string,
  intensity: ParsimonyIntensity,
): Finding[] {
  const severity = intensity === 'ultra' ? ('error' as const) : ('warn' as const);
  return checks
    .filter((c) => c.status === 'deferred')
    .map((c) => {
      const risk = c.controlIds.length > 0 ? c.controlIds.join(', ') : `${c.catalog}:${c.name}`;
      return {
        severity,
        message: `parsimony floor deferred on ${subject}: ${c.name} (control risk: ${risk})`,
      };
    });
}

/** An honest abstain Verdict — there was no diff to assess (a resume past implement),
 * OR intensity is `off` (the gate does no work). The gate fabricates nothing. */
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
 * Decide the parsimony Verdict RESULT by intensity (#9/#415), the single point the
 * dial gates the loop. INDEPENDENT of the vacuous-confirm path (#7 condition 1): a
 * deferral rejects at ultra regardless of whether verification confirmed vacuously,
 * because `hasDeferral` is read from the floor checks, not the verification.
 *
 * - lite  → always `pass` (advisory; deferrals/refutes are `warn` findings only).
 * - full  → `reject` (or `escalate`) on a REFUTE; `pass` otherwise (debt allowed).
 * - ultra → `reject` (or `escalate`) on a refute OR a deferral; `pass` otherwise.
 *
 * `escalateOnRefute` flips a rejecting outcome to `escalate` (the loop halts for a
 * human, #192) instead of `reject` (the child re-iterates within Kc).
 */
export function decideVerdict(
  intensity: ParsimonyIntensity,
  refuted: boolean,
  hasDeferral: boolean,
  escalateOnRefute: boolean,
): VerdictResult {
  if (intensity === 'lite') return 'pass';
  const blocks = refuted || (intensity === 'ultra' && hasDeferral);
  if (!blocks) return 'pass';
  return escalateOnRefute ? 'escalate' : 'reject';
}

/**
 * Assess the diff, evaluate the ladder + floor, run the BLIND verifier (#413), EMIT
 * the `parsimony.receipt` event with the real verification verdict, and return the
 * intensity-gated Verdict. A malformed assessment OR verifier verdict throws here (raw
 * output preserved) — NO receipt is emitted on a fabricated assessment.
 */
async function assessAndReceipt(
  b: LoopBindings,
  childId: string,
  loopIter: number,
  diff: string,
  intensity: ParsimonyIntensity,
  escalateOnRefute: boolean,
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
  return emitReceiptAndGate(b, childId, floorChecks, baseReceipt, verify, cost, {
    intensity,
    escalateOnRefute,
  });
}

/**
 * Override the receipt's verification with the blind verifier's REAL verdict and
 * re-validate (schema-valid by construction — only `verification` changed), EMIT it as
 * a `parsimony.receipt` event on the hash-chained, HMAC-keyed audit log, and return the
 * INTENSITY-GATED Verdict. At lite the result is always `pass` (deferrals/refutes are
 * `warn` findings only); at full/ultra a refute (and at ultra a deferral) drives a
 * `reject` (or `escalate`). The findings NAME why (the refuted guards / the deferred
 * control risk) so the re-iterating coder gets actionable feedback — mirroring how the
 * review gate folds findings into the next implement.
 */
function emitReceiptAndGate(
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
  dial: { intensity: ParsimonyIntensity; escalateOnRefute: boolean },
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
  const refuted = verify.refutedChecks.length > 0;
  const hasDeferral = floorHasDeferral(floorChecks);
  const result = decideVerdict(dial.intensity, refuted, hasDeferral, dial.escalateOnRefute);
  return VerdictSchema.parse({
    taskId: childId,
    gate: 'parsimony',
    result,
    confidence: 1,
    findings: [
      ...deferralFindings(floorChecks, childId, dial.intensity),
      ...refuteFinding(verify.refutedChecks, childId, dial.intensity),
    ],
    cost: {
      tokens: assessCost.tokens + verify.cost.tokens,
      usd: assessCost.usd + verify.cost.usd,
      wallClockMs: 0,
    },
  });
}

/**
 * The parsimony gate node. Reads the child's diff exactly as the review gate does.
 * At intensity `off` the gate does NO work — it abstains immediately (no assessor /
 * verifier model call, no receipt). With no diff (a resume that landed past implement)
 * there is nothing to assess, so it also abstains rather than fabricating a receipt —
 * parity with review. Otherwise it assesses, verifies, emits the receipt, and returns
 * the intensity-gated Verdict (lite advisory; full/ultra enforce).
 */
export function parsimonyExecutor(b: LoopBindings): NodeExecutor {
  return async (_input, ctx) => {
    const { intensity, escalateOnRefute } = b.kern.config.gates.parsimony;
    const childId = ctx.child?.id ?? ctx.taskId;
    const files = b.refs.writtenByChild?.[childId] ?? [];
    const verdict =
      intensity === 'off' || files.length === 0
        ? abstainVerdict(childId)
        : await assessAndReceipt(
            b,
            childId,
            ctx.iteration,
            writtenDiff(files),
            intensity,
            escalateOnRefute,
          );
    await publishVerdict(b.kern, verdict);
    return verdict;
  };
}
