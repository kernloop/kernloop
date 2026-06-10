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
 * The review gate (P3) arrives in a later phase; absent here by design,
 * not stubbed (constitutional rule 1). Auditing of emitted Verdicts
 * happens kernel-side at the bus boundary. This faculty imports only
 * @kernloop/contracts, zod, and node builtins (constitutional rule 5).
 */
export { DEFAULT_TIMEOUT_MS, defaultQualityChecks, type QualityCheck } from './checks.js';
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
