/**
 * Engine configuration schema (spec §6, §8). EngineConfig is the loop-relevant
 * subset of the cli's `OverlaySchema` (`packages/cli/src/overlay.ts`): `K`,
 * `Kc`, `reviewDrivesIteration`, `gates.vote.{strategy,panel}`, and
 * `nodeOverrides` share its field names and value spaces, so the composition
 * root maps `Overlay` → `EngineConfig` field-for-field [CLM-0045]. Kept apart
 * from the engine so neither file outgrows the 400-line budget.
 */
import { z } from 'zod';

/** Vote strategies in use (mirrors the cli overlay's VOTE_STRATEGIES). */
const VoteConfigSchema = z.strictObject({
  strategy: z.enum(['simple_majority', 'supermajority', 'unanimous']).default('simple_majority'),
  panel: z.union([z.literal(3), z.literal(7)]).default(3),
  /** Opt-in ASK (#192): a deadlocked panel emits `escalate` → the loop halts as
   * escalated for a human, instead of auto-rejecting. Default off (byte-identical).
   * Liveness tradeoff (#364): in an UNATTENDED loop there is no "next interaction",
   * so `escalate` halts indefinitely — keep off for autonomous runs. */
  escalateOnNoConsensus: z.boolean().default(false),
  /** Opt-in precision-weighted voting (#369 Inc3): weight each ballot by the
   * voter's measured calibration. Default off (byte-identical). */
  precisionWeighted: z.boolean().default(false),
  /** Opt-in correlation-aware aggregation (#369 Inc4): downweight voters that share
   * a served model class by `correlationDiscount(form, K)`. Default off (byte-identical);
   * inert on a single-adapter panel. Mirrors the cli overlay's VoteGateSchema. */
  correlationAware: z.boolean().default(false),
  /** The `correlationAware` discount form (#369 Inc4): `sqrt` ⇒ 1/√K, `linear` ⇒ 1/K. */
  correlationForm: z.enum(['sqrt', 'linear']).default('sqrt'),
  /** Distinct-class independence quorum (#405/#369 Inc5b): require ≥ this many distinct
   * served model classes on a diverse panel else the vote ESCALATES to a human instead
   * of ruling. Absent ⇒ defaults to 2 for a panel-7 RATIFICATION vote (the human-ratified
   * default-on), off for a panel-3 loop vote; set to 1 to disable it on a ratification
   * panel. Inert on a single-adapter / endpoint-only panel (no served identities). */
  minDistinctClasses: z.number().int().min(0).optional(),
});

/** One node override (mirrors the cli overlay's NodeOverrideSchema). */
const NodeOverrideSchema = z.strictObject({
  gate: z.string().min(1).optional(),
  specialists: z.array(z.string().min(1)).optional(),
});

/** Engine configuration — see the module docs for the overlay mapping. */
export const EngineConfigSchema = z
  .strictObject({
    /** Vote-iterate bound: at most K rejected re-entries into plan (spec §6). */
    K: z.number().int().min(1).default(3),
    /**
     * Child-iterate bound [CLM-0043]: at most Kc re-runs of a child's
     * implement on a quality reject before the child escalates (spec §6, §8).
     * Bounds child iteration in BOTH budget modes — unlimited budget is not
     * unlimited iterations; raising Kc is how an overlay allows more.
     */
    Kc: z.number().int().min(1).default(3),
    /**
     * Honesty guard (CLM-0064): the review gate is advisory and does NOT drive
     * child iteration. Default off; an overlay flips it on only when the review
     * gate is promoted to enforce. We never claim review enforces iteration.
     */
    reviewDrivesIteration: z.boolean().default(false),
    /**
     * Does the parsimony gate drive child re-iteration this run (#9/#415)? The
     * CLI computes this from the overlay's `gates.parsimony.intensity`: true at
     * `full`/`ultra` (a rejecting parsimony verdict re-runs implement within Kc),
     * false at `lite`/`off` (advisory or disabled). Default false ⇒ a fresh
     * EngineConfig is byte-identical (the engine never drives parsimony unless the
     * mapping flips it). The INTENSITY itself lives in the cli Overlay
     * (`gates.parsimony`) and reaches the executor via `kern.config`; only this
     * derived drive-flag the engine needs is mirrored here [CLM-0045].
     */
    parsimonyDrivesIteration: z.boolean().default(false),
    /**
     * Pre-node budget reserve floor as a FRACTION of the limit (#342): the
     * pre-node guard halts before a node when remaining < max(this × limit,
     * largest-node-seen). The floor covers COLD START (the first node, before any
     * spend is observed). Default 0 — observed-max still caps steady-state
     * overshoot; an overlay raises this to also bound the first node.
     */
    budgetHeadroomFraction: z.number().min(0).max(1).default(0),
    gates: z.strictObject({ vote: VoteConfigSchema.prefault({}) }).prefault({}),
    nodeOverrides: z.record(z.string().min(1), NodeOverrideSchema).default({}),
  })
  .prefault({});
export type EngineConfig = z.infer<typeof EngineConfigSchema>;
export type EngineConfigInput = z.input<typeof EngineConfigSchema>;
