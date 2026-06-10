/**
 * Shared vocabulary for the frozen five (spec §4). The contracts name these
 * supporting types but leave their shape open; the schemas here are the
 * minimal zod-validated forms. Widening any of them is a contract change and
 * routes through the human-ratification path (see MIGRATIONS.md).
 */
import { z } from 'zod';

/**
 * Authority ladder tier (spec §3.2, kernel-enforced):
 * - `observe`  — may emit telemetry only (entry tier for Observer probes)
 * - `suggest`  — may file issues / proposals (default entry for anything generative)
 * - `advisory` — may cast non-blocking Verdicts
 * - `enforce`  — may block, act, mutate
 * Promotion requires evidence + ratification; it is never a default.
 */
export const TierSchema = z.enum(['observe', 'suggest', 'advisory', 'enforce']);
export type Tier = z.infer<typeof TierSchema>;

/**
 * Manifest maturity (spec §4): `experimental` until claims back the
 * capability, `stable` once they do. Incomplete capability lives behind an
 * explicit `experimental` tier that the router reports honestly (spec §1).
 */
export const MaturitySchema = z.enum(['experimental', 'stable']);
export type Maturity = z.infer<typeof MaturitySchema>;

/**
 * The names of the frozen five (spec §4). Doubles as the value space for
 * {@link ContractRefSchema}.
 */
export const CONTRACT_NAMES = ['TaskContract', 'Brief', 'Verdict', 'Outcome', 'Manifest'] as const;

/**
 * Reference to one of the frozen five contracts, used by Manifest
 * `contracts.consumes` / `contracts.emits` (spec §4). Only the five names
 * are valid — plugins communicate exclusively through these contracts over
 * the event bus (spec §1, rule 5).
 */
export const ContractRefSchema = z.enum(CONTRACT_NAMES);
export type ContractRef = z.infer<typeof ContractRefSchema>;

/**
 * Claim-registry reference (spec §1, rule 2: claims-first development).
 * A stable claim id of the form `CLM-0001`. A Manifest with zero claims is
 * experimental by definition (spec §4: "backing evidence — empty =
 * experimental").
 */
export const ClaimRefSchema = z.string().regex(/^CLM-\d{4}$/, 'claim id must match CLM-NNNN');
export type ClaimRef = z.infer<typeof ClaimRefSchema>;

/**
 * Evidence requirement on a TaskContract — "what proves done" (spec §4).
 * Minimal form: a typed reference mirroring the claims-registry evidence
 * kinds (`test` / `ci` / `doc` / `eval`) plus the reference itself.
 */
export const EvidenceRequirementSchema = z.strictObject({
  /** Evidence kind, aligned with claims-registry typed refs. */
  kind: z.enum(['test', 'ci', 'doc', 'eval']),
  /** The reference that must resolve, e.g. `test:<path>::<name>`. */
  ref: z.string().min(1),
});
export type EvidenceRequirement = z.infer<typeof EvidenceRequirementSchema>;

/**
 * Machine-checkable definition-of-done entry on a TaskContract (spec §4).
 * Minimal form: a human-readable name and the command whose exit status
 * decides pass/fail.
 */
export const CheckSchema = z.strictObject({
  /** Short identifier for the check, e.g. `typecheck`. */
  name: z.string().min(1),
  /** Command to run; exit 0 means the check passes. */
  command: z.string().min(1),
});
export type Check = z.infer<typeof CheckSchema>;

/**
 * Provenance tag on a Brief section (spec §4, §5.2: memory reads are
 * provenance-tagged; provenance is mandatory on memory writes). Minimal
 * form: a single resolvable reference to where the content came from.
 */
export const SourceSchema = z.strictObject({
  /** Where the content came from, e.g. a file path, trace id, or memory key. */
  ref: z.string().min(1),
});
export type Source = z.infer<typeof SourceSchema>;

/**
 * One compiled section of a Brief (spec §4): `{ name, content, tokens,
 * priority, provenance: Source[] }`. Briefs are reproducible artifacts.
 */
export const BriefSectionSchema = z.strictObject({
  /** Section name, e.g. `goal`, `constraints`, `memory`. */
  name: z.string().min(1),
  /** The compiled section text. */
  content: z.string(),
  /** Token count of `content`, charged against the brief budget. */
  tokens: z.number().int().nonnegative(),
  /** Relative priority used when the compiler must trim to budget. */
  priority: z.number(),
  /** Provenance of the content — every section says where it came from. */
  provenance: z.array(SourceSchema),
});
export type BriefSection = z.infer<typeof BriefSectionSchema>;

/**
 * Structured, severity-tagged finding inside a Verdict (spec §4). Severity
 * runs `info` < `warn` < `error` < `blocker`.
 */
export const FindingSchema = z.strictObject({
  /** How serious the finding is. */
  severity: z.enum(['info', 'warn', 'error', 'blocker']),
  /** Human-readable description of the finding. */
  message: z.string().min(1),
  /** Optional file path or locator the finding refers to. */
  path: z.string().min(1).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

/**
 * Realized cost of an action (spec §4: Verdict and Outcome both carry one;
 * Outcome cost is "per-adapter, per-phase"). Adapters meter token/cost per
 * call (spec §3.1); the optional `byAdapter` map carries that breakdown.
 */
export const CostSchema = z.strictObject({
  /** Total tokens consumed. */
  tokens: z.number().int().nonnegative(),
  /** Total dollars spent. */
  usd: z.number().nonnegative(),
  /** Wall-clock duration in milliseconds, when measured. */
  wallClockMs: z.number().nonnegative().optional(),
  /** Per-adapter breakdown keyed by adapter name (claude, codex, …). */
  byAdapter: z
    .record(
      z.string(),
      z.strictObject({
        tokens: z.number().int().nonnegative(),
        usd: z.number().nonnegative(),
      }),
    )
    .optional(),
});
export type Cost = z.infer<typeof CostSchema>;

/**
 * Observed signal on an Outcome (spec §4: "tests passed, gates cleared,
 * regressions"). Minimal form: a named boolean with optional detail.
 */
export const SignalSchema = z.strictObject({
  /** Signal name, e.g. `tests`, `gate:quality`, `regression`. */
  name: z.string().min(1),
  /** Whether the signal is good (tests passed, gate cleared, no regression). */
  passed: z.boolean(),
  /** Optional human-readable detail, e.g. `212/212 tests`. */
  detail: z.string().min(1).optional(),
});
export type Signal = z.infer<typeof SignalSchema>;

/**
 * A capability a Manifest advertises (spec §4). The router matches
 * TaskContracts to manifests by capability (spec §3.1). Minimal form: a
 * stable name plus optional description.
 */
export const CapabilitySchema = z.strictObject({
  /** Stable capability name the router matches on, e.g. `compile-brief`. */
  name: z.string().min(1),
  /** Optional human-readable description. */
  description: z.string().min(1).optional(),
});
export type Capability = z.infer<typeof CapabilitySchema>;

/**
 * Expected cost profile declared by a Manifest (spec §4: "expected
 * tokens/usd/latency"). Used by the router for budget-aware matching.
 */
export const CostProfileSchema = z.strictObject({
  /** Expected tokens per invocation. */
  tokens: z.number().int().nonnegative(),
  /** Expected dollars per invocation. */
  usd: z.number().nonnegative(),
  /** Expected latency per invocation, in milliseconds. */
  latencyMs: z.number().nonnegative(),
});
export type CostProfile = z.infer<typeof CostProfileSchema>;

/**
 * Evidence threshold that earns the next authority tier (spec §3.2, §4):
 * "e.g., precision ≥ X over sliding window n ≥ Y". Demotion is automatic on
 * threshold breach.
 */
export const EvidenceThresholdSchema = z.strictObject({
  /** Metric the threshold applies to, e.g. `precision`. */
  metric: z.string().min(1),
  /** Minimum value of the metric required for promotion. */
  threshold: z.number(),
  /** Minimum sliding-window sample size over which the metric is measured. */
  windowN: z.number().int().positive(),
});
export type EvidenceThreshold = z.infer<typeof EvidenceThresholdSchema>;
