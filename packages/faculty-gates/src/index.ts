/**
 * @kernloop/faculty-gates — Layer 2 gates faculty (spec §5.3).
 *
 * P1 surface: the mechanical quality gate — typecheck/lint/test (coverage
 * rides the test runner's exit code) over a workspace, emitted as one
 * uniform, zod-validated Verdict (CLM-0031). It runs local tooling via
 * child_process and never calls a model.
 *
 * P2 surface: the vote gate — a voter panel (3 default, 7 at plan
 * ratification) over one shared compiled Brief, aggregated under the
 * ported v1 consensus strategies into one Verdict (CLM-0037..0039). Voters
 * call models, but only through the injected `invokeVoter` dependency
 * bound by the composition root — the faculty stays model-free.
 *
 * P3 surface: the review gate — adversarial diff review by a reviewer
 * panel (3 lenses default, 5 in full), findings merged/deduplicated with
 * per-reviewer attribution, per-voter records for the fitness ledger's
 * precision series, plus the ported v1 n=10 labeled eval set and the
 * calibration that measures a reviewer against it (CLM-0047, CLM-0048).
 * Advisory tier until the ported Epic-E promotion criterion is met
 * (spec §5.3); reviewers call models only through the injected
 * `invokeReviewer`.
 *
 * Auditing of emitted Verdicts happens kernel-side at the bus boundary.
 * This faculty imports @kernloop/contracts, the shared @kernloop/kernel
 * least-privilege env primitive (`scopedChildEnv`, #235 — faculty→kernel is
 * allowed; rule 5 only bars faculty→faculty), zod, node builtins, and
 * `@kernloop/docscan` for the in-process doc-comment scan (TS/JS via the
 * `typescript` compiler API + twelve tree-sitter languages; the parsers and
 * vendored grammars live in docscan since #256 — a library, not a faculty).
 */
export {
  DEFAULT_TIMEOUT_MS,
  checksFromDefinitionOfDone,
  defaultQualityChecks,
  docCommentCheck,
  securityCheck,
  isInProcessCheck,
  type InProcessCheck,
  type QualityCheck,
  type SubprocessCheck,
} from './checks.js';
export {
  runQualityGate,
  type RunQualityGateOptions,
  type GateSandboxOptions,
  type SandboxTier,
} from './run.js';
export {
  RATIFIED_GATE_PROFILE,
  RATIFIED_GATE_PROFILE_HASH,
  GATE_IMAGE,
  gateProfileHash,
} from './sandbox/profile.js';
export { parseEslintOutput, parseTscOutput, parseVitestOutput, outputTail } from './parsers.js';
export { qualityGateManifest } from './manifest.js';
export {
  ARCHITECT,
  SECURITY,
  DEVEX,
  AI_ML,
  PM,
  CONTRARIAN,
  SCOPE_STEWARD,
  PANEL_DEFAULT,
  PANEL_RATIFICATION,
  type VoterTemplate,
} from './vote/voters.js';
export {
  aggregateVotes,
  type BallotVote,
  type VoteOutcome,
  type VoteStrategy,
} from './vote/strategies.js';
export {
  FINDING_REASONING_CAP,
  VoterBallotSchema,
  runVoteGate,
  type InvokeVoter,
  type RunVoteGateOptions,
  type VoterBallot,
} from './vote/run.js';
export { voteGateManifest } from './vote/manifest.js';
export {
  REVIEWER_CORRECTNESS,
  REVIEWER_SECURITY,
  REVIEWER_MAINTAINABILITY,
  REVIEWER_CONTRARIAN,
  REVIEWER_SCOPE_STEWARD,
  REVIEW_PANEL_DEFAULT,
  REVIEW_PANEL_FULL,
  type ReviewerTemplate,
} from './review/reviewers.js';
export {
  DEDUP_PREFIX_LENGTH,
  ReviewFindingSchema,
  ReviewerReportSchema,
  mergeFindings,
  runReviewGate,
  type InvokeReviewer,
  type ReviewFinding,
  type ReviewerReport,
  type RunReviewGateOptions,
} from './review/run.js';
export {
  ExpectedFindingSchema,
  REVIEW_EVAL_SET,
  ReviewEvalCaseSchema,
  type ExpectedFinding,
  type ReviewEvalCase,
} from './review/eval-set.js';
export {
  PROMOTION_CRITERION,
  evaluateReviewer,
  findingMatches,
  type EvaluateReviewerOptions,
  type ReviewCaseScore,
  type ReviewerCalibration,
} from './review/calibrate.js';
export { reviewGateManifest } from './review/manifest.js';
