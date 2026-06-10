/**
 * Kernel Ladder (spec §3.1, §3.2) — public surface of the ladder module.
 *
 * @module kernel/ladder
 */

export {
  Ladder,
  LadderError,
  TIER_ORDER,
  tierRank,
  type LadderErrorCode,
  type ActionCheck,
  type ActionDecision,
  type EvidenceResult,
} from './ladder.js';
