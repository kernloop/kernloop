/**
 * `observe` — fitness/cost/health telemetry (spec §3.4, §8 item 7). Every
 * figure is DERIVED from real data: event counts and routing/verdict/outcome
 * statistics come from the audit chain (the `cli.gate.verdict` and
 * `cli.run.outcome` telemetry events the acting tools append), memory counts
 * come from the episodic store, adapter availability is a live PATH probe,
 * and the observer section (fitness ledger, cost per governed decision,
 * drift signals, voter series — spec §5.5) reads the rows the composition
 * root actually ingested. Nothing is estimated, sampled, or fabricated.
 */
import { z } from 'zod';
import { ADAPTER_NAMES, adapterDefinitions, detectAdapter, verifyChain } from '@kernloop/kernel';
import { VerdictResultSchema } from '@kernloop/contracts';
import { verdictDisposition } from '@kernloop/workflows';
import type {
  DriftSignal,
  FitnessRecord,
  GateDecisionCost,
  LifecycleProposal,
} from '@kernloop/faculty-observer';
import type { Kernloop } from '../kernel.js';
import { readEnvelopes } from './audit.js';

/** Input to the `observe` tool — no parameters in P1. */
export const ObserveInputSchema = z.strictObject({});
export type ObserveInput = z.input<typeof ObserveInputSchema>;

/** Telemetry derived from the chain, the memory store, and PATH probes. */
export interface ObserveResult {
  audit: { length: number; verified: boolean };
  eventCounts: Record<string, number>;
  routing: {
    decisions: number;
    routed: number;
    noEligible: number;
    unknownCapability: number;
    explored: number;
  };
  verdicts: { total: number; pass: number; fail: number; escalate: number };
  outcomes: { total: number; byStatus: Record<string, number>; totalWallClockMs: number };
  memory: { episodicTraces: number };
  adapters: Array<{ adapter: string; available: boolean; experimental: boolean }>;
  /** Observer faculty figures (spec §5.5) — read from the real ingested
   * ledger; an empty ledger reports empty arrays, never invented rows. */
  observer: {
    /** The fitness ledger, most recently used subject first. */
    fitnessLedger: FitnessRecord[];
    /** Mean verdict cost per gate, for every gate seen on the chain. */
    costPerGovernedDecision: GateDecisionCost[];
    /** Subjects whose recent window underperforms lifetime. */
    driftSignals: DriftSignal[];
    /** Per-voter series presence: every voter seen and their vote count. */
    voterSeries: Array<{ voter: string; votes: number }>;
    /**
     * Suggest-tier deprecation + distill proposals derived from the ledger
     * (CLM-0092). Surfaced alongside fitness so a human sees both; computing
     * them files/demotes/distills nothing — every proposal awaits human
     * ratification. Empty ledger → empty array.
     */
    lifecycleProposals: LifecycleProposal[];
  };
}

/** Narrow an envelope payload to a record for field reads. */
function payloadOf(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

/** Tally routing statistics from `kernel.router.route` payloads. */
function tallyRouting(payloads: Record<string, unknown>[]): ObserveResult['routing'] {
  const routing = { decisions: 0, routed: 0, noEligible: 0, unknownCapability: 0, explored: 0 };
  for (const p of payloads) {
    routing.decisions += 1;
    if (p.outcome === 'routed') routing.routed += 1;
    if (p.outcome === 'no_eligible_candidate') routing.noEligible += 1;
    if (p.outcome === 'unknown_capability') routing.unknownCapability += 1;
    if (p.explored === true) routing.explored += 1;
  }
  return routing;
}

/**
 * Observer figures (spec §5.5, §8 item 7). The gates and voters whose
 * series are reported come from the chain's `cli.gate.verdict` telemetry —
 * the same events the acting tools appended — so every reported series is
 * grounded in something that demonstrably happened; the figures themselves
 * read from the observer's ingested ledger.
 */
function observerReport(
  kern: Kernloop,
  gateVerdicts: ReadonlyArray<Record<string, unknown>>,
): ObserveResult['observer'] {
  const gates = new Set<string>();
  const voters = new Set<string>();
  for (const payload of gateVerdicts) {
    if (typeof payload.gate === 'string') gates.add(payload.gate);
    if (Array.isArray(payload.voters)) {
      for (const voter of payload.voters) {
        if (typeof voter === 'string') voters.add(voter);
      }
    }
  }
  return {
    fitnessLedger: kern.observer.fitnessLedger(),
    costPerGovernedDecision: [...gates]
      .sort()
      .map((gate) => kern.observer.costPerGovernedDecision(gate))
      .filter((cost): cost is GateDecisionCost => cost !== undefined),
    driftSignals: kern.observer.driftSignals(),
    voterSeries: [...voters]
      .sort()
      .map((voter) => ({ voter, votes: kern.observer.voterSeries(voter).length })),
    lifecycleProposals: kern.observer.lifecycleProposals(),
  };
}

/**
 * Tally one gate verdict into pass / fail / escalate by its DISPOSITION (#192/#361),
 * routing through the single {@link verdictDisposition} classifier rather than a raw
 * `result === 'pass'`. A second `escalate` producer (the parsimony gate's
 * escalateOnRefute, #415) gets its OWN bucket, never silently dropped from pass/fail;
 * a malformed/unknown `result` is counted in `total` only (observe is read-only and
 * crash-proof — it never throws on a tampered payload).
 */
function tallyVerdict(verdicts: ObserveResult['verdicts'], result: unknown): void {
  verdicts.total += 1;
  const parsed = VerdictResultSchema.safeParse(result);
  if (!parsed.success) return;
  const disposition = verdictDisposition(parsed.data);
  if (disposition === 'advance') verdicts.pass += 1;
  else if (disposition === 'escalate') verdicts.escalate += 1;
  else verdicts.fail += 1;
}

/** The `observe` tool. See module docs. */
export function observeTool(kern: Kernloop, input: ObserveInput = {}): ObserveResult {
  ObserveInputSchema.parse(input);
  const envelopes = readEnvelopes(kern.paths.audit);
  const eventCounts: Record<string, number> = {};
  const verdicts = { total: 0, pass: 0, fail: 0, escalate: 0 };
  const outcomes: ObserveResult['outcomes'] = { total: 0, byStatus: {}, totalWallClockMs: 0 };
  const routePayloads: Record<string, unknown>[] = [];
  const gateVerdictPayloads: Record<string, unknown>[] = [];
  for (const envelope of envelopes) {
    eventCounts[envelope.type] = (eventCounts[envelope.type] ?? 0) + 1;
    const payload = payloadOf(envelope.payload);
    if (envelope.type === 'kernel.router.route') routePayloads.push(payload);
    if (envelope.type === 'cli.gate.verdict') {
      gateVerdictPayloads.push(payload);
      tallyVerdict(verdicts, payload.result);
    }
    if (envelope.type === 'cli.run.outcome') {
      outcomes.total += 1;
      const status = typeof payload.status === 'string' ? payload.status : 'unknown';
      outcomes.byStatus[status] = (outcomes.byStatus[status] ?? 0) + 1;
      if (typeof payload.wallClockMs === 'number') outcomes.totalWallClockMs += payload.wallClockMs;
    }
  }
  return {
    audit: { length: envelopes.length, verified: verifyChain(kern.store).ok },
    eventCounts,
    routing: tallyRouting(routePayloads),
    verdicts,
    outcomes,
    memory: { episodicTraces: kern.memory.listSummaries({ limit: 1_000_000 }).length },
    adapters: ADAPTER_NAMES.map((adapter) => {
      const probe = detectAdapter(adapter);
      // Experimental tier comes from the adapter definition (the single source of
      // truth), not a hardcoded name — so a new experimental adapter (e.g. agy, #387)
      // is reported honestly without editing this list.
      return {
        adapter,
        available: probe.available,
        experimental: adapterDefinitions[adapter].experimental,
      };
    }),
    observer: observerReport(kern, gateVerdictPayloads),
  };
}
