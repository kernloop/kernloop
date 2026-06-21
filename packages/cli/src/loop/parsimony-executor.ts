/**
 * The parsimony gate loop node [#411/#5, EPIC #407] — the Check layer of the
 * parsimony subsystem. Runs per fan-out child AFTER the review gate: it makes ONE
 * assessor model call over the child's diff, evaluates the restraint ladder and the
 * Control Floor, and EMITS a `parsimony.receipt` event onto the hash-chained audit
 * log. It returns an ADVISORY pass Verdict carrying any deferred-floor control risk
 * as `warn` findings.
 *
 * HONEST SCOPE: this increment is evidence EMISSION, not enforcement. The receipt's
 * blind-verification verdict stays `pending` (the blind verifier runs in #7) and the
 * gate PASSES regardless of deferrals — #7 flips a refuted verification to a
 * rejecting Verdict, and intensity gating is #9. Mirrors the review-gate executor:
 * same child-id + written-diff plumbing and the same `publishVerdict` audit.
 */
import { createHash, randomUUID } from 'node:crypto';
import { VerdictSchema, type Finding, type Verdict } from '@kernloop/contracts';
import {
  PARSIMONY_RECEIPT_EVENT,
  buildParsimonyReceipt,
  evaluateFloor,
  evaluateLadder,
  type FloorCheck,
} from '@kernloop/parsimony';
import { appendEvent, type JsonValue } from '@kernloop/kernel';
import type { NodeExecutor } from '@kernloop/workflows';
import { publishVerdict } from '../executors.js';
import { writtenDiff } from './prompts.js';
import { assessParsimony, type AssessSeam } from './parsimony-assess.js';
import type { LoopBindings } from './executors.js';

/** The blind verifier's overlay id (#7). A real field — the receipt's verification
 * is genuinely `pending` against this verifier until #7 runs it, never a stub. */
const BLIND_VERIFIER = 'agent://verifier@isolated';

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
 * Assess the diff, evaluate the ladder + floor, EMIT the `parsimony.receipt` event,
 * and return the advisory pass Verdict. A malformed assessment throws here (raw
 * output preserved) — NO receipt is emitted on a fabricated assessment.
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
  const overlay = b.kern.config.id;
  const receipt = buildParsimonyReceipt({
    receiptId: randomUUID(),
    ts: new Date().toISOString(),
    loopIter,
    overlay,
    subject: childId,
    ladder: evaluateLadder(assessment.signals),
    floorChecks,
    rationaleDigest: `sha256:${createHash('sha256').update(assessment.rationale).digest('hex')}`,
    verifier: BLIND_VERIFIER, // genuinely pending until the blind verifier (#7) runs
    owner: overlay,
  });
  // The receipt rides the hash-chained, HMAC-keyed audit log (it is the payload of a
  // `parsimony.receipt` event, not a sixth Frozen-Five contract). Round-trip to a
  // JsonValue so an optional-but-absent field (a check's `evidenceRef`) is dropped as
  // JSON requires — the stored payload is exactly the serialized receipt.
  appendEvent(b.kern.store, {
    type: PARSIMONY_RECEIPT_EVENT,
    payload: JSON.parse(JSON.stringify(receipt)) as JsonValue,
  });
  // ADVISORY in this increment: PASS regardless of deferrals, surfacing each as a
  // `warn` finding. #7 flips a REFUTED blind verification to a rejecting Verdict.
  return VerdictSchema.parse({
    taskId: childId,
    gate: 'parsimony',
    result: 'pass',
    confidence: 1,
    findings: deferralFindings(floorChecks, childId),
    cost: { tokens: cost.tokens, usd: cost.usd, wallClockMs: 0 },
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
