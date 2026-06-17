/**
 * Bounded-reinforcement SIMULATION (#229 item 2, CLM-0128, binding condition 4 —
 * the load-bearing acceptance bar). A multi-round closed loop: each round builds
 * live priors from the accumulated identity-fitness ledger, lets the REAL kernel
 * Router pick among two competing manifests (exploration floor active), simulates
 * an outcome from the selected class's TRUE success rate, and folds it back into
 * the ledger. We then assert QUANTITATIVE bounds (not "it converges") as a
 * PROPERTY test over a CONTIGUOUS seed range — not a cherry-picked set — at a
 * horizon (ROUNDS) long enough that the bound holds for EVERY seed:
 *  - a favorite whose true quality REGRESSES is abandoned (the better class
 *    takes the tail) for every seed in the range, and
 *  - the abandoned class is never starved — the exploration floor still reaches
 *    it in the tail.
 * The bound is finite by the law of large numbers (a regressed class's
 * cumulative success rate is dragged to its true low rate), so a sufficient
 * horizon abandons it; an earlier sweep showed a 200-round horizon is too short
 * for ~2-3% of seeds while 400 abandons all 300 swept — hence ROUNDS=400 here.
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
  // A CONTIGUOUS seed range (not cherry-picked); the bound must hold for EVERY one.
  const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
  const ROUNDS = 400;
  const FLIP = 20;
  const TAIL = 80; // assert over the last 80 rounds, long after the regression

  it('abandons a regressed favorite for EVERY seed in the range and lets the better class take over', () => {
    for (const seed of SEEDS) {
      const { picks } = runSim(seed, ROUNDS, FLIP);
      const tail = picks.slice(ROUNDS - TAIL);
      const tailA = tail.filter((p) => p === 'cap-a').length / TAIL;
      const tailB = tail.filter((p) => p === 'cap-b').length / TAIL;
      // QUANTITATIVE bound, held for all seeds: the regressed favorite is
      // abandoned and the better class dominates the tail.
      expect(tailB, `seed ${String(seed)} tailB`).toBeGreaterThan(0.6);
      expect(tailA, `seed ${String(seed)} tailA`).toBeLessThan(0.25);
    }
  }, 120_000);

  it('never starves the abandoned class — the exploration floor still reaches it in the tail', () => {
    let tailLoserPicks = 0;
    for (const seed of SEEDS) {
      const { picks, aTotal } = runSim(seed, ROUNDS, FLIP);
      // A is never fully starved over the whole run.
      expect(aTotal, `seed ${String(seed)} A total`).toBeGreaterThanOrEqual(1);
      tailLoserPicks += picks.slice(ROUNDS - TAIL).filter((p) => p === 'cap-a').length;
    }
    // Post-regression, exploitation NEVER picks A; that A is still selected in
    // the tail across seeds is the exploration floor reaching the loser — the
    // anti-starvation invariant (CLM-0028), here under a live regressing feed.
    expect(tailLoserPicks).toBeGreaterThan(0);
  }, 120_000);
});
