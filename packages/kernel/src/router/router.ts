/**
 * Kernel Router (spec §3.1): match a TaskContract to manifest(s) by
 * capability, budget, authority tier, and fitness prior. Explicitly NOT
 * strategy logic, retries-with-cleverness, or model calls (constitutional
 * rule 4) — the router decides and records; it never executes.
 *
 * Eligibility of a capability-matching manifest [CLM-0026, CLM-0027]:
 *  - BUDGET — the manifest's declared expected cost per invocation must fit
 *    inside the task's hard budget: `manifest.cost.tokens ≤
 *    task.budget.tokens` AND `manifest.cost.usd ≤ task.budget.usd`. This is
 *    the conservative whole-budget reading: the router compares the
 *    manifest's expected single-invocation cost against the task's total
 *    declared ceiling; it does not model remaining budget (the run tool
 *    meters actuals at execution time). `cost.latencyMs` is not compared to
 *    `budget.wallClockMin` — one is per-invocation latency, the other is a
 *    whole-task wall-clock ceiling; conflating them would be false
 *    precision.
 *  - CEILING — the manifest's own tier must not exceed the task's
 *    authorityCeiling [CLM-0027]. This is a router-level rule on WHO may be
 *    routed to, distinct from the ladder's check on WHAT the action does.
 *  - LADDER — `ladder.checkAction({ actor: manifest.name, actorTier:
 *    manifest.tier, requiredTier, authorityCeiling })` must allow. Every
 *    candidate check is itself an audited ladder decision (rule 7).
 *
 * Selection among eligible candidates: highest fitness prior wins (unknown
 * manifests get the neutral 0.5 prior — no history is neither promotion nor
 * punishment); ties break deterministically by `name@version` ascending.
 *
 * EXPLORATION FLOOR (spec §3.2) [CLM-0028]: with probability
 * EXPLORATION_EPSILON the router instead selects uniformly among ALL
 * capability-matching, ceiling-allowed candidates — including low-fitness
 * and demoted ones — so the demote→starve→prune death spiral cannot occur.
 * Exploration deliberately ignores the fitness ranking and the budget and
 * actor-tier filters, but NEVER the authorityCeiling: safety beats
 * exploration; a manifest above the task's ceiling is unreachable under any
 * roll of the rng. The decision records `explored: true`.
 *
 * The router NEVER executes anything in P1. Routing is side-effect-free
 * except for audit appends; `execute` stays in the signature for the `run`
 * tool's `execute:false` plan-only contract (spec §3.4) and is recorded but
 * acted on by the caller, never here.
 *
 * Error semantics: an UNKNOWN capability (no registered manifest declares
 * it at all) is a typed RouterError — the caller asked for something the
 * system does not have. NO ELIGIBLE candidate (manifests exist but every
 * one fails a filter) is NOT an error: the decision returns
 * `selected: null` with per-candidate reasons so the caller can see exactly
 * why nothing fit.
 *
 * @module kernel/router
 */

import type { Manifest, TaskContract, Tier } from '@kernloop/contracts';
import { appendEvent, type AuditStore } from '../audit/index.js';
import { tierRank, type Ladder } from '../ladder/index.js';
import { type ManifestRegistry } from '../registry/index.js';

/** Probability of an exploration pick per route() call (spec §3.2). */
export const EXPLORATION_EPSILON = 0.1;

/** Neutral fitness prior for manifests with no recorded history. */
export const NEUTRAL_FITNESS_PRIOR = 0.5;

/** Why the router rejected a route() call outright. */
export type RouterErrorCode = 'unknown_capability';

/** Typed rejection at the router boundary (see module docs). */
export class RouterError extends Error {
  readonly code: RouterErrorCode;
  constructor(code: RouterErrorCode, message: string) {
    super(message);
    this.name = 'RouterError';
    this.code = code;
  }
}

/** Why one capability-matching candidate was ineligible. */
export type IneligibilityReason =
  | 'over_token_budget'
  | 'over_usd_budget'
  | 'tier_exceeds_authority_ceiling'
  | 'ladder_exceeds_actor_tier'
  | 'ladder_exceeds_authority_ceiling';

/** One evaluated candidate; `reasons` is empty exactly when eligible. */
export interface CandidateEvaluation {
  manifest: Manifest;
  eligible: boolean;
  reasons: IneligibilityReason[];
}

/** The routing decision — data, not action (the run tool executes later). */
export interface RoutingDecision {
  /** Winning manifest, or null when nothing was eligible (not an error). */
  selected: Manifest | null;
  /** Every capability-matching manifest with its eligibility verdict. */
  candidates: CandidateEvaluation[];
  /** True when the exploration floor (not fitness) made the pick. */
  explored: boolean;
}

/** Input to {@link Router.route}. */
export interface RouteRequest {
  /** The task being routed; budget and authorityCeiling come from here. */
  task: TaskContract;
  /** Capability name the task needs (Manifest.capabilities match key). */
  capability: string;
  /** Tier the routed action requires (ladder-checked per candidate). */
  requiredTier: Tier;
  /**
   * Plan-only flag from the run tool (spec §3.4). The router itself never
   * executes regardless of this value — routing is always side-effect-free
   * except audit; the caller acts on the decision.
   */
  execute?: boolean;
  /**
   * Fitness priors keyed by `name@version` (exact) or `name` (any
   * version); missing entries get {@link NEUTRAL_FITNESS_PRIOR}.
   */
  fitnessPriors?: Map<string, number>;
}

/** Dependencies injected into the router — no globals, no model calls. */
export interface RouterDeps {
  registry: ManifestRegistry;
  ladder: Ladder;
  store: AuditStore;
  /** Uniform [0,1) source for the exploration floor; default Math.random. */
  rng?: () => number;
}

/** Deterministic candidate order: name ascending, then version ascending. */
function compareManifests(a: Manifest, b: Manifest): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.version !== b.version) return a.version < b.version ? -1 : 1;
  return 0;
}

/** Router-level ceiling rule [CLM-0027]: manifest tier ≤ authorityCeiling. */
function withinCeiling(manifest: Manifest, ceiling: Tier): boolean {
  return tierRank(manifest.tier) <= tierRank(ceiling);
}

/** Fitness prior for a manifest: `name@version`, then `name`, then 0.5. */
function priorFor(manifest: Manifest, priors?: Map<string, number>): number {
  return (
    priors?.get(`${manifest.name}@${manifest.version}`) ??
    priors?.get(manifest.name) ??
    NEUTRAL_FITNESS_PRIOR
  );
}

/** Capability router. See module docs for the full decision semantics. */
export class Router {
  private readonly registry: ManifestRegistry;
  private readonly ladder: Ladder;
  private readonly store: AuditStore;
  private readonly rng: () => number;

  constructor(deps: RouterDeps) {
    this.registry = deps.registry;
    this.ladder = deps.ladder;
    this.store = deps.store;
    this.rng = deps.rng ?? Math.random;
  }

  /**
   * Match one TaskContract to a manifest [CLM-0026]. Throws RouterError
   * (`unknown_capability`) when no registered manifest declares the
   * capability; returns `selected: null` (NOT an error) when candidates
   * exist but none is eligible. Appends exactly one `kernel.router.route`
   * audit event per call — identity facts only, never payloads.
   */
  route(request: RouteRequest): RoutingDecision {
    const { task, capability, requiredTier } = request;
    const matches = this.registry.findByCapability(capability).sort(compareManifests);
    if (matches.length === 0) {
      this.audit(request, null, false, [], 'unknown_capability');
      throw new RouterError(
        'unknown_capability',
        `no registered manifest declares capability "${capability}"`,
      );
    }
    const candidates = matches.map((m) => this.evaluate(m, task, requiredTier));
    const decision = this.select(request, candidates);
    this.audit(
      request,
      decision.selected,
      decision.explored,
      candidates,
      decision.selected === null ? 'no_eligible_candidate' : 'routed',
    );
    return decision;
  }

  /** Evaluate one capability match against budget, ceiling, and ladder. */
  private evaluate(
    manifest: Manifest,
    task: TaskContract,
    requiredTier: Tier,
  ): CandidateEvaluation {
    const reasons: IneligibilityReason[] = [];
    if (manifest.cost.tokens > task.budget.tokens) reasons.push('over_token_budget');
    if (manifest.cost.usd > task.budget.usd) reasons.push('over_usd_budget');
    if (!withinCeiling(manifest, task.authorityCeiling)) {
      reasons.push('tier_exceeds_authority_ceiling');
    }
    const ladderDecision = this.ladder.checkAction({
      actor: manifest.name,
      actorTier: manifest.tier,
      requiredTier,
      authorityCeiling: task.authorityCeiling,
    });
    if (!ladderDecision.allowed) reasons.push(`ladder_${ladderDecision.reason}`);
    return { manifest, eligible: reasons.length === 0, reasons };
  }

  /**
   * Pick a winner: exploration floor first (uniform over ceiling-allowed
   * candidates [CLM-0028]; never above the ceiling), else highest fitness
   * prior among eligible candidates with the deterministic name tiebreak.
   * The rng is drawn once for the explore/exploit roll and (only when
   * exploring) once more for the uniform index.
   */
  private select(request: RouteRequest, candidates: CandidateEvaluation[]): RoutingDecision {
    const pool = candidates.filter((c) => withinCeiling(c.manifest, request.task.authorityCeiling));
    if (this.rng() < EXPLORATION_EPSILON && pool.length > 0) {
      const index = Math.min(Math.floor(this.rng() * pool.length), pool.length - 1);
      const picked = pool[index] as CandidateEvaluation;
      return { selected: picked.manifest, candidates, explored: true };
    }
    let best: CandidateEvaluation | null = null;
    let bestPrior = -Infinity;
    for (const candidate of candidates) {
      if (!candidate.eligible) continue;
      const prior = priorFor(candidate.manifest, request.fitnessPriors);
      if (prior > bestPrior) {
        best = candidate;
        bestPrior = prior;
      }
    }
    return { selected: best?.manifest ?? null, candidates, explored: false };
  }

  /** Append the route decision to the audit chain — facts, no payloads. */
  private audit(
    request: RouteRequest,
    selected: Manifest | null,
    explored: boolean,
    candidates: CandidateEvaluation[],
    outcome: 'routed' | 'no_eligible_candidate' | 'unknown_capability',
  ): void {
    appendEvent(this.store, {
      type: 'kernel.router.route',
      payload: {
        task: request.task.id,
        capability: request.capability,
        requiredTier: request.requiredTier,
        execute: request.execute ?? false,
        selected: selected === null ? null : `${selected.name}@${selected.version}`,
        explored,
        candidateCount: candidates.length,
        eligibleCount: candidates.filter((c) => c.eligible).length,
        outcome,
      },
    });
  }
}
