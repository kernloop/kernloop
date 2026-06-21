/**
 * Assemble a parsimony Decision Receipt from an evaluated decision [#411/#5,
 * EPIC #407]. Pure: the caller (the loop's parsimony gate) supplies the
 * non-deterministic fields (ULID, timestamp, loop iteration, overlay, subject,
 * rationale digest, verifier id) plus the {@link LadderResult} and the evaluated
 * {@link FloorCheck}s; this builds the validated {@link ParsimonyReceipt}.
 *
 * Closes #423 (the Contrarian finding on the floor): `DeferredSchema.controlRisk`
 * is `.min(1)`, but a Section-508 / intent-only floor miss yields NO 800-53
 * control id while still being a real deferral. So when a deferred check carries
 * no control id, this synthesizes a `<catalog>:<name>` SENTINEL risk token — the
 * `controlRisk` array stays non-empty (the receipt's deferred invariant holds) and
 * the OSCAL projection (#8) can still distinguish a non-control deferral from a
 * NIST one. An applicable unsatisfied guard can therefore never be dropped, whether
 * or not it maps to a NIST control.
 *
 * @module parsimony/build
 */
import {
  ParsimonyReceiptSchema,
  type FloorCheck,
  type ParsimonyReceipt,
  type Verification,
} from './receipt.js';
import type { LadderResult } from './ladder.js';

/** The non-deterministic + evaluated inputs the loop gate supplies to build a receipt. */
export interface ParsimonyDecision {
  readonly receiptId: string;
  readonly ts: string;
  readonly loopIter: number;
  readonly overlay: string;
  readonly subject: string;
  readonly ladder: LadderResult;
  readonly floorChecks: readonly FloorCheck[];
  readonly rationaleDigest: string;
  /** The blind verifier's id; verdict starts `pending` until #7 runs it. */
  readonly verifier: string;
  /** A human/owner reference recorded on a forced deferral block. */
  readonly owner: string;
}

/**
 * The risk tokens a deferral carries: the distinct 800-53 control ids of the
 * deferred checks, PLUS a `<catalog>:<name>` sentinel for any deferred check that
 * has no control id (Section 508 / intent) — so the set is non-empty whenever a
 * deferral happened (#423). Empty exactly when nothing deferred.
 */
export function deferredRisk(checks: readonly FloorCheck[]): string[] {
  const risk = new Set<string>();
  for (const c of checks) {
    if (c.status !== 'deferred') continue;
    if (c.controlIds.length > 0) for (const id of c.controlIds) risk.add(id);
    else risk.add(`${c.catalog}:${c.name}`); // non-control deferral sentinel (#423)
  }
  return [...risk];
}

/**
 * Build + validate a {@link ParsimonyReceipt}. A floor with any `deferred` check
 * forces a `deferred` block whose `controlRisk` is {@link deferredRisk} (always
 * non-empty here, satisfying the receipt's deferred invariant); otherwise
 * `deferred` is null. Verification starts `pending`/`checkedFloor:false` (the blind
 * verifier #7 flips it). Throws if the assembled receipt is invalid (never a
 * partial receipt).
 */
export function buildParsimonyReceipt(decision: ParsimonyDecision): ParsimonyReceipt {
  const risk = deferredRisk(decision.floorChecks);
  const deferred =
    risk.length === 0
      ? null
      : {
          debtId: decision.receiptId,
          reason: `parsimony floor deferred on ${decision.subject}`,
          controlRisk: risk,
          owner: decision.owner,
        };
  const verification: Verification = {
    method: 'blind_independent',
    verifier: decision.verifier,
    checkedFloor: false,
    status: 'pending',
  };
  return ParsimonyReceiptSchema.parse({
    receiptId: decision.receiptId,
    ts: decision.ts,
    loopIter: decision.loopIter,
    overlay: decision.overlay,
    decisionType: 'parsimony',
    subject: decision.subject,
    rung: decision.ladder.rung,
    outcome: decision.ladder.outcome,
    rationaleDigest: decision.rationaleDigest,
    floorChecks: [...decision.floorChecks],
    deferred,
    verification,
  });
}
