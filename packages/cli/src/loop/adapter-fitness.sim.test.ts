/**
 * Bounded-reinforcement SIMULATION for adapter-fitness selection (#252, CLM-0130,
 * the load-bearing acceptance bar). Two candidate adapters; each round builds the
 * ledger from accumulated outcomes, chooseAdapter picks (with its exploration
 * floor), and the chosen adapter's TRUE success rate produces an outcome folded
 * back in. As a PROPERTY test over a CONTIGUOUS seed range at a horizon where the
 * bound holds for every seed: a favorite whose quality REGRESSES is abandoned
 * (the better adapter takes the tail) and neither adapter is starved.
 */
import { describe, expect, it } from 'vitest';
import type { ModelIdentity, ModelTier } from '@kernloop/contracts';
import type { IdentityFitnessRecord } from '@kernloop/faculty-observer';
import type { CandidateIdentity } from '../tools/live-fitness.js';
import { chooseAdapter } from './adapter-fitness.js';

const NOW = 1_700_000_000_000;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

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

const CANDS: CandidateIdentity[] = [
  { subject: 'adapter-a', identity: identity('anthropic', 'claude-opus', 'large') },
  { subject: 'adapter-b', identity: identity('openai', 'gpt', 'large') },
];

interface Counter {
  inv: number;
  succ: number;
}

function ledgerFrom(a: Counter, b: Counter): IdentityFitnessRecord[] {
  const rows: IdentityFitnessRecord[] = [];
  if (a.inv > 0)
    rows.push({
      key: { provider: 'anthropic', family: 'claude-opus', generation: '1', tier: 'large' },
      invocations: a.inv,
      successRate: a.succ / a.inv,
      cost: { tokens: 0, usd: 0, wallClockMs: 0 },
      lastUsedAt: NOW,
    });
  if (b.inv > 0)
    rows.push({
      key: { provider: 'openai', family: 'gpt', generation: '1', tier: 'large' },
      invocations: b.inv,
      successRate: b.succ / b.inv,
      cost: { tokens: 0, usd: 0, wallClockMs: 0 },
      lastUsedAt: NOW,
    });
  return rows;
}

function runSim(
  seed: number,
  rounds: number,
  flip: number,
): { picks: string[]; aTotal: number; bTotal: number } {
  const rng = lcg(seed);
  const outcome = lcg(seed + 7919);
  const a: Counter = { inv: 0, succ: 0 };
  const b: Counter = { inv: 0, succ: 0 };
  const picks: string[] = [];
  for (let r = 0; r < rounds; r++) {
    const { chosen } = chooseAdapter(CANDS, ledgerFrom(a, b), rng, 0.1, NOW);
    picks.push(chosen);
    const trueRate = chosen === 'adapter-a' ? (r < flip ? 0.95 : 0.15) : 0.6;
    const counter = chosen === 'adapter-a' ? a : b;
    counter.inv += 1;
    if (outcome() < trueRate) counter.succ += 1;
  }
  return { picks, aTotal: a.inv, bTotal: b.inv };
}

describe('adapter-fitness — bounded reinforcement (#252, condition 7)', () => {
  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
  const ROUNDS = 400;
  const FLIP = 20;
  const TAIL = 80;

  it('abandons a regressed favorite adapter for EVERY seed and lets the better one take over', () => {
    for (const seed of SEEDS) {
      const { picks } = runSim(seed, ROUNDS, FLIP);
      const tail = picks.slice(ROUNDS - TAIL);
      const tailA = tail.filter((p) => p === 'adapter-a').length / TAIL;
      const tailB = tail.filter((p) => p === 'adapter-b').length / TAIL;
      expect(tailB, `seed ${String(seed)} tailB`).toBeGreaterThan(0.6);
      expect(tailA, `seed ${String(seed)} tailA`).toBeLessThan(0.25);
    }
  }, 120_000);

  it('never starves an adapter — the underdog is explored despite low early fitness', () => {
    for (const seed of SEEDS) {
      const { aTotal, bTotal } = runSim(seed, ROUNDS, FLIP);
      expect(bTotal, `seed ${String(seed)} bTotal`).toBeGreaterThanOrEqual(3);
      expect(aTotal, `seed ${String(seed)} aTotal`).toBeGreaterThanOrEqual(3);
    }
  }, 120_000);
});
