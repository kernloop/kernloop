/**
 * Exploration-floor suite (spec §3.2) [CLM-0028, CLM-0027]: the epsilon
 * floor keeps demoted/low-fitness manifests reachable (no demote→starve→
 * prune spiral) while the authorityCeiling holds under every roll of a
 * seeded rng — safety beats exploration. Fully deterministic: every test
 * injects either a fixed rng sequence or a seeded mulberry32 stream.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Manifest, TaskContract, Tier } from '@kernloop/contracts';
import { createAuditStore, type AuditStore } from '../audit/index.js';
import { Ladder, tierRank } from '../ladder/index.js';
import { ManifestRegistry } from '../registry/index.js';
import { Router } from './router.js';

let dir: string;
let store: AuditStore;
let registry: ManifestRegistry;
let ladder: Ladder;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-router-explore-'));
  store = createAuditStore(join(dir, 'audit.jsonl'), {
    clock: () => new Date('2026-06-09T00:00:00.000Z'),
  });
  registry = new ManifestRegistry(store);
  ladder = new Ladder(store);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Router with a deterministic rng that replays the given sequence. */
function routerWithSequence(...values: number[]): Router {
  let i = 0;
  const rng = (): number => values[i++ % values.length] ?? 0.5;
  return new Router({ registry, ladder, store, rng });
}

/** Small deterministic PRNG for seeded sweeps (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function manifest(name: string, overrides: Partial<Manifest> = {}): Manifest {
  return registry.register({
    name,
    version: '1.0.0',
    kind: 'faculty',
    capabilities: [{ name: 'compile-brief' }],
    contracts: { consumes: ['TaskContract'], emits: ['Outcome'] },
    cost: { tokens: 1000, usd: 0.5, latencyMs: 100 },
    tier: 'suggest',
    claims: [],
    maturity: 'experimental',
    ...overrides,
  });
}

function task(overrides: Partial<TaskContract> = {}): TaskContract {
  return {
    id: 'task-explore',
    goal: 'compile a brief',
    constraints: [],
    budget: { tokens: 10_000, usd: 5, wallClockMin: 30 },
    evidence: [],
    definitionOfDone: [],
    authorityCeiling: 'enforce',
    overlay: 'repo-overlay',
    ...overrides,
  };
}

describe('exploration floor [CLM-0028]', () => {
  it('a demoted manifest with rock-bottom fitness is still selectable via the exploration floor', () => {
    // zeta-demoted was demoted from advisory to suggest and has rock-bottom
    // fitness: exploitation would never pick it. With a seeded exploration
    // roll (0.05 < epsilon) and uniform index 0.9 → floor(0.9·2) = 1, the
    // floor routes to it — still-allowed tiers stay reachable (spec §3.2).
    manifest('alpha-strong', { tier: 'advisory' });
    manifest('zeta-demoted', { tier: 'suggest' });
    const priors = new Map([
      ['alpha-strong', 0.99],
      ['zeta-demoted', 0.01],
    ]);
    const decision = routerWithSequence(0.05, 0.9).route({
      task: task({ authorityCeiling: 'advisory' }),
      capability: 'compile-brief',
      requiredTier: 'suggest',
      fitnessPriors: priors,
    });
    expect(decision.selected?.name).toBe('zeta-demoted');
    expect(decision.explored).toBe(true);
  });

  it('exploitation never picks the rock-bottom candidate when a stronger prior exists', () => {
    manifest('alpha-strong', { tier: 'advisory' });
    manifest('zeta-demoted', { tier: 'suggest' });
    const decision = routerWithSequence(0.5).route({
      task: task({ authorityCeiling: 'advisory' }),
      capability: 'compile-brief',
      requiredTier: 'suggest',
      fitnessPriors: new Map([
        ['alpha-strong', 0.99],
        ['zeta-demoted', 0.01],
      ]),
    });
    expect(decision.selected?.name).toBe('alpha-strong');
    expect(decision.explored).toBe(false);
  });

  it('exploration selects uniformly among ceiling-allowed candidates including over-budget ones', () => {
    // Pool = capability matches at or below the ceiling: alpha (eligible)
    // and beta (over budget — exploration relaxes budget/actor-tier
    // filters; the run tool re-checks at execution). gamma sits above the
    // ceiling and is NEVER in the pool: safety beats exploration.
    manifest('alpha');
    manifest('beta', { cost: { tokens: 999_999, usd: 0.5, latencyMs: 100 } });
    manifest('gamma', { tier: 'enforce' });
    const ceilingTask = task({ authorityCeiling: 'advisory' });
    const picked = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const decision = routerWithSequence(0.0, i / 20).route({
        task: ceilingTask,
        capability: 'compile-brief',
        requiredTier: 'suggest',
      });
      expect(decision.explored).toBe(true);
      expect(decision.selected?.name).not.toBe('gamma');
      if (decision.selected !== null) picked.add(decision.selected.name);
    }
    expect(picked).toEqual(new Set(['alpha', 'beta']));
    const beta = registry.get('beta');
    expect(beta?.cost.tokens).toBeGreaterThan(ceilingTask.budget.tokens);
  });

  it('falls back to exploitation when the exploration roll fires but no candidate is ceiling-allowed', () => {
    manifest('alpha', { tier: 'enforce' });
    const decision = routerWithSequence(0.0, 0.0).route({
      task: task({ authorityCeiling: 'observe' }),
      capability: 'compile-brief',
      requiredTier: 'observe',
    });
    expect(decision.selected).toBeNull();
    expect(decision.explored).toBe(false);
  });

  it('identical seeds produce identical routing decisions', () => {
    manifest('alpha');
    manifest('beta');
    manifest('gamma');
    const run = (seed: number): string[] => {
      const r = new Router({ registry, ladder, store, rng: mulberry32(seed) });
      const picks: string[] = [];
      for (let i = 0; i < 10; i += 1) {
        const d = r.route({ task: task(), capability: 'compile-brief', requiredTier: 'suggest' });
        picks.push(`${d.selected?.name ?? 'none'}:${String(d.explored)}`);
      }
      return picks;
    };
    expect(run(42)).toEqual(run(42));
  });
});

describe('ceiling holds under exploration [CLM-0027]', () => {
  it('never exceeds the authorityCeiling even under exploration (seeded rng sweep)', () => {
    const tiers: Tier[] = ['observe', 'suggest', 'advisory', 'enforce'];
    for (const tier of tiers) manifest(`cap-${tier}`, { tier });
    const ceiling: Tier = 'suggest';
    let explorations = 0;
    for (let seed = 1; seed <= 100; seed += 1) {
      const router = new Router({ registry, ladder, store, rng: mulberry32(seed) });
      const decision = router.route({
        task: task({ authorityCeiling: ceiling }),
        capability: 'compile-brief',
        requiredTier: 'observe',
      });
      expect(decision.selected).not.toBeNull();
      expect(tierRank((decision.selected as Manifest).tier)).toBeLessThanOrEqual(tierRank(ceiling));
      if (decision.explored) explorations += 1;
    }
    // the epsilon floor actually fired during the sweep — and never above
    // the ceiling
    expect(explorations).toBeGreaterThan(0);
    expect(explorations).toBeLessThan(100);
  });
});
