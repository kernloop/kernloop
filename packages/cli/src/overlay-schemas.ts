/**
 * Overlay sub-schemas (spec §7), extracted from overlay.ts (#252 prerequisite)
 * so the main overlay module stays under its LOC budget — overlay.ts had hit the
 * ceiling three times as gate/router/adapter knobs accreted. These are the
 * leaf zod schemas the top-level OverlaySchema composes; the loader, paths,
 * superRefine, and node-resolution helpers stay in overlay.ts. Public symbols
 * are re-exported from overlay.ts so existing `from '../overlay.js'` imports are
 * unchanged.
 */
import { z } from 'zod';
import { EffortSchema, ModelTierSchema, type ModelTier } from '@kernloop/contracts';
import { ADAPTER_NAMES } from '@kernloop/kernel';

/** Consensus strategies in use for the P2 vote gate (spec §12.3 proposal). */
export const VOTE_STRATEGIES = ['simple_majority', 'supermajority', 'unanimous'] as const;

/** Legal vote panel sizes: 3 by default, 7 at plan ratification (spec §8.6). */
export const VOTE_PANEL_SIZES = [3, 7] as const;

/** Task budgets — each a positive ceiling; a 0-budget is a lie, not a cap. */
export const BudgetsSchema = z.strictObject({
  tokens: z.number().int().positive().default(100_000),
  usd: z.number().positive().default(1),
  wallClockMin: z.number().positive().default(30),
});

/** Vote-gate thresholds (spec §5.3, §8.6): strategy is data, panel 3 or 7. */
export const VoteGateSchema = z.strictObject({
  strategy: z.enum(VOTE_STRATEGIES).default('simple_majority'),
  panel: z.union([z.literal(3), z.literal(7)]).default(3),
  /**
   * Opt-in PROVIDER-DIVERSE panel-7 voting (#369). Default FALSE (#461): a live
   * experiment found three independent model families (anthropic/openai/google) gave
   * IDENTICAL verdicts to a single strong model on every test proposal — the adversarial
   * ROLES carry the signal, not the model. So a panel-7 ratification vote runs
   * roles-on-the-run-adapter by default (one model, N personas) and no longer requires
   * ≥2 authed adapters. Set true to route voters across the overlay's distinct CLI
   * adapters for genuine model independence (the #405 distinct-class quorum + the
   * single-oracle/skew/dilution findings then engage); off ⇒ a single-model panel has no
   * served identities, so the quorum/findings are inert. Re-enable it for the
   * highest-stakes ratifications, or if a proposal ever surfaces model-driven
   * disagreement — the #461 evidence was all-agree, so diversity's insurance value is
   * untested, not disproven (the trigger to revisit is tracked in #467). The human merge
   * stays the ratifier for protected-path/spec/tier decisions either way (spec §11, #348).
   */
  providerDiverse: z.boolean().default(false),
  /**
   * Opt-in human-decision ASK (#192): when true, a DEADLOCKED panel (neither the
   * approve bar nor the symmetric reject bar clears) emits `escalate` instead of
   * `reject`, so the loop HALTS as escalated for a human to rule on the next
   * interaction rather than auto-blocking. Default false ⇒ a deadlock still
   * resolves to `reject` (byte-identical to prior behavior).
   *
   * LIVENESS TRADEOFF (#364): in a fully UNATTENDED loop (cron / detached
   * `/loop` with no operator returning), `escalate` halts INDEFINITELY — there
   * is no "next interaction" — whereas the default `reject` re-plans within K and
   * continues. Enable this only for runs a human actually watches; keep it off
   * for autonomous runs.
   */
  escalateOnNoConsensus: z.boolean().default(false),
  /**
   * Opt-in precision-WEIGHTED voting (#369 Inc3): when true, each voter's ballot
   * is weighted by its measured calibration — a voter whose votes have matched
   * eventual run outcomes counts for more (see `precisionWeight`). Default false ⇒
   * equal weights (byte-identical). Inert even when ON until a voter accrues enough
   * labeled outcomes; labeling itself happens regardless of this flag.
   */
  precisionWeighted: z.boolean().default(false),
  /**
   * Opt-in correlation-AWARE aggregation (#369 Inc4): when true, voters that share a
   * served model CLASS are downweighted by `correlationDiscount(form, K)` for the
   * class size K (composed multiplicatively with any precision weight), so a
   * provider-correlated bloc on a diverse panel counts toward its effective-
   * independent size, not its head-count. The discount is surfaced as a VISIBLE
   * `info` Verdict finding. Default false ⇒ equal/precision weights (byte-identical);
   * inert on a single-adapter panel (no served identities to group).
   */
  correlationAware: z.boolean().default(false),
  /** The `correlationAware` discount form (#369 Inc4): `sqrt` ⇒ 1/√K (default,
   * softer), `linear` ⇒ 1/K (one effective vote per class). */
  correlationForm: z.enum(['sqrt', 'linear']).default('sqrt'),
  /**
   * Distinct-class INDEPENDENCE quorum (#405/#369 Inc5b): require at least this many
   * distinct served model classes on a diverse panel, else the vote ESCALATES to a
   * human instead of auto-deciding on a correlated panel. Absent ⇒ the human-ratified
   * DEFAULT-ON for a panel-7 ratification vote (≥2 classes; a single-oracle ratification
   * escalates rather than auto-approving), and OFF for a panel-3 loop vote. Set to 1 to
   * disable it on a ratification panel (the opt-out). Inert on a single-adapter /
   * endpoint-only panel (no served identities to count).
   */
  minDistinctClasses: z.number().int().min(0).optional(),
});

/** Quality-gate knobs; the per-check timeout has no honest overlay default — the gate owns it. */
export const QualityGateSchema = z.strictObject({
  timeoutMsPerCheck: z.number().int().positive().optional(),
  /** Non-secret env-var NAMES a check may receive beyond the kernel base allowlist
   * (#235, CLM-0124): check env is `SAFE_ENV_KEYS` ∪ these, never the host env. */
  envAllow: z.array(z.string().min(1)).default([]),
  /** Docker sandbox for gate checks (#236, CLM-0129; default-on #227): `enabled`
   * (DEFAULT TRUE) runs each subprocess check — model-generated code — in the kernel
   * `--network none` sandbox over a workspace COPY; `enforce` (DEFAULT FALSE) falls
   * back to the env-scoped host spawn when Docker is unavailable (recorded, not
   * faked) rather than refusing. So generated code is sandboxed BY DEFAULT WHEN
   * DOCKER IS AVAILABLE, and a Docker-less host still runs (set `enforce: true` to
   * fail closed, or `enabled: false` for the legacy always-host behavior). */
  sandbox: z
    .strictObject({ enabled: z.boolean().default(true), enforce: z.boolean().default(false) })
    .prefault({}),
  /** Diff-coverage anti-rubber-stamp (#226 item 2, CLM-0134): when true, the loop's
   * quality gate flags executable source a child WROTE that the test suite never
   * exercises (untested module = error, uncovered lines = warn). Default OFF — a
   * new gate behavior that changes loop outcomes; promote to default-on on evidence. */
  diffCoverage: z.boolean().default(false),
});

/** The review gate's knobs (#226 item 3). */
export const ReviewGateSchema = z.strictObject({
  /** Convene the advisory GROUNDEDNESS reviewer (#226 item 3, CLM-0135): threads the
   * task goal + acceptance criteria into the review and judges goal-fidelity, surfacing
   * a goal-mismatch as a needs-review signal. Default OFF — an UNPROVEN model-judge (a
   * model call per goal-directed run); promote to default-on on live-eval precision
   * evidence (#287). Off ⇒ byte-identical to before (no goal threaded, defect lenses only). */
  groundedness: z.boolean().default(false),
  /**
   * Promote the review gate to `enforce` IN THIS OVERLAY (#328 Inc2): the value is
   * the ratification ref — a `consensus_vote:<id>` or human sign-off — recorded as
   * `ratifiedBy` on the audited `kernel.ladder.tier_change`. Presence flips the gate
   * to enforce so a rejecting review DRIVES child re-iteration ([CLM-0064] honesty
   * guard); ABSENT ⇒ the gate stays advisory (a fresh clone never promotes — never a
   * default). The ratifier attests the gate met its promotion criterion (precision
   * ≥ 0.8 over n=50, the review manifest's PROMOTION_CRITERION) before setting this;
   * AUTO-verifying that bar from the fitness ledger at assembly is deferred (#350).
   * The ref MUST name its provenance source (`<source>:<detail>`, e.g.
   * `consensus_vote:2026-06-19` or `human:williamz`) so an audit reader can tell
   * an attested promotion from a future #350-verified one — they share the
   * `ratifiedBy` field (#351 review finding).
   */
  ratifiedEnforce: z
    .string()
    .regex(
      /^[a-z][a-z_]*:.+$/,
      'ratifiedEnforce must be a provenance-tagged ref like "consensus_vote:<id>" or "human:<name>"',
    )
    .optional(),
});

/**
 * The parsimony gate's INTENSITY DIAL + enforcement (#9/#415, EPIC #407). The
 * parsimony Check-layer node assesses a child's diff, evaluates the restraint
 * ladder + Control Floor, runs a blind floor verifier, and emits a
 * `parsimony.receipt`. This dial controls how its verdict GATES the loop:
 *
 * - `off`   — the gate does NO work: an immediate abstain, NO assessor/verifier
 *             model calls, NO receipt. Fully disables parsimony; cheapest.
 * - `lite`  — ADVISORY (the pre-#9 behavior): assess + verify + emit receipt;
 *             result `pass`; deferrals + refutes are `warn` findings only,
 *             never reject. Use this for runs that want the receipt but not the
 *             back-pressure.
 * - `full`  — DEFAULT (user-ratified — deliberately NOT byte-identical to the
 *             advisory past): assess + verify + emit receipt. A REFUTED blind
 *             verification → result `reject` (the child RE-ITERATES with the
 *             floor findings folded in, bounded by Kc) — or `escalate` when
 *             `escalateOnRefute`. A confirmed verification → `pass`. A DEFERRED
 *             floor check stays a `warn` finding (debt is ALLOWED at full).
 * - `ultra` — `full` PLUS: any DEFERRED floor check ALSO → reject (no debt
 *             allowed; same escalate-vs-reject rule via `escalateOnRefute`).
 *
 * HONEST SCOPE (#7 consensus conditions, recorded on #415): the blind verifier
 * is answer-key-anchored — it catches pass-OVER-claims (a refuted claimed-pass
 * guard) but NOT applicability-UNDER-claims (an assessor that reports a floor
 * flag false / a guard `na` when the diff really crosses that boundary bypasses
 * both the verifier and the deferral). The gate is NOT evasion-proof; closing
 * that gap (the verifier independently deriving the FloorContext from the diff)
 * is a filed follow-up (#435). See parsimony-executor.ts for the residual.
 */
export const ParsimonyGateSchema = z.strictObject({
  intensity: z.enum(['off', 'lite', 'full', 'ultra']).default('full'),
  /** When true, a REJECTING parsimony outcome (a refute at full/ultra, or a
   * deferral at ultra) emits `escalate` instead of `reject` — the loop HALTS for
   * a human rather than re-iterating. Default false ⇒ reject (the child
   * re-iterates within Kc). Mirrors `gates.vote.escalateOnNoConsensus` (#192). */
  escalateOnRefute: z.boolean().default(false),
});

/** Gate thresholds, keyed by gate. */
export const GatesSchema = z.strictObject({
  vote: VoteGateSchema.prefault({}),
  quality: QualityGateSchema.prefault({}),
  review: ReviewGateSchema.prefault({}),
  parsimony: ParsimonyGateSchema.prefault({}),
});

/**
 * Router priors (spec §7), both opt-in (default false, rule 6): `seedPriors`
 * biases from the reviewed `priors.yaml` (CLM-0126); `liveFitness` feeds the
 * live identity-fitness series with cross-version transfer (CLM-0128, #229
 * item 2) — separate so a self-reinforcing feed is never default-on. */
export const RouterSchema = z.strictObject({
  seedPriors: z.boolean().default(false),
  liveFitness: z.boolean().default(false),
});

/**
 * One node override (spec §6: "Overlays may override nodes (swap a gate,
 * add a specialist) — never duplicate the graph"). P2 scopes this narrowly:
 *
 * - `gate` — swap which registered gate a gate node runs.
 * - `specialists` — workforce template names added to the fan-out node's children.
 * - `tier` / `effort` — override the model REQUIREMENT a model-calling node
 *   derives from its template/manifest (spec §8.4); the loop resolves it through
 *   the kernel translation seam exactly as a declared one.
 * Deliberately absent: `skip` (a node you can turn off is a fail-closed path),
 * edge rewiring, and node duplication — the graph is not overlay data. An empty
 * override is rejected: it hides intent.
 */
export const NodeOverrideSchema = z
  .strictObject({
    gate: z.string().min(1).optional(),
    specialists: z.array(z.string().min(1)).optional(),
    tier: ModelTierSchema.optional(),
    effort: EffortSchema.optional(),
  })
  .refine(
    (o) =>
      o.gate !== undefined ||
      o.specialists !== undefined ||
      o.tier !== undefined ||
      o.effort !== undefined,
    {
      message:
        'a node override must set gate, specialists, tier, and/or effort — an empty override hides intent',
    },
  );
export type NodeOverride = z.infer<typeof NodeOverrideSchema>;

/**
 * One tier's adapter spec (spec §8.4 cost lever [CLM-0078]): a single adapter
 * name (backward-compatible) OR a non-empty array of CANDIDATE adapter names.
 * With >=2 candidates and `adapterFitness.enabled`, the loop picks the
 * higher-fitness candidate per measured ModelIdentity fitness (#252); otherwise
 * the first candidate is bound deterministically (byte-identical to the single
 * string form). Each name is a built-in CLI adapter or a registered endpoint id.
 */
export const AdapterSpecSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

/**
 * Per-tier model adapters: which adapter(s) the loop may bind for each model
 * {@link ModelTierSchema} tier (frontier/large/medium/small). EVERY key is
 * optional — an unset tier falls back to the run's `--adapter`, so an overlay
 * with no `adapters` block is byte-identical to single-adapter behavior.
 * Consumed at the loop composition root (loop/index.ts), never by the Router.
 */
export const AdaptersSchema = z.strictObject({
  frontier: AdapterSpecSchema.optional(),
  large: AdapterSpecSchema.optional(),
  medium: AdapterSpecSchema.optional(),
  small: AdapterSpecSchema.optional(),
});
export type TierAdapters = z.infer<typeof AdaptersSchema>;

/**
 * Live identity-fitness adapter selection (#252, CLM-0130). Opt-in (default
 * off, rule 6 — separate from router priors). `epsilon` is the exploration
 * floor (0 = pure exploit, no live-traffic exploration; default 0.1) keeping a
 * lower-fitness candidate selectable so no adapter is starved.
 */
export const AdapterFitnessSchema = z.strictObject({
  enabled: z.boolean().default(false),
  epsilon: z.number().min(0).max(1).default(0.1),
});

/** Normalize a tier's adapter spec to a candidate list ([] when unset). */
export function tierCandidates(
  adapters: TierAdapters | undefined,
  tier: keyof TierAdapters,
): string[] {
  const spec = adapters?.[tier];
  if (spec === undefined) return [];
  return Array.isArray(spec) ? [...spec] : [spec];
}

/**
 * Per-tier model pins for a harness-routed CLI adapter (#393, CLM-0166). A
 * built-in CLI adapter (e.g. opencode) defaults its `tierBinding` to the harness
 * default (`''`) on every tier, so the CLI's OWN auto-router picks the model. This
 * block lets an overlay PIN a concrete model per tier onto such an adapter — so
 * kernloop runs `opencode -m <model>` for a kernloop-CHOSEN model, the agentic-CLI
 * counterpart to the `endpoints` per-tier `models` (which is the direct-HTTP path).
 * Keyed by built-in CLI adapter NAME (never an endpoint id — an endpoint carries
 * its own per-tier `models`); each value is a partial tier→model map. An unset
 * tier keeps the adapter's own default (auto-router), so an absent block is
 * byte-identical to today. Consumed at the loop composition root via
 * {@link adapterModelOverride}, threaded into `resolveServed` — the SAME path the
 * selector predicts on, so predicted==served stays structurally true (CLM-0130).
 */
export const AdapterModelsSchema = z.partialRecord(
  z.enum(ADAPTER_NAMES),
  z.partialRecord(ModelTierSchema, z.string().min(1)),
);
export type AdapterModels = z.infer<typeof AdapterModelsSchema>;

/**
 * The per-tier model override an overlay pins onto a CLI adapter `name` (#393),
 * or undefined when none is set. CLI-only by construction: an endpoint id (which
 * carries its own `models`) never resolves here, so an `adapterModels` entry keyed
 * by an endpoint id is inert — the lookup is gated on {@link isCliAdapter}.
 */
export function adapterModelOverride(
  adapterModels: AdapterModels | undefined,
  name: string,
): Partial<Record<ModelTier, string>> | undefined {
  return isCliAdapter(name) ? adapterModels?.[name] : undefined;
}

/** True when `name` is one of the five built-in CLI adapters (vs an endpoint id). */
export function isCliAdapter(name: string): name is (typeof ADAPTER_NAMES)[number] {
  return (ADAPTER_NAMES as readonly string[]).includes(name);
}
