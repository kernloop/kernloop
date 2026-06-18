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
import { EffortSchema, ModelTierSchema } from '@kernloop/contracts';
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
});

/** Quality-gate knobs; the per-check timeout has no honest overlay default — the gate owns it. */
export const QualityGateSchema = z.strictObject({
  timeoutMsPerCheck: z.number().int().positive().optional(),
  /** Non-secret env-var NAMES a check may receive beyond the kernel base allowlist
   * (#235, CLM-0124): check env is `SAFE_ENV_KEYS` ∪ these, never the host env. */
  envAllow: z.array(z.string().min(1)).default([]),
  /** Docker sandbox for gate checks (#236, CLM-0129): `enabled` runs each subprocess
   * check in the kernel `--network none` sandbox over a workspace COPY (default OFF
   * = legacy env-scoped spawn); `enforce` (default true) fails closed without Docker. */
  sandbox: z
    .strictObject({ enabled: z.boolean().default(false), enforce: z.boolean().default(true) })
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
});

/** Gate thresholds, keyed by gate. */
export const GatesSchema = z.strictObject({
  vote: VoteGateSchema.prefault({}),
  quality: QualityGateSchema.prefault({}),
  review: ReviewGateSchema.prefault({}),
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

/** True when `name` is one of the five built-in CLI adapters (vs an endpoint id). */
export function isCliAdapter(name: string): name is (typeof ADAPTER_NAMES)[number] {
  return (ADAPTER_NAMES as readonly string[]).includes(name);
}
