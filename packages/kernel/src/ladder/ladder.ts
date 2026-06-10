/**
 * Kernel Ladder (spec §3.1, §3.2): enforce authority tiers on every routed
 * action and record tier transitions. The Ladder enforces — humans and
 * gates DECIDE promotions; the Ladder never does (spec §3.1 "Explicitly
 * NOT: deciding promotions").
 *
 * Tier order: `observe < suggest < advisory < enforce` (spec §3.2).
 *
 * Semantics:
 *  - `checkAction` denies when the action's required tier exceeds the
 *    actor's tier OR the task's authorityCeiling; every allow AND deny is
 *    audited [CLM-0016] (constitutional rule 7 — no silent decisions).
 *  - `setTier` records a transition decided elsewhere. Promotion to
 *    `enforce` REQUIRES a non-empty `ratifiedBy` (constitutional rule 6:
 *    promotion needs evidence + ratification, never a default). Every
 *    transition is audited [CLM-0017].
 *  - `recordEvidence` checks a metric's sliding window against the
 *    manifest's EvidenceThreshold: once the window is full (≥ windowN
 *    observations), mean of the last windowN observations < threshold is a
 *    breach, and demotion one tier down is AUTOMATIC and audited
 *    [CLM-0017] (spec §3.2: "demotion is automatic on threshold breach").
 *    `observe` is the floor — a breach there is still audited but cannot
 *    demote further. The Ladder learns each manifest's current tier from
 *    `setTier`; recording evidence for a manifest it has never seen is a
 *    typed error.
 *
 * Audit events carry tier names and the breach arithmetic — small
 * governance facts, no payloads. No intelligence: pure comparisons and a
 * mean (constitutional rule 4).
 *
 * @module kernel/ladder
 */

import type { EvidenceThreshold, Tier } from '@kernloop/contracts';
import { appendEvent, type AuditStore } from '../audit/index.js';

/** Tier order (spec §3.2): observe < suggest < advisory < enforce. */
export const TIER_ORDER: Readonly<Record<Tier, number>> = {
  observe: 0,
  suggest: 1,
  advisory: 2,
  enforce: 3,
};

/** Tiers by ascending rank — index = TIER_ORDER value. */
const TIERS_ASCENDING: readonly Tier[] = ['observe', 'suggest', 'advisory', 'enforce'];

/** Numeric rank of a tier for comparisons. */
export function tierRank(tier: Tier): number {
  return TIER_ORDER[tier];
}

/** Why the ladder rejected an operation. */
export type LadderErrorCode = 'ratification_required' | 'unknown_manifest';

/** Typed rejection at the ladder boundary. */
export class LadderError extends Error {
  readonly code: LadderErrorCode;
  constructor(code: LadderErrorCode, message: string) {
    super(message);
    this.name = 'LadderError';
    this.code = code;
  }
}

/** One routed action to authorize (spec §3.1: "every routed action"). */
export interface ActionCheck {
  /** Manifest name of the acting component. */
  actor: string;
  /** The actor's current authority tier. */
  actorTier: Tier;
  /** Tier the action requires (e.g. `enforce` to mutate). */
  requiredTier: Tier;
  /** The task's authorityCeiling — max tier any action may use (spec §4). */
  authorityCeiling: Tier;
}

/** Outcome of {@link Ladder.checkAction}; denials carry the reason. */
export type ActionDecision =
  | { allowed: true }
  | { allowed: false; reason: 'exceeds_actor_tier' | 'exceeds_authority_ceiling' };

/** Outcome of {@link Ladder.recordEvidence}. */
export type EvidenceResult =
  | { breached: false }
  | { breached: true; mean: number; from: Tier; demotedTo: Tier };

/** Pure decision: deny when requiredTier exceeds actor tier or ceiling. */
function decide(check: ActionCheck): ActionDecision {
  if (tierRank(check.requiredTier) > tierRank(check.actorTier)) {
    return { allowed: false, reason: 'exceeds_actor_tier' };
  }
  if (tierRank(check.requiredTier) > tierRank(check.authorityCeiling)) {
    return { allowed: false, reason: 'exceeds_authority_ceiling' };
  }
  return { allowed: true };
}

/** Authority-tier enforcement. See module docs for full semantics. */
export class Ladder {
  private readonly store: AuditStore;
  /** Current tier per manifest, as last recorded via setTier/demotion. */
  private readonly tiers = new Map<string, Tier>();

  /** @param store - audit store every decision and transition is appended to */
  constructor(store: AuditStore) {
    this.store = store;
  }

  /**
   * Authorize one routed action [CLM-0016]: denied when `requiredTier`
   * exceeds `actorTier` or `authorityCeiling`. Both outcomes append a
   * `kernel.ladder.check` audit event.
   */
  checkAction(check: ActionCheck): ActionDecision {
    const decision = decide(check);
    appendEvent(this.store, {
      type: 'kernel.ladder.check',
      payload: {
        actor: check.actor,
        actorTier: check.actorTier,
        requiredTier: check.requiredTier,
        authorityCeiling: check.authorityCeiling,
        allowed: decision.allowed,
        reason: decision.allowed ? null : decision.reason,
      },
    });
    return decision;
  }

  /**
   * Record a tier transition decided by humans/gates [CLM-0017]. Promotion
   * to `enforce` requires a non-empty `ratifiedBy` (constitutional rule 6;
   * spec §3.2: "sustained advisory evidence + human ratification") — typed
   * error otherwise. Appends a `kernel.ladder.tier_change` audit event.
   */
  setTier(manifestName: string, from: Tier, to: Tier, options?: { ratifiedBy?: string }): void {
    const ratifiedBy = options?.ratifiedBy;
    if (to === 'enforce' && (typeof ratifiedBy !== 'string' || ratifiedBy.length === 0)) {
      throw new LadderError(
        'ratification_required',
        `promotion of ${manifestName} to enforce requires human ratification (ratifiedBy)`,
      );
    }
    this.tiers.set(manifestName, to);
    appendEvent(this.store, {
      type: 'kernel.ladder.tier_change',
      payload: {
        manifest: manifestName,
        from,
        to,
        direction: tierRank(to) > tierRank(from) ? 'promotion' : 'demotion',
        automatic: false,
        ratifiedBy: ratifiedBy ?? null,
      },
    });
  }

  /**
   * Evaluate a sliding-window evidence threshold [CLM-0017]. With a full
   * window (≥ windowN observations), mean of the last windowN observations
   * below `threshold.threshold` is a breach: the manifest is automatically
   * demoted one tier (floor: `observe`) and the transition is audited with
   * `automatic: true`. The manifest's tier must be known via prior
   * `setTier` (`unknown_manifest` otherwise).
   */
  recordEvidence(
    manifestName: string,
    threshold: EvidenceThreshold,
    observations: number[],
  ): EvidenceResult {
    const from = this.tiers.get(manifestName);
    if (from === undefined) {
      throw new LadderError(
        'unknown_manifest',
        `no tier recorded for ${manifestName} — call setTier before recordEvidence`,
      );
    }
    if (observations.length < threshold.windowN) return { breached: false };
    const window = observations.slice(-threshold.windowN);
    const mean = window.reduce((sum, x) => sum + x, 0) / window.length;
    if (mean >= threshold.threshold) return { breached: false };
    const demotedTo = TIERS_ASCENDING[Math.max(0, tierRank(from) - 1)] as Tier;
    this.tiers.set(manifestName, demotedTo);
    appendEvent(this.store, {
      type: 'kernel.ladder.tier_change',
      payload: {
        manifest: manifestName,
        from,
        to: demotedTo,
        direction: 'demotion',
        automatic: true,
        metric: threshold.metric,
        mean,
        threshold: threshold.threshold,
        windowN: threshold.windowN,
      },
    });
    return { breached: true, mean, from, demotedTo };
  }
}
