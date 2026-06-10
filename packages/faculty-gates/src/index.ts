/**
 * @kernloop/faculty-gates — Layer 2 gates faculty (spec §5.3).
 *
 * P1 surface: the mechanical quality gate — typecheck/lint/test (coverage
 * rides the test runner's exit code) over a workspace, emitted as one
 * uniform, zod-validated Verdict (CLM-0031). The vote gate (P2) and review
 * gate (P3) arrive in later phases; absent here by design, not stubbed
 * (constitutional rule 1). The gate runs local tooling via child_process
 * and never calls a model; auditing of emitted Verdicts happens kernel-side
 * at the bus boundary. This faculty imports only @kernloop/contracts and
 * node builtins (constitutional rule 5).
 */
export { DEFAULT_TIMEOUT_MS, defaultQualityChecks, type QualityCheck } from './checks.js';
export { runQualityGate, type RunQualityGateOptions } from './run.js';
export { parseEslintOutput, parseTscOutput, parseVitestOutput, outputTail } from './parsers.js';
export { qualityGateManifest } from './manifest.js';
