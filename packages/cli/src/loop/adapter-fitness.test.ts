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
});
