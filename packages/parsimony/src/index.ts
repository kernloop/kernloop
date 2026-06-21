/**
 * @kernloop/parsimony — the parsimony subsystem (ponytail-derived, EPIC #407): a
 * restraint ladder, a multi-catalog Control Floor, and the parsimony Decision
 * Receipt that records both as auditable, NIST-800-53r5/OSCAL-mappable evidence on
 * kernloop's existing hash-chained audit log. A pure policy + evaluator LIBRARY
 * consumed by the canonical loop — not a faculty, not a sixth contract.
 *
 * @module parsimony
 */
export {
  FloorCatalogSchema,
  FloorCheckSchema,
  FloorStatusSchema,
  DeferredSchema,
  VerificationSchema,
  ParsimonyOutcomeSchema,
  ParsimonyReceiptSchema,
  PARSIMONY_RECEIPT_EVENT,
  parseParsimonyReceipt,
  hasDeferredFloor,
  type FloorCatalog,
  type FloorCheck,
  type FloorStatus,
  type Deferred,
  type Verification,
  type ParsimonyOutcome,
  type ParsimonyReceipt,
} from './receipt.js';
export {
  PARSIMONY_LADDER,
  evaluateLadder,
  type LadderSignals,
  type LadderRung,
  type LadderResult,
} from './ladder.js';
export {
  CONTROL_FLOOR,
  evaluateFloor,
  floorControlRisk,
  floorHasDeferral,
  type FloorContext,
  type FloorEntry,
} from './floor.js';
export { buildParsimonyReceipt, deferredRisk, type ParsimonyDecision } from './build.js';
export { parsimonyMarker, parseMarker, MARKER_TAG } from './marker.js';
