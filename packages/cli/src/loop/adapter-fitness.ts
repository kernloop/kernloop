/**
 * Live identity-fitness adapter selection (#252, CLM-0130) — the composition-root
 * choice of WHICH candidate adapter serves a model tier, biased by measured
 * ModelIdentity fitness. Unlike the kernel Router's priors (selection-inert under
 * one-manifest-per-capability, CLM-0128), node-bind's per-tier adapter binding is
 * a REAL multi-candidate production decision: when a tier lists >=2 candidates and
 * `adapterFitness.enabled`, the higher-fitness candidate is picked here.
 *
 * Reuses the CLM-0128 `liveFitnessPriors` scoring (exact (provider,family,
 * generation,tier) with generation-agnostic recency-decayed bootstrap, bounded
 * clamps, malformed->neutral) over a NEUTRAL (live-only) baseline — the seeded
 * priors.yaml is NOT applied here (that biases the Router, not adapter choice).
 * An EXPLORATION FLOOR (epsilon) keeps a lower-fitness candidate selectable so a
 * better-but-untried one is not starved; epsilon=0 is pure exploit.
 *
 * Each candidate's served identity is predicted by the SAME deterministic
 * resolution the seam uses at call time, so predicted==served for BOTH transports:
 * a CLI candidate via resolveServed, a registered ENDPOINT candidate via the api
 * path (resolveServedApi over its apiDefinitionFor), both normalized through
 * servedIdentity (#260). A name that resolves to neither (unknown adapter) scores
 * NEUTRAL. The selection is made once per node and cached, EXCEPT under a budget
 * `downgrade` (#194), where node-bind re-resolves each call, so the selector (and
 * its rng draw + audit) then fire per model call.
 */
import { appendEvent, NEUTRAL_FITNESS_PRIOR, type AuditStore } from '@kernloop/kernel';
import type { ModelIdentity, ModelRequirement } from '@kernloop/contracts';
import type { DiscoveredCache } from '@kernloop/faculty-models';
import type { IdentityFitnessRecord } from '@kernloop/faculty-observer';
import {
  liveFitnessPriors,
  type CandidateIdentity,
  type LiveFitnessDecision,
} from '../tools/live-fitness.js';
import { servedIdentity } from './node-seam.js';
import { resolveServedFor } from './resolve-served.js';
import type { Endpoints } from '../endpoints.js';
import type { AdapterModels } from '../overlay-schemas.js';

/** One adapter-selection outcome — chosen adapter + reproducible provenance. */
export interface AdapterChoice {
  readonly chosen: string;
  /** True when the exploration floor (not fitness) made the pick. */
  readonly explored: boolean;
  /** The rng value drawn for the explore/exploit roll — recorded so the pick is reproducible. */
  readonly rngDraw: number;
  readonly decisions: LiveFitnessDecision[];
}

/** How much the OUTCOME-level (deliverable-pass) signal weighs against the
 * per-call signal in the blended score (#229/#5). Modest, so a sparse deliverable
 * history NUDGES — never dominates — the call-based selection. A constant offset,
 * so an EMPTY deliverable ledger leaves the call-only ranking unchanged. */
const DELIVERABLE_FITNESS_WEIGHT = 0.3;

/**
 * Pick the highest-fitness candidate (CLM-0130), or — with probability `epsilon`
 * — explore uniformly (anti-starvation). Pure over its inputs (rng + now). Ties
 * and all-neutral candidates resolve to the first candidate (deterministic,
 * backward-compatible). The rng draw is returned for the audit (reproducibility).
 * Blends the OUTCOME-level (deliverable-pass) signal (#229/#5) over the per-call.
 */
export function chooseAdapter(
  candidates: readonly CandidateIdentity[],
  ledger: readonly IdentityFitnessRecord[],
  rng: () => number,
  epsilon: number,
  now: number,
  deliverableLedger: readonly IdentityFitnessRecord[] = [],
): AdapterChoice {
  const { map, decisions } = liveFitnessPriors(candidates, ledger, new Map(), now);
  // Blend the deliverable-PASS signal (#229/#5): prefer a model class that produces
  // deliverables which PASS quality+review over one whose calls merely don't error.
  const { map: dmap } = liveFitnessPriors(candidates, deliverableLedger, new Map(), now);
  const blended = new Map<string, number>();
  for (const candidate of candidates) {
    const call = map.get(candidate.subject) ?? NEUTRAL_FITNESS_PRIOR;
    const deliver = dmap.get(candidate.subject) ?? NEUTRAL_FITNESS_PRIOR;
    blended.set(
      candidate.subject,
      call * (1 - DELIVERABLE_FITNESS_WEIGHT) + deliver * DELIVERABLE_FITNESS_WEIGHT,
    );
  }
  const first = candidates[0]?.subject ?? '';
  const draw = rng();
  if (epsilon > 0 && draw < epsilon && candidates.length > 0) {
    const index = Math.min(Math.floor(rng() * candidates.length), candidates.length - 1);
    return {
      chosen: candidates[index]?.subject ?? first,
      explored: true,
      rngDraw: draw,
      decisions,
    };
  }
  let chosen = first;
  let best = -Infinity;
  for (const candidate of candidates) {
    const score = blended.get(candidate.subject) ?? NEUTRAL_FITNESS_PRIOR;
    if (score > best) {
      best = score;
      chosen = candidate.subject;
    }
  }
  return { chosen, explored: false, rngDraw: draw, decisions };
}

/** Deps the composition root binds into the adapter selector. */
export interface AdapterSelectorDeps {
  readonly enabled: boolean;
  readonly epsilon: number;
  readonly ledger: readonly IdentityFitnessRecord[];
  /** The OUTCOME-level (deliverable-pass) identity series (#229/#5), blended into
   * the score so deliverable quality — not just call-success — biases selection. */
  readonly deliverableLedger: readonly IdentityFitnessRecord[];
  readonly discovered: DiscoveredCache;
  /** The overlay's registered endpoints, so an endpoint candidate is predicted (not neutral, #260). */
  readonly endpoints: Endpoints;
  /** The overlay's per-tier CLI model pins (#393, CLM-0166), so a pinned candidate predicts the pinned model (undefined ⇒ none). */
  readonly adapterModels: AdapterModels | undefined;
  readonly store: AuditStore;
  readonly rng: () => number;
  readonly now: () => number;
}

/**
 * Predict a candidate's served identity via {@link resolveServedFor} — the SAME
 * resolution node-bind uses at call time, so predicted==served (#260, #271). A
 * name that resolves to neither a CLI adapter nor an endpoint → null (neutral).
 * Pure over its inputs.
 */
function predictIdentity(
  req: ModelRequirement,
  name: string,
  endpoints: Endpoints,
  discovered: DiscoveredCache,
  adapterModels: AdapterModels | undefined,
): ModelIdentity | null {
  try {
    return servedIdentity(resolveServedFor(req, name, endpoints, adapterModels), discovered);
  } catch {
    return null; // an unknown adapter / unresolvable endpoint → neutral
  }
}

/**
 * Build the per-tier adapter selector for node-bind, or undefined when the
 * feature is off. The returned function predicts each candidate's identity,
 * scores via {@link chooseAdapter}, appends a `cli.node-bind.adapter-fitness`
 * audit event (candidates, identities, scores, sources, chosen, explored, the
 * rng draw — rule 7, reproducible), and returns the chosen adapter name.
 */
export function buildAdapterSelector(
  deps: AdapterSelectorDeps,
): ((tier: string, req: ModelRequirement, candidates: string[]) => string) | undefined {
  if (!deps.enabled) return undefined;
  return (tier, req, candidateNames) => {
    const candidates: CandidateIdentity[] = candidateNames.map((name) => ({
      subject: name,
      identity: predictIdentity(req, name, deps.endpoints, deps.discovered, deps.adapterModels),
    }));
    const choice = chooseAdapter(
      candidates,
      deps.ledger,
      deps.rng,
      deps.epsilon,
      deps.now(),
      deps.deliverableLedger,
    );
    appendEvent(deps.store, {
      type: 'cli.node-bind.adapter-fitness',
      payload: {
        tier,
        chosen: choice.chosen,
        explored: choice.explored,
        rngDraw: choice.rngDraw,
        decisions: choice.decisions.map((d) => ({
          subject: d.subject,
          source: d.source,
          score: d.score,
          identity:
            d.identity === null
              ? null
              : {
                  provider: d.identity.provider,
                  family: d.identity.family,
                  generation: d.identity.generation,
                  tier: d.identity.tier,
                },
        })),
      },
    });
    return choice.chosen;
  };
}
