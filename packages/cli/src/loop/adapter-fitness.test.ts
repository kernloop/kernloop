/**
 * Live identity-fitness adapter selection (#252, CLM-0130). Covers chooseAdapter
 * (fitness argmax, the flip, the suppressible exploration floor with the rng
 * draw recorded, neutral tie-break) and buildAdapterSelector (opt-in gate,
 * predicted-identity audit with the rng draw). The bounded-reinforcement
 * simulation is in adapter-fitness.sim.test.ts.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelIdentity, ModelTier } from '@kernloop/contracts';
import type { IdentityFitnessRecord } from '@kernloop/faculty-observer';
import { emptyDiscoveredCache } from '@kernloop/faculty-models';
import { createAuditStore, type AuditStore } from '@kernloop/kernel';
import { EndpointsSchema } from '../endpoints.js';
import type { CandidateIdentity } from '../tools/live-fitness.js';
import { readEnvelopes } from '../tools/audit.js';
import { buildAdapterSelector, chooseAdapter } from './adapter-fitness.js';

const NOW = 1_700_000_000_000;

function identity(provider: string, family: string, tier: ModelTier): ModelIdentity {
  return {
    provider,
    family,
    generation: '1',
    variant: null,
    tier,
    raw: family,
    resolvedBy: 'table',
    contextWindow: null,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
  };
}

function row(
  provider: string,
  family: string,
  tier: string,
  invocations: number,
  successRate: number,
): IdentityFitnessRecord {
  return {
    key: { provider, family, generation: '1', tier },
    invocations,
    successRate,
    cost: { tokens: 0, usd: 0, wallClockMs: 0 },
    lastUsedAt: NOW,
  };
}

const ID_A = identity('anthropic', 'claude-opus', 'large');
const ID_B = identity('openai', 'gpt', 'large');
const CANDS: CandidateIdentity[] = [
  { subject: 'adapter-a', identity: ID_A },
  { subject: 'adapter-b', identity: ID_B },
];

describe('chooseAdapter — fitness argmax + flip (#252)', () => {
  it('picks the higher-fitness candidate, and flips when fitness flips', () => {
    const high = chooseAdapter(
      CANDS,
      [row('anthropic', 'claude-opus', 'large', 20, 0.95), row('openai', 'gpt', 'large', 20, 0.25)],
      () => 0.99,
      0.1,
      NOW,
    );
    expect(high.chosen).toBe('adapter-a');
    expect(high.explored).toBe(false);
    const flip = chooseAdapter(
      CANDS,
      [row('anthropic', 'claude-opus', 'large', 20, 0.25), row('openai', 'gpt', 'large', 20, 0.95)],
      () => 0.99,
      0.1,
      NOW,
    );
    expect(flip.chosen).toBe('adapter-b');
  });

  it('blends the deliverable-PASS signal: equal call-fitness, the higher deliverable-pass wins (#229/#5)', () => {
    // Equal per-CALL fitness → call-only would tie-break to the first candidate.
    const callLedger = [
      row('anthropic', 'claude-opus', 'large', 20, 0.5),
      row('openai', 'gpt', 'large', 20, 0.5),
    ];
    // But adapter-b's model produces deliverables that PASS far more often.
    const deliverableLedger = [
      row('anthropic', 'claude-opus', 'large', 10, 0.2),
      row('openai', 'gpt', 'large', 10, 0.9),
    ];
    // With the deliverable ledger, the SELECTION DECISION CHANGES to adapter-b.
    expect(chooseAdapter(CANDS, callLedger, () => 0.99, 0.1, NOW, deliverableLedger).chosen).toBe(
      'adapter-b',
    );
    // Without it, the call-only tie resolves to the first (proves the deliverable signal flipped it).
    expect(chooseAdapter(CANDS, callLedger, () => 0.99, 0.1, NOW).chosen).toBe('adapter-a');
  });

  it('all-neutral (no live data) → the first candidate, deterministic', () => {
    const c = chooseAdapter(CANDS, [], () => 0.99, 0.1, NOW);
    expect(c.chosen).toBe('adapter-a');
    expect(c.explored).toBe(false);
  });
});

describe('chooseAdapter — exploration floor (#252, conditions 1/2)', () => {
  it('epsilon=0 NEVER explores (pure exploit), even on a zero rng draw', () => {
    // Even though the weak candidate B has high data, exploit picks A; a 0 draw
    // would explore if epsilon>0, but epsilon=0 suppresses it.
    const c = chooseAdapter(
      CANDS,
      [row('anthropic', 'claude-opus', 'large', 20, 0.95), row('openai', 'gpt', 'large', 20, 0.2)],
      () => 0,
      0,
      NOW,
    );
    expect(c.explored).toBe(false);
    expect(c.chosen).toBe('adapter-a');
  });

  it('explores on a low draw and records the rng draw (reproducibility)', () => {
    // First rng() = 0.0 (< epsilon → explore); second = 0.6 → index floor(0.6*2)=1.
    const draws = [0.0, 0.6];
    let i = 0;
    const rng = (): number => draws[i++] ?? 0;
    const c = chooseAdapter(
      CANDS,
      [row('anthropic', 'claude-opus', 'large', 20, 0.95)],
      rng,
      0.1,
      NOW,
    );
    expect(c.explored).toBe(true);
    expect(c.rngDraw).toBe(0.0);
    expect(c.chosen).toBe('adapter-b'); // the explored index, not the fitness winner
  });
});

let dir: string;
let store: AuditStore;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('buildAdapterSelector — opt-in gate + audited provenance (#252, conditions 5)', () => {
  it('returns undefined when disabled (byte-identical legacy path)', () => {
    dir = mkdtempSync(join(tmpdir(), 'kernloop-adsel-'));
    store = createAuditStore(join(dir, 'audit.jsonl'));
    const sel = buildAdapterSelector({
      enabled: false,
      epsilon: 0.1,
      ledger: [],
      discovered: emptyDiscoveredCache('n/a'),
      endpoints: {},
      adapterModels: undefined,
      store,
      rng: () => 0.99,
      now: () => NOW,
    });
    expect(sel).toBeUndefined();
  });

  it('when enabled, picks a candidate and audits the decision with the rng draw', () => {
    dir = mkdtempSync(join(tmpdir(), 'kernloop-adsel-'));
    store = createAuditStore(join(dir, 'audit.jsonl'));
    const sel = buildAdapterSelector({
      enabled: true,
      epsilon: 0, // pure exploit → deterministic
      ledger: [],
      discovered: emptyDiscoveredCache('n/a'),
      endpoints: {},
      adapterModels: undefined,
      store,
      rng: () => 0.99,
      now: () => NOW,
    });
    expect(sel).toBeDefined();
    const chosen = sel?.('large', { tier: 'large', effort: 'medium', capabilities: [] }, [
      'claude',
      'opencode',
    ]);
    expect(['claude', 'opencode']).toContain(chosen);
    const events = readEnvelopes(join(dir, 'audit.jsonl')).filter(
      (e) => e.type === 'cli.node-bind.adapter-fitness',
    );
    expect(events).toHaveLength(1);
    const payload = events[0]?.payload as { chosen: string; rngDraw: number; decisions: unknown[] };
    expect(payload.chosen).toBe(chosen);
    expect(typeof payload.rngDraw).toBe('number');
    expect(payload.decisions).toHaveLength(2);
  });

  it('consults an ENDPOINT candidate fitness (predicted, not neutral) and can pick it over a CLI (#260)', () => {
    dir = mkdtempSync(join(tmpdir(), 'kernloop-adsel-'));
    store = createAuditStore(join(dir, 'audit.jsonl'));
    // The endpoint serves a clean rule-parseable id → identity acme/frodo/2/small;
    // a high-fitness ledger row for THAT identity must lift it over a neutral CLI.
    const endpoints = EndpointsSchema.parse({
      'my-endpoint': {
        baseUrl: 'https://api.example.com/v1',
        apiKeyEnv: 'EXAMPLE_API_KEY',
        models: { large: 'acme/frodo-2' },
      },
    });
    const ledger: IdentityFitnessRecord[] = [
      {
        key: { provider: 'acme', family: 'frodo', generation: '2', tier: 'small' },
        invocations: 30,
        successRate: 0.97,
        cost: { tokens: 0, usd: 0, wallClockMs: 0 },
        lastUsedAt: NOW,
      },
    ];
    const sel = buildAdapterSelector({
      enabled: true,
      epsilon: 0, // pure exploit → deterministic
      ledger,
      discovered: emptyDiscoveredCache('n/a'),
      endpoints,
      adapterModels: undefined,
      store,
      rng: () => 0.99,
      now: () => NOW,
    });
    // 'claude' has NO ledger row → neutral; the endpoint scores ABOVE neutral, so
    // it wins despite being SECOND (the neutral tie-break would have kept 'claude').
    const chosen = sel?.('large', { tier: 'large', effort: 'medium', capabilities: [] }, [
      'claude',
      'my-endpoint',
    ]);
    expect(chosen).toBe('my-endpoint');
    const events = readEnvelopes(join(dir, 'audit.jsonl')).filter(
      (e) => e.type === 'cli.node-bind.adapter-fitness',
    );
    const decisions = (
      events[0]?.payload as { decisions: { subject: string; identity: unknown }[] }
    ).decisions;
    const endpointDecision = decisions.find((d) => d.subject === 'my-endpoint');
    // The endpoint's identity was PREDICTED (non-null), not scored neutral-blind.
    expect(endpointDecision?.identity).not.toBeNull();
  });

  it('an UNKNOWN adapter name (neither CLI nor endpoint) scores neutral with a null identity (#271)', () => {
    dir = mkdtempSync(join(tmpdir(), 'kernloop-adsel-'));
    store = createAuditStore(join(dir, 'audit.jsonl'));
    const sel = buildAdapterSelector({
      enabled: true,
      epsilon: 0,
      ledger: [],
      discovered: emptyDiscoveredCache('n/a'),
      endpoints: {},
      adapterModels: undefined,
      store,
      rng: () => 0.99,
      now: () => NOW,
    });
    // 'no-such-adapter' resolves to neither → predictIdentity catches and returns
    // null; selection still succeeds (neutral), proving the catch is honest.
    const chosen = sel?.('large', { tier: 'large', effort: 'medium', capabilities: [] }, [
      'claude',
      'no-such-adapter',
    ]);
    expect(chosen).toBe('claude'); // neutral tie-break → first candidate
    const decisions = (
      readEnvelopes(join(dir, 'audit.jsonl')).filter(
        (e) => e.type === 'cli.node-bind.adapter-fitness',
      )[0]?.payload as { decisions: { subject: string; identity: unknown }[] }
    ).decisions;
    expect(decisions.find((d) => d.subject === 'no-such-adapter')?.identity).toBeNull();
  });
});
