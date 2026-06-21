/**
 * The parsimony Decision Receipt [#408, EPIC #407] — the typed evidence a restraint
 * decision emits. Per the ratified design it is NOT a sixth Frozen-Five contract: it
 * is the PAYLOAD of a new `parsimony.receipt` event appended to kernloop's existing
 * hash-chained, HMAC-keyed audit log (`appendEvent`/`verifyChain`). The chain
 * envelope supplies `prevHash`/`hash`/`seq`; this schema is only the domain payload,
 * so those chain fields are deliberately absent here.
 *
 * A receipt records: which ladder rung resolved the decision (the restraint), the
 * Control Floor checks that applied and their status (the non-waivable guards), any
 * deferred shortcut as a first-class finding with its control risk, and the blind
 * verification verdict. The agent's prose rationale is NOT stored — only its
 * `rationaleDigest` (a content hash) — so the blind verifier judges the diff against
 * the floor without being biased by the agent's self-justification.
 *
 * @module parsimony/receipt
 */
import { z } from 'zod';

/**
 * The catalog a Control Floor entry is typed by. The floor is deliberately
 * MULTI-CATALOG: not every guard is an 800-53 control (accessibility is 508/WCAG;
 * the intent guard is policy with no catalog), so the schema must not assume NIST.
 */
export const FloorCatalogSchema = z.enum(['nist-800-53r5', 'section-508', 'wcag', 'intent']);
export type FloorCatalog = z.infer<typeof FloorCatalogSchema>;

/** A floor check's status: it held (`pass`), did not apply to this diff (`na`), or
 * applied and was NOT satisfied — which forces a {@link DeferredSchema} block. */
export const FloorStatusSchema = z.enum(['pass', 'na', 'deferred']);
export type FloorStatus = z.infer<typeof FloorStatusSchema>;

/**
 * One Control Floor check result on this decision. `controlIds` is empty for a
 * non-control catalog (e.g. an `intent` guard or a 508 entry that maps to no 800-53
 * control), which the OSCAL projection must tolerate (not every entry is a NIST
 * control). `evidenceRef` points at the proof the check passed (a test/log ref).
 */
export const FloorCheckSchema = z.strictObject({
  name: z.string().min(1),
  catalog: FloorCatalogSchema,
  controlIds: z.array(z.string().min(1)),
  status: FloorStatusSchema,
  evidenceRef: z.string().min(1).optional(),
});
export type FloorCheck = z.infer<typeof FloorCheckSchema>;

/**
 * The six restraint outcomes, one per ladder rung (#409). The ladder stops at the
 * first rung that holds; the resolving rung's outcome is recorded so the receipt
 * names WHY the minimum was chosen — `skip` (rung 0, need failed) through
 * `minimal_impl` (rung 5, nothing cheaper held).
 */
export const ParsimonyOutcomeSchema = z.enum([
  'skip',
  'reuse_stdlib',
  'reuse_native',
  'reuse_dep',
  'one_line',
  'minimal_impl',
]);
export type ParsimonyOutcome = z.infer<typeof ParsimonyOutcomeSchema>;

/**
 * A deferred shortcut — a floor entry that applied and was not satisfied. It is a
 * FIRST-CLASS finding, never a buried comment: it carries the control(s) at risk so
 * `kl debt` (#6) and the OSCAL projection (#8) can surface it. Linked to the inline
 * marker by `debtId`.
 */
export const DeferredSchema = z.strictObject({
  debtId: z.string().min(1),
  reason: z.string().min(1),
  controlRisk: z.array(z.string().min(1)).min(1),
  owner: z.string().min(1),
});
export type Deferred = z.infer<typeof DeferredSchema>;

/** The blind-verification verdict (#7). `pending` until the verifier runs;
 * `refuted` FAILS the loop iteration (the gate ponytail lacks). The verifier sees
 * the diff + floor checklist only, never the rationale — hence the digest above. */
export const VerificationSchema = z.strictObject({
  method: z.literal('blind_independent'),
  verifier: z.string().min(1),
  checkedFloor: z.boolean(),
  status: z.enum(['pending', 'confirmed', 'refuted']),
});
export type Verification = z.infer<typeof VerificationSchema>;

/**
 * The parsimony Decision Receipt PAYLOAD (the `parsimony.receipt` audit-event body).
 * `rationaleDigest` is a content hash (e.g. `sha256:…`), never the prose, so blind
 * verification stays unbiased. Chain fields (prevHash/hash/seq) are added by the
 * audit envelope, not here. `strictObject` so an unknown field is a validation
 * error, not silently dropped (prime directive: the record is exactly what happened).
 */
const ParsimonyReceiptShape = z.strictObject({
  /** ULID identifying this receipt (and linked from the inline `kl:parsimony` marker). */
  receiptId: z.string().min(1),
  /** ISO-8601 timestamp the decision was recorded. */
  ts: z.string().min(1),
  /** The canonical-loop iteration this decision belongs to. */
  loopIter: z.number().int().nonnegative(),
  /** The overlay identity that owns the decision (provenance). */
  overlay: z.string().min(1),
  /** Discriminator: always `parsimony` (distinguishes this event from other receipts). */
  decisionType: z.literal('parsimony'),
  /** What the decision is about — a `path:span` or a symbol. */
  subject: z.string().min(1),
  /** The ladder rung (0–5) that resolved the decision (#409). */
  rung: z.number().int().min(0).max(5),
  /** The resolving rung's {@link ParsimonyOutcomeSchema} outcome. */
  outcome: ParsimonyOutcomeSchema,
  /** Content hash of the agent's rationale — NOT the prose (blind verification). */
  rationaleDigest: z.string().min(1),
  /** The Control Floor checks that were evaluated against this decision. */
  floorChecks: z.array(FloorCheckSchema),
  /** A deferred shortcut, or `null` when every applicable floor entry was satisfied. */
  deferred: DeferredSchema.nullable(),
  /** The blind-verification verdict. */
  verification: VerificationSchema,
});

/**
 * The parsimony Decision Receipt schema. Beyond the field shape it enforces the
 * DEFERRED INVARIANT: a `deferred`-status floor check exists **iff** the receipt
 * carries a `deferred` block. This stops a receipt from claiming a deferred control
 * without recording the debt (an unmitigated shortcut hidden from `kl debt`/OSCAL),
 * or recording a debt block with no floor check that actually deferred — either way
 * the record would lie about what happened. The chain fields stay envelope-owned.
 */
export const ParsimonyReceiptSchema = ParsimonyReceiptShape.superRefine((r, ctx) => {
  const hasDeferredCheck = r.floorChecks.some((c) => c.status === 'deferred');
  if (hasDeferredCheck !== (r.deferred !== null)) {
    ctx.addIssue({
      code: 'custom',
      message:
        'deferred invariant: a `deferred`-status floor check requires a `deferred` block, and a `deferred` block requires a deferred-status floor check',
    });
  }
});
export type ParsimonyReceipt = z.infer<typeof ParsimonyReceiptSchema>;

/** The audit-event `type` a parsimony receipt rides on the hash-chained log. */
export const PARSIMONY_RECEIPT_EVENT = 'parsimony.receipt';

/**
 * Parse + validate an unknown value as a {@link ParsimonyReceipt}, THROWING on a
 * malformed receipt (never coercing a partial one through). Use at the boundary
 * where a receipt is read back from the audit log before it is trusted.
 */
export function parseParsimonyReceipt(value: unknown): ParsimonyReceipt {
  return ParsimonyReceiptSchema.parse(value);
}

/**
 * True when an applicable floor check was not satisfied — i.e. the receipt MUST
 * carry a {@link Deferred} block. A `deferred`-status check with no `deferred` body
 * (or vice versa) is an inconsistent receipt the caller should reject.
 */
export function hasDeferredFloor(receipt: ParsimonyReceipt): boolean {
  return receipt.floorChecks.some((c) => c.status === 'deferred');
}
