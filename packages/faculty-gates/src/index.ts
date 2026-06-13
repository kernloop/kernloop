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
 * This faculty imports only @kernloop/contracts, zod, node builtins, the
 * `typescript` compiler API (the in-process TS/JS doc-comment scanner, #65), and
 * `web-tree-sitter` (the in-process Python/Go/Rust/Java/C/PHP/Ruby doc-comment
 * scanner, #108, with grammars vendored under `grammars/`) — never another
 * plugin (constitutional rule 5); both parsers are external libraries, not
 * faculties.
 */
export {
  DEFAULT_TIMEOUT_MS,
  defaultQualityChecks,
  docCommentCheck,
  isInProcessCheck,
  type InProcessCheck,
  type QualityCheck,
  type SubprocessCheck,
} from './checks.js';
export {
  listExportedSymbols,
  mineExportedSymbols,
  type ExportedSymbol,
  type MinedFile,
} from './doc-scan.js';
export { runQualityGate, type RunQualityGateOptions } from './run.js';
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
