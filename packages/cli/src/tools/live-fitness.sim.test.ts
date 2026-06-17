/**
 * Bounded-reinforcement SIMULATION (#229 item 2, CLM-0128, binding condition 4 —
 * the load-bearing acceptance bar). A multi-round closed loop: each round builds
 * live priors from the accumulated identity-fitness ledger, lets the REAL kernel
 * Router pick among two competing manifests (with its exploration floor active),
 * simulates an outcome from the selected class's TRUE success rate, and folds
 * that back into the ledger. We then assert QUANTITATIVE bounds (not "it
 * converges"): a favorite whose true quality REGRESSES is abandoned within a
 * bounded tail, the better class takes over, and — the floor invariant — the
 * underdog is NEVER starved out of selection. This proves the live feed cannot
 * lock in a regressed model.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModelIdentity, ModelTier, TaskContract } from '@kernloop/contracts';
import type { IdentityFitnessRecord } from '@kernloop/faculty-observer';
import {
  Ladder,
  ManifestRegistry,
  Router,
  createAuditStore,
  type AuditStore,
} from '@kernloop/kernel';
import { liveFitnessPriors, type CandidateIdentity } from './live-fitness.js';

const NOW = 1_700_000_000_000;

/** Deterministic LCG so the whole simulation is reproducible per seed. */
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
    raw: `${family}`,
    resolvedBy: 'table',
    contextWindow: null,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
  };
}

const ID_A = identity('anthropic', 'claude-opus', 'large');
const ID_B = identity('openai', 'gpt', 'large');
const CANDIDATES: CandidateIdentity[] = [
  { subject: 'cap-a', identity: ID_A },
  { subject: 'cap-b', identity: ID_B },
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

let dir: string;
let store: AuditStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-livefit-sim-'));
  store = createAuditStore(join(dir, 'audit.jsonl'), {
    clock: () => new Date('2026-06-17T00:00:00.000Z'),
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function task(): TaskContract {
  return {
    id: 'task-sim',
    goal: 'sim',
    constraints: [],
    budget: { tokens: 10_000, usd: 5, wallClockMin: 30 },
    evidence: [],
    definitionOfDone: [],
    authorityCeiling: 'enforce',
    overlay: 'repo-overlay',
  };
}

interface SimResult {
  picks: string[]; // selected subject per round
  aTotal: number;
  bTotal: number;
}

/** Run one full simulation for a seed: A is the favorite, then regresses at FLIP. */
function runSim(seed: number, rounds: number, flip: number): SimResult {
  const registry = new ManifestRegistry(store);
  const ladder = new Ladder(store);
  const base = {
    version: '1.0.0' as const,
    kind: 'faculty' as const,
    capabilities: [{ name: 'cap' }],
    contracts: { consumes: ['TaskContract' as const], emits: ['Outcome' as const] },
    cost: { tokens: 1000, usd: 0.5, latencyMs: 100 },
    tier: 'suggest' as const,
    claims: [],
    maturity: 'experimental' as const,
  };
  registry.register({ ...base, name: 'cap-a' });
  registry.register({ ...base, name: 'cap-b' });
  const router = new Router({ registry, ladder, store, rng: lcg(seed) });
  const outcome = lcg(seed + 7919);

  const a: Counter = { inv: 0, succ: 0 };
  const b: Counter = { inv: 0, succ: 0 };
  const picks: string[] = [];
  for (let r = 0; r < rounds; r++) {
    const { map } = liveFitnessPriors(CANDIDATES, ledgerFrom(a, b), new Map(), NOW);
    const decision = router.route({
      task: task(),
      capability: 'cap',
      requiredTier: 'suggest',
      fitnessPriors: map,
    });
    const name = decision.selected?.name ?? 'none';
    picks.push(name);
    // TRUE success rates: A is strong until FLIP, then regresses hard; B steady.
    const trueA = r < flip ? 0.95 : 0.15;
    const trueB = 0.6;
    const counter = name === 'cap-a' ? a : b;
    const trueRate = name === 'cap-a' ? trueA : trueB;
    counter.inv += 1;
    if (outcome() < trueRate) counter.succ += 1;
  }
  return { picks, aTotal: a.inv, bTotal: b.inv };
}

describe('live identity-fitness — bounded reinforcement (condition 4)', () => {
  const SEEDS = [1, 13, 42, 101, 2024, 99991];
  const ROUNDS = 200;
  const FLIP = 20;
  const TAIL = 60; // assert over the last 60 rounds, long after the regression

  it('abandons a regressed favorite within a bounded tail and lets the better class take over', () => {
    for (const seed of SEEDS) {
      const { picks } = runSim(seed, ROUNDS, FLIP);
      const tail = picks.slice(ROUNDS - TAIL);
      const tailA = tail.filter((p) => p === 'cap-a').length / TAIL;
      const tailB = tail.filter((p) => p === 'cap-b').length / TAIL;
      // QUANTITATIVE bound: the regressed favorite is abandoned (only the
      // exploration floor still reaches it), the better class dominates.
      expect(tailB, `seed ${String(seed)} tailB`).toBeGreaterThan(0.6);
      expect(tailA, `seed ${String(seed)} tailA`).toBeLessThan(0.25);
    }
  });

  it('never starves a class — the underdog is explored despite low early fitness (floor invariant)', () => {
    for (const seed of SEEDS) {
      const { aTotal, bTotal } = runSim(seed, ROUNDS, FLIP);
      // B is the underdog for the first FLIP rounds; the exploration floor must
      // still have selected it several times, and A is never fully starved either.
      expect(bTotal, `seed ${String(seed)} bTotal`).toBeGreaterThanOrEqual(3);
      expect(aTotal, `seed ${String(seed)} aTotal`).toBeGreaterThanOrEqual(3);
    }
  });
});
