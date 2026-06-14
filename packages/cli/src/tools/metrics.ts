/**
 * `kernloop metrics` — governance metrics in Prometheus exposition format
 * (#125). A CLI-only view (NOT a kernel MCP tool — the surface stays the
 * eleven, spec §3.4): it reads ONLY the audit chain and the Observer ledger
 * the composition root already ingested, and formats them as scrapable text.
 * Every figure is DERIVED from real recorded data — run outcomes and gate
 * verdicts counted off the chain, cost/precision/cost-per-decision read from
 * the ledger — nothing estimated or fabricated (the prime directive). It is
 * read-only: no mutation, no new model/gh surface.
 *
 * Format is Prometheus TEXT EXPOSITION (dependency-free string formatting),
 * directly scrapable and consumable by an OpenTelemetry Collector via its
 * `prometheus` receiver. A native OTLP push exporter is a follow-up (#125).
 */
import { verifyChain } from '@kernloop/kernel';
import type { Kernloop } from '../kernel.js';
import { readEnvelopes } from './audit.js';

/** Escape a Prometheus label value: backslash, double-quote, newline. Exported
 * for direct unit test — the recorded label values (gate/status/result) are
 * clean, so the escape branches are not reachable through the audit chain. */
export function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/** One metric sample: optional labels and a numeric value. */
interface Sample {
  readonly labels?: Readonly<Record<string, string>>;
  readonly value: number;
}

/** Render one metric family — `# HELP`/`# TYPE` header then its samples (a
 * family with no samples still emits the header, so the metric is discoverable). */
function family(name: string, help: string, type: 'counter' | 'gauge', samples: Sample[]): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
  for (const s of samples) {
    const entries = Object.entries(s.labels ?? {});
    const labels =
      entries.length === 0
        ? ''
        : `{${entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(',')}}`;
    lines.push(`${name}${labels} ${String(s.value)}`);
  }
  return lines.join('\n');
}

/** Increment a `key -> count` tally. */
function bump(tally: Map<string, number>, key: string): void {
  tally.set(key, (tally.get(key) ?? 0) + 1);
}

/** Narrow an envelope payload to a record for field reads. */
function payloadOf(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

/** A string field or a `'unknown'` fallback (never an invented value). */
function strField(payload: Record<string, unknown>, key: string): string {
  return typeof payload[key] === 'string' ? (payload[key] as string) : 'unknown';
}

/** The chain-derived samples plus the gate/voter sets the Observer figures key
 * off (every reported gate/voter is grounded in a real recorded verdict). */
interface ChainSamples {
  readonly runs: Sample[];
  readonly verdicts: Sample[];
  readonly routes: Sample[];
  readonly gates: ReadonlySet<string>;
  readonly voters: ReadonlySet<string>;
}

/** Count run outcomes (capability+status), gate verdicts (gate+result), and
 * router decisions (outcome) off the audit chain into Prometheus samples. */
function aggregateChain(envelopes: ReturnType<typeof readEnvelopes>): ChainSamples {
  const runs = new Map<string, number>();
  const verdicts = new Map<string, number>();
  const routes = new Map<string, number>();
  const gates = new Set<string>();
  const voters = new Set<string>();
  for (const envelope of envelopes) {
    const p = payloadOf(envelope.payload);
    if (envelope.type === 'cli.run.outcome') {
      bump(runs, `${strField(p, 'capability')} ${strField(p, 'status')}`);
    } else if (envelope.type === 'cli.gate.verdict') {
      const gate = strField(p, 'gate');
      gates.add(gate);
      bump(verdicts, `${gate} ${strField(p, 'result')}`);
      if (Array.isArray(p.voters))
        for (const v of p.voters) if (typeof v === 'string') voters.add(v);
    } else if (envelope.type === 'kernel.router.route') {
      bump(routes, strField(p, 'outcome'));
    }
  }
  const pair = (m: Map<string, number>, a: string, b: string): Sample[] =>
    [...m].map(([key, value]) => {
      const [x, y] = key.split(' ');
      return { labels: { [a]: x ?? '', [b]: y ?? '' }, value };
    });
  return {
    runs: pair(runs, 'capability', 'status'),
    verdicts: pair(verdicts, 'gate', 'result'),
    routes: [...routes].map(([outcome, value]) => ({ labels: { outcome }, value })),
    gates,
    voters,
  };
}

/** Observer-ledger figures: total metered cost, mean per-gate decision cost,
 * and per-voter running precision (only where a labeled window exists). */
function observerSamples(
  kern: Kernloop,
  gates: ReadonlySet<string>,
  voters: ReadonlySet<string>,
): { totalTokens: number; totalUsd: number; decisionCost: Sample[]; precision: Sample[] } {
  const ledger = kern.observer.fitnessLedger();
  return {
    totalTokens: ledger.reduce((sum, r) => sum + r.cost.tokens, 0),
    totalUsd: ledger.reduce((sum, r) => sum + r.cost.usd, 0),
    decisionCost: [...gates]
      .sort()
      .map((gate) => ({ gate, cost: kern.observer.costPerGovernedDecision(gate) }))
      .filter((g): g is { gate: string; cost: NonNullable<typeof g.cost> } => g.cost !== undefined)
      .map(({ gate, cost }) => ({ labels: { gate }, value: cost.meanUsd })),
    precision: [...voters]
      .sort()
      .map((voter) => ({ voter, p: kern.observer.runningPrecision(voter).precision }))
      .filter((v): v is { voter: string; p: number } => v.p !== undefined)
      .map(({ voter, p }) => ({ labels: { voter }, value: p })),
  };
}

/** One metric family spec: name, HELP text, type, samples. */
type FamilySpec = [string, string, 'counter' | 'gauge', Sample[]];

/** The full metric-family list for a scan: chain-derived counters + Observer
 * gauges + chain-health gauges. Pure assembly — no I/O (the caller reads). */
function metricFamilies(
  envelopeCount: number,
  verified: boolean,
  chain: ChainSamples,
  obs: ReturnType<typeof observerSamples>,
): FamilySpec[] {
  const one = (value: number): Sample[] => [{ value }];
  return [
    ['kernloop_runs_total', 'Canonical-loop run outcomes.', 'counter', chain.runs],
    [
      'kernloop_gate_verdicts_total',
      'Gate verdicts by gate and result.',
      'counter',
      chain.verdicts,
    ],
    ['kernloop_routing_decisions_total', 'Router decisions by outcome.', 'counter', chain.routes],
    [
      'kernloop_cost_tokens_total',
      'Metered model tokens (Observer ledger).',
      'counter',
      one(obs.totalTokens),
    ],
    [
      'kernloop_cost_usd_total',
      'Metered model spend in USD (Observer ledger).',
      'counter',
      one(obs.totalUsd),
    ],
    [
      'kernloop_cost_per_governed_decision_usd',
      'Mean USD cost per governed decision, by gate.',
      'gauge',
      obs.decisionCost,
    ],
    [
      'kernloop_running_precision',
      'Per-voter running precision (labeled window); emitted only when labels exist.',
      'gauge',
      obs.precision,
    ],
    ['kernloop_audit_chain_length', 'Audit-chain envelope count.', 'gauge', one(envelopeCount)],
    [
      'kernloop_audit_chain_verified',
      'Audit hash-chain integrity (1 = verified).',
      'gauge',
      one(verified ? 1 : 0),
    ],
  ];
}

/**
 * Build the Prometheus exposition text for one overlay [CLM-0110]. Reads the
 * audit chain for run-outcome and gate-verdict counts and the Observer ledger
 * for metered cost, per-gate decision cost, and per-voter running precision.
 * Returns text ending in a single trailing newline (the exposition convention).
 */
export function metricsExport(kern: Kernloop): string {
  const envelopes = readEnvelopes(kern.paths.audit);
  const chain = aggregateChain(envelopes);
  const obs = observerSamples(kern, chain.gates, chain.voters);
  const families = metricFamilies(envelopes.length, verifyChain(kern.store).ok, chain, obs);
  return (
    families.map(([name, help, type, samples]) => family(name, help, type, samples)).join('\n\n') +
    '\n'
  );
}
