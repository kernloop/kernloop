/**
 * The `kl:parsimony` inline MARKER grammar [#6, EPIC #407] — the stable,
 * GREPPABLE one-line summary of a parsimony Decision Receipt, plus the tolerant
 * back-link parser that recovers a marker's `receipt=<id>` reference.
 *
 * A marker is the human/grep-facing shorthand for a receipt: it names the rung,
 * the outcome, the applicable Control Floor checks and their status, whether a
 * debt was deferred, and — crucially — the `receipt=<receiptId>` back-reference
 * so any marker can be resolved to its full receipt on the hash-chained audit
 * log. The format is single-line with NO spaces inside a field, so a plain
 * `grep 'kl:parsimony'` over a tree finds every marker and `parseMarker` lifts
 * the receipt id back out.
 *
 * HONEST SCOPE: this module is ONLY the grammar (format + back-link parser) and
 * the back-link consumer is `kl debt` (#6). WRITING markers into deliverables as
 * inline CODE COMMENTS is a SEPARATE future concern — it needs coder-node
 * integration to place a comment at the decision's `subject` span in the right
 * comment syntax for the file's language — and is deliberately NOT attempted
 * here. This part is the pure, greppable grammar + the receipt back-link only.
 *
 * @module parsimony/marker
 */
import type { FloorCheck, ParsimonyReceipt } from './receipt.js';

/** The literal token every marker line begins with — the grep anchor. */
export const MARKER_TAG = 'kl:parsimony';

/**
 * The floor token for one check: `<controlIdOrName>:<status>`. A check that maps
 * to a NIST control uses its FIRST control id (the most specific catalog handle);
 * a non-control entry (Section 508 / intent) has no control id, so its `name` is
 * used instead. Either way the token is space-free, keeping the marker greppable.
 */
function floorToken(check: FloorCheck): string {
  const handle = check.controlIds[0] ?? check.name;
  return `${handle}:${check.status}`;
}

/**
 * Format the stable, greppable `kl:parsimony` marker for a receipt, e.g.
 * `kl:parsimony rung=2 outcome=reuse_native floor=SI-10:pass,AU-2:pass defer=none receipt=01J9...`.
 * The `floor` field lists every check that is NOT `na` (the checks that actually
 * applied), comma-joined; `defer` is `none` when the receipt carries no deferred
 * block, else the `debtId`; `receipt` is the receiptId back-link. Single-line, no
 * spaces inside a field.
 */
export function parsimonyMarker(receipt: ParsimonyReceipt): string {
  const applied = receipt.floorChecks.filter((c) => c.status !== 'na').map(floorToken);
  const floor = applied.length === 0 ? 'none' : applied.join(',');
  const defer = receipt.deferred === null ? 'none' : receipt.deferred.debtId;
  return [
    MARKER_TAG,
    `rung=${receipt.rung}`,
    `outcome=${receipt.outcome}`,
    `floor=${floor}`,
    `defer=${defer}`,
    `receipt=${receipt.receiptId}`,
  ].join(' ');
}

/** Matches `receipt=<id>` where the id is any run of non-whitespace chars. */
const RECEIPT_REF = /receipt=(\S+)/;

/**
 * Tolerantly parse a marker line, recovering at LEAST its `receipt=<id>`
 * back-reference — the link from an inline marker to its full receipt on the
 * audit log. Returns `null` when the line is not a `kl:parsimony` marker or
 * carries no resolvable receipt reference, so a caller can scan arbitrary text
 * and pick out only the real markers without crashing.
 */
export function parseMarker(line: string): { receiptId: string } | null {
  if (!line.includes(MARKER_TAG)) return null;
  const match = RECEIPT_REF.exec(line);
  const receiptId = match?.[1];
  if (receiptId === undefined) return null;
  return { receiptId };
}
