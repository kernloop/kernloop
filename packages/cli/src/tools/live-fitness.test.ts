/**
 * Live identity-fitness priors suite (#229 item 2, CLM-0128). Covers the six
 * binding conditions of the 6/7 ratification: exact-generation strict override
 * past the min-sample threshold, the bootstrap-only generation-agnostic class
 * aggregate (the cross-version TRANSFER property), recency decay, seeded-baseline
 * precedence, malformed-row drop (security), bounded score clamps, and the
 * load-bearing MULTI-CANDIDATE FLIP test proving the prior actually changes the
 * kernel Router's selection (the non-inertness proof the vote required).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Manifest, ModelIdentity, ModelTier, TaskContract } from '@kernloop/contracts';
import type { IdentityFitnessRecord } from '@kernloop/faculty-observer';
import {
  Ladder,
  ManifestRegistry,
  Router,
  createAuditStore,
  type AuditStore,
} from '@kernloop/kernel';
import { laplaceScore } from './priors-seed.js';
import {
  DEFAULT_LIVE_FITNESS_CONFIG,
  liveFitnessPriors,
  type CandidateIdentity,
} from './live-fitness.js';

const NOW = 1_700_000_000_000;

function identity(
  provider: string,
  family: string,
  generation: string,
  tier: ModelTier,
): ModelIdentity {
  return {
    provider,
    family,
    generation,
    variant: null,
    tier,
    raw: `${family}-${generation}`,
    resolvedBy: 'table',
    contextWindow: null,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
  };
}

function row(
  provider: string,
  family: string,
  generation: string,
  tier: string,
  invocations: number,
  successRate: number,
  lastUsedAt = NOW,
): IdentityFitnessRecord {
  return {
    key: { provider, family, generation, tier },
    invocations,
    successRate,
    cost: { tokens: 0, usd: 0, wallClockMs: 0 },
    lastUsedAt,
  };
}

const opus49 = identity('anthropic', 'claude-opus', '4.9', 'large');

describe('liveFitnessPriors — exact-generation override (condition 3)', () => {
  it('uses the exact (provider,family,generation,tier) score once it crosses minSampleExact', () => {
    const ledger = [row('anthropic', 'claude-opus', '4.9', 'large', 10, 0.9)];
    const { map, decisions } = liveFitnessPriors(
      [{ subject: 'coder', identity: opus49 }],
      ledger,
      new Map(),
      NOW,
    );
    expect(decisions[0]?.source).toBe('live-exact');
    expect(map.get('coder')).toBeCloseTo(laplaceScore(0.9, 10), 10);
    expect(decisions[0]?.exactSamples).toBe(10);
  });

  it('does NOT take a below-threshold exact row alone — it falls through to the class aggregate', () => {
    // 4.9 has only 2 calls (< minSampleExact 5); 4.8 has plenty → transfer.
    const ledger = [
      row('anthropic', 'claude-opus', '4.9', 'large', 2, 1.0),
      row('anthropic', 'claude-opus', '4.8', 'large', 30, 0.93),
    ];
    const { decisions } = liveFitnessPriors(
      [{ subject: 'coder', identity: opus49 }],
      ledger,
      new Map(),
      NOW,
    );
    expect(decisions[0]?.source).toBe('live-class-fallback');
  });
});

describe('liveFitnessPriors — generation-agnostic TRANSFER (condition 3, the keystone)', () => {
  it('bootstraps a brand-new generation from the (provider,family,tier) aggregate of older generations', () => {
    // No 4.9 row at all; 4.8 accumulated strong fitness. The new 4.9 candidate
    // inherits it via the class aggregate — learning transfers across the bump.
    const ledger = [row('anthropic', 'claude-opus', '4.8', 'large', 40, 0.95)];
    const { map, decisions } = liveFitnessPriors(
      [{ subject: 'coder', identity: opus49 }],
      ledger,
      new Map(),
      NOW,
    );
    expect(decisions[0]?.source).toBe('live-class-fallback');
    expect(decisions[0]?.classSamples).toBeGreaterThanOrEqual(
      DEFAULT_LIVE_FITNESS_CONFIG.minSampleClass,
    );
    expect(map.get('coder')).toBeGreaterThan(0.8); // strong 4.8 history carried over
  });

  it('NEVER mixes providers — a same-family class on another provider does not transfer', () => {
    const ledger = [row('other', 'claude-opus', '4.8', 'large', 40, 0.99)];
    const { decisions } = liveFitnessPriors(
      [{ subject: 'coder', identity: opus49 }],
      ledger,
      new Map(),
      NOW,
    );
    expect(decisions[0]?.source).toBe('neutral'); // provider-scoped: no cross-provider arithmetic
  });
});

describe('liveFitnessPriors — recency decay (condition 3)', () => {
  it('decays an old class aggregate below the usable threshold so a stale class degrades to neutral', () => {
    // 12 raw calls, but ~10 half-lives old → decayed effective sample << minSampleClass.
    const old = NOW - 10 * DEFAULT_LIVE_FITNESS_CONFIG.halfLifeMs;
    const ledger = [row('anthropic', 'claude-opus', '4.8', 'large', 12, 0.95, old)];
    const { decisions } = liveFitnessPriors(
      [{ subject: 'coder', identity: opus49 }],
      ledger,
      new Map(),
      NOW,
    );
    expect(decisions[0]?.source).toBe('neutral');
    expect(decisions[0]?.classSamples).toBeLessThan(DEFAULT_LIVE_FITNESS_CONFIG.minSampleClass);
  });
});

describe('liveFitnessPriors — seeded baseline precedence (condition 2)', () => {
  it('keeps the seeded score when live data is insufficient', () => {
    const baseline = new Map([['coder', 0.72]]);
    const { map, decisions } = liveFitnessPriors(
      [{ subject: 'coder', identity: opus49 }],
      [], // no live data
      baseline,
      NOW,
    );
    expect(decisions[0]?.source).toBe('seeded-file');
    expect(map.get('coder')).toBe(0.72);
  });

  it('OVERRIDES the seeded score when the live class has sufficient data', () => {
    const baseline = new Map([['coder', 0.72]]);
    const ledger = [row('anthropic', 'claude-opus', '4.9', 'large', 20, 0.4)];
    const { map, decisions } = liveFitnessPriors(
      [{ subject: 'coder', identity: opus49 }],
      ledger,
      baseline,
      NOW,
    );
    expect(decisions[0]?.source).toBe('live-exact');
    expect(map.get('coder')).toBeCloseTo(laplaceScore(0.4, 20), 10);
    expect(map.get('coder')).not.toBe(0.72);
  });
});

describe('liveFitnessPriors — degradation & security (conditions 5/6)', () => {
  it('degrades a null/unknown identity to the baseline, never inventing a class', () => {
    const nullId = liveFitnessPriors([{ subject: 'x', identity: null }], [], new Map(), NOW);
    expect(nullId.decisions[0]?.source).toBe('neutral');
    const unknownId = identity('unknown', 'unknown', 'unknown', 'small');
    const unk = liveFitnessPriors([{ subject: 'x', identity: unknownId }], [], new Map(), NOW);
    expect(unk.decisions[0]?.source).toBe('neutral');
  });

  it('drops a malformed ledger row (schema-invalid) and still uses the valid rows', () => {
    const ledger = [
      { key: { provider: 'anthropic' }, invocations: 'lots' }, // malformed → dropped
      row('anthropic', 'claude-opus', '4.8', 'large', 40, 0.95),
    ];
    const { decisions } = liveFitnessPriors(
      [{ subject: 'coder', identity: opus49 }],
      ledger,
      new Map(),
      NOW,
    );
    expect(decisions[0]?.source).toBe('live-class-fallback'); // valid row still counted
  });

  it('clamps live scores into the bounded-delta window (condition 4)', () => {
    const great = liveFitnessPriors(
      [{ subject: 'a', identity: opus49 }],
      [row('anthropic', 'claude-opus', '4.9', 'large', 500, 1.0)],
      new Map(),
      NOW,
    );
    const awful = liveFitnessPriors(
      [{ subject: 'b', identity: opus49 }],
      [row('anthropic', 'claude-opus', '4.9', 'large', 500, 0.0)],
      new Map(),
      NOW,
    );
    expect(great.map.get('a')).toBeLessThanOrEqual(DEFAULT_LIVE_FITNESS_CONFIG.scoreCeil);
    expect(awful.map.get('b')).toBeGreaterThanOrEqual(DEFAULT_LIVE_FITNESS_CONFIG.scoreFloor);
  });
});

describe('liveFitnessPriors — exact-override boundary & strictness (condition 3)', () => {
  const min = DEFAULT_LIVE_FITNESS_CONFIG.minSampleExact;

  it('takes the exact row at EXACTLY minSampleExact (inclusive boundary)', () => {
    const ledger = [row('anthropic', 'claude-opus', '4.9', 'large', min, 0.8)];
    const { decisions } = liveFitnessPriors(
      [{ subject: 'coder', identity: opus49 }],
      ledger,
      new Map(),
      NOW,
    );
    expect(decisions[0]?.source).toBe('live-exact');
  });

  it('STRICTLY overrides: a sufficient exact row wins over a divergent class aggregate', () => {
    // The exact 4.9 row (poor) must win over the strong 4.8-dominated class
    // aggregate — proving the override is observable, not just "uses the row".
    const ledger = [
      row('anthropic', 'claude-opus', '4.9', 'large', min, 0.1),
      row('anthropic', 'claude-opus', '4.8', 'large', 100, 0.99),
    ];
    const { map, decisions } = liveFitnessPriors(
      [{ subject: 'coder', identity: opus49 }],
      ledger,
      new Map(),
      NOW,
    );
    expect(decisions[0]?.source).toBe('live-exact');
    expect(map.get('coder')).toBeCloseTo(laplaceScore(0.1, min), 10); // the POOR exact value, not the strong class
    expect(map.get('coder')).toBeLessThan(0.5);
  });
});

describe('liveFitnessPriors — malformed-only class degrades to neutral (condition 6)', () => {
  it('a class whose ONLY row is malformed degrades to neutral, not a partial score', () => {
    const ledger = [{ key: { provider: 'anthropic', family: 'claude-opus' }, invocations: -3 }];
    const { decisions } = liveFitnessPriors(
      [{ subject: 'coder', identity: opus49 }],
      ledger,
      new Map(),
      NOW,
    );
    expect(decisions[0]?.source).toBe('neutral');
  });
});

describe('liveFitnessPriors — config is honored (not dead flexibility)', () => {
  it('a custom minSampleExact changes whether the exact row governs', () => {
    const ledger = [row('anthropic', 'claude-opus', '4.9', 'large', 3, 0.9)];
    const cand = [{ subject: 'coder', identity: opus49 }];
    // Default minSampleExact (5): 3 calls is below → not live-exact.
    expect(liveFitnessPriors(cand, ledger, new Map(), NOW).decisions[0]?.source).not.toBe(
      'live-exact',
    );
    // Lower the threshold to 3 → the same row now governs.
    const tuned = liveFitnessPriors(cand, ledger, new Map(), NOW, {
      ...DEFAULT_LIVE_FITNESS_CONFIG,
      minSampleExact: 3,
    });
    expect(tuned.decisions[0]?.source).toBe('live-exact');
  });
});

// ─── The load-bearing non-inertness proof: the prior CHANGES Router selection ───

let dir: string;
let store: AuditStore;
let registry: ManifestRegistry;
let ladder: Ladder;
let router: Router;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-livefit-'));
  store = createAuditStore(join(dir, 'audit.jsonl'), {
    clock: () => new Date('2026-06-17T00:00:00.000Z'),
  });
  registry = new ManifestRegistry(store);
  ladder = new Ladder(store);
  router = new Router({ registry, ladder, store, rng: () => 0.99 }); // exploit, no exploration
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function manifest(name: string): Manifest {
  return registry.register({
    name,
    version: '1.0.0',
    kind: 'faculty',
    capabilities: [{ name: 'cap' }],
    contracts: { consumes: ['TaskContract'], emits: ['Outcome'] },
    cost: { tokens: 1000, usd: 0.5, latencyMs: 100 },
    tier: 'suggest',
    claims: [],
    maturity: 'experimental',
  });
}

function task(): TaskContract {
  return {
    id: 'task-flip',
    goal: 'route among competing manifests',
    constraints: [],
    budget: { tokens: 10_000, usd: 5, wallClockMin: 30 },
    evidence: [],
    definitionOfDone: [],
    authorityCeiling: 'enforce',
    overlay: 'repo-overlay',
  };
}

describe('multi-candidate flip — live identity fitness changes the Router selection', () => {
  it('selects the manifest whose model CLASS has higher live fitness, and flips when fitness flips', () => {
    manifest('cap-a');
    manifest('cap-b');
    const idA = identity('anthropic', 'claude-opus', '4.9', 'large');
    const idB = identity('openai', 'gpt', '5.1', 'large');
    const candidates: CandidateIdentity[] = [
      { subject: 'cap-a', identity: idA },
      { subject: 'cap-b', identity: idB },
    ];

    // Round 1: class A strong, class B weak → A wins.
    const round1 = liveFitnessPriors(
      candidates,
      [
        row('anthropic', 'claude-opus', '4.9', 'large', 20, 0.95),
        row('openai', 'gpt', '5.1', 'large', 20, 0.25),
      ],
      new Map(),
      NOW,
    );
    const pick1 = router.route({
      task: task(),
      capability: 'cap',
      requiredTier: 'suggest',
      fitnessPriors: round1.map,
    });
    expect(pick1.selected?.name).toBe('cap-a');

    // Round 2: the classes' fitness FLIPS → B wins. Proof the seam is live.
    const round2 = liveFitnessPriors(
      candidates,
      [
        row('anthropic', 'claude-opus', '4.9', 'large', 20, 0.25),
        row('openai', 'gpt', '5.1', 'large', 20, 0.95),
      ],
      new Map(),
      NOW,
    );
    const pick2 = router.route({
      task: task(),
      capability: 'cap',
      requiredTier: 'suggest',
      fitnessPriors: round2.map,
    });
    expect(pick2.selected?.name).toBe('cap-b');
  });
});
