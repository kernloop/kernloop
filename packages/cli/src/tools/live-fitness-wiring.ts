/**
 * Composition-root wiring for live identity-fitness routing (#229 item 2,
 * CLM-0128). Keeps the impure glue — predicting each candidate's served
 * identity, reading the Observer ledger, auditing provenance — out of run.ts so
 * the pure scoring core (live-fitness.ts) and the run tool both stay lean.
 */
import { appendEvent, type AdapterName } from '@kernloop/kernel';
import type { ModelIdentity, ModelRequirement } from '@kernloop/contracts';
import type { Kernloop } from '../kernel.js';
import { resolveServed, servedIdentity } from '../loop/node-seam.js';
import { seededPriorsFor } from './priors-seed.js';
import { liveFitnessPriors, type CandidateIdentity } from './live-fitness.js';

/**
 * Predict the {@link ModelIdentity} a candidate's `model` requirement would be
 * served by, WITHOUT running it: mirror node-bind's per-tier adapter pick
 * (`overlay.adapters[tier] ?? runAdapter`), resolve the served model through the
 * kernel seam, and normalize it. Returns null for an endpoint adapter (identity
 * resolves on the api path, not here) or any resolution failure — the candidate
 * then degrades to the seeded/neutral baseline.
 */
function predictIdentity(
  req: ModelRequirement,
  kern: Kernloop,
  runAdapter: AdapterName,
): ModelIdentity | null {
  const name = kern.config.adapters?.[req.tier] ?? runAdapter;
  if (kern.config.endpoints[name] !== undefined) return null;
  try {
    return servedIdentity(resolveServed(req, name as AdapterName));
  } catch {
    return null;
  }
}

/**
 * The Router's `fitnessPriors` fragment: the seeded baseline (CLM-0126) with
 * LIVE identity-fitness overrides applied when `router.liveFitness` is opted in
 * (CLM-0128). With the flag off it returns the seeded baseline unchanged
 * (byte-identical to seed-only routing); with it on it predicts each candidate's
 * served identity, reads the Observer's identity-fitness ledger, merges per the
 * bootstrap/override policy, and audits the per-candidate provenance (rule 7).
 */
export function routePriors(
  kern: Kernloop,
  capability: string,
  runAdapter: AdapterName,
  taskId: string,
): { fitnessPriors?: Map<string, number> } {
  const seeded = seededPriorsFor(
    kern.config.router.seedPriors,
    kern.paths.priors,
    kern.store,
    taskId,
  );
  if (!kern.config.router.liveFitness) return seeded;
  const baseline = seeded.fitnessPriors ?? new Map<string, number>();
  const candidates: CandidateIdentity[] = kern.registry.findByCapability(capability).map((m) => ({
    subject: m.name,
    identity: m.model ? predictIdentity(m.model, kern, runAdapter) : null,
  }));
  const { map, decisions } = liveFitnessPriors(
    candidates,
    kern.observer.identityFitnessLedger(),
    baseline,
    Date.now(),
  );
  appendEvent(kern.store, {
    type: 'cli.router.live-fitness',
    payload: {
      taskId,
      capability,
      decisions: decisions.map((d) => ({
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
        exactSamples: d.exactSamples,
        classSamples: d.classSamples,
      })),
    },
  });
  return { fitnessPriors: map };
}
