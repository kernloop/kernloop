/**
 * `observe` — fitness/cost/health telemetry (spec §3.4, §8 item 7). Every
 * figure is DERIVED from real data: event counts and routing/verdict/outcome
 * statistics come from the audit chain (the `cli.gate.verdict` and
 * `cli.run.outcome` telemetry events the acting tools append), memory counts
 * come from the episodic store, and adapter availability is a live PATH
 * probe. Nothing is estimated, sampled, or fabricated.
 */
import { z } from 'zod';
import { ADAPTER_NAMES, detectAdapter, verifyChain } from '@kernloop/kernel';
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
  verdicts: { total: number; pass: number; fail: number };
  outcomes: { total: number; byStatus: Record<string, number>; totalWallClockMs: number };
  memory: { episodicTraces: number };
  adapters: Array<{ adapter: string; available: boolean; experimental: boolean }>;
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

/** The `observe` tool. See module docs. */
export function observeTool(kern: Kernloop, input: ObserveInput = {}): ObserveResult {
  ObserveInputSchema.parse(input);
  const envelopes = readEnvelopes(kern.paths.audit);
  const eventCounts: Record<string, number> = {};
  const verdicts = { total: 0, pass: 0, fail: 0 };
  const outcomes: ObserveResult['outcomes'] = { total: 0, byStatus: {}, totalWallClockMs: 0 };
  const routePayloads: Record<string, unknown>[] = [];
  for (const envelope of envelopes) {
    eventCounts[envelope.type] = (eventCounts[envelope.type] ?? 0) + 1;
    const payload = payloadOf(envelope.payload);
    if (envelope.type === 'kernel.router.route') routePayloads.push(payload);
    if (envelope.type === 'cli.gate.verdict') {
      verdicts.total += 1;
      if (payload.result === 'pass') verdicts.pass += 1;
      if (payload.result === 'fail') verdicts.fail += 1;
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
      return { adapter, available: probe.available, experimental: adapter === 'ollama' };
    }),
  };
}
