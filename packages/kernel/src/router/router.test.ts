/**
 * Router suite (spec §3.1): capability/budget/tier eligibility matrices,
 * fitness-prior selection with deterministic tiebreaks, plan-only purity,
 * typed errors, and audit-event assertions [CLM-0026, CLM-0027]. The
 * exploration floor has its own suite (exploration.test.ts) [CLM-0028].
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Manifest, TaskContract } from '@kernloop/contracts';
import { createAuditStore, verifyChain, type AuditStore } from '../audit/index.js';
import type { AuditEnvelope } from '../audit/index.js';
import { Ladder } from '../ladder/index.js';
import { ManifestRegistry } from '../registry/index.js';
import { Router, RouterError } from './router.js';

let dir: string;
let store: AuditStore;
let registry: ManifestRegistry;
let ladder: Ladder;
let router: Router;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-router-'));
  store = createAuditStore(join(dir, 'audit.jsonl'), {
    clock: () => new Date('2026-06-09T00:00:00.000Z'),
  });
  registry = new ManifestRegistry(store);
  ladder = new Ladder(store);
  // rng pinned above epsilon: this suite always exercises exploitation.
  router = new Router({ registry, ladder, store, rng: () => 0.99 });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

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
    id: 'task-1',
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

function auditEvents(): AuditEnvelope[] {
  let text = '';
  try {
    text = readFileSync(store.filePath, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AuditEnvelope);
}

describe('capability and budget matching [CLM-0026]', () => {
  it('matches a task to a manifest by capability and returns the routing decision without executing', () => {
    manifest('alpha');
    manifest('other', { capabilities: [{ name: 'unrelated' }] });
    const decision = router.route({
      task: task(),
      capability: 'compile-brief',
      requiredTier: 'suggest',
    });
    expect(decision.selected?.name).toBe('alpha');
    expect(decision.candidates).toHaveLength(1);
    expect(decision.candidates[0]).toMatchObject({ eligible: true, reasons: [] });
    expect(decision.explored).toBe(false);
  });

  it('filters out a manifest whose expected token cost exceeds the task token budget', () => {
    manifest('alpha', { cost: { tokens: 999_999, usd: 0.5, latencyMs: 100 } });
    manifest('beta');
    const decision = router.route({
      task: task(),
      capability: 'compile-brief',
      requiredTier: 'suggest',
    });
    expect(decision.selected?.name).toBe('beta');
    const alpha = decision.candidates.find((c) => c.manifest.name === 'alpha');
    expect(alpha).toMatchObject({ eligible: false, reasons: ['over_token_budget'] });
  });

  it('filters out a manifest whose expected usd cost exceeds the task usd budget', () => {
    manifest('alpha', { cost: { tokens: 1000, usd: 99, latencyMs: 100 } });
    manifest('beta');
    const decision = router.route({
      task: task(),
      capability: 'compile-brief',
      requiredTier: 'suggest',
    });
    expect(decision.selected?.name).toBe('beta');
    const alpha = decision.candidates.find((c) => c.manifest.name === 'alpha');
    expect(alpha).toMatchObject({ eligible: false, reasons: ['over_usd_budget'] });
  });

  it('returns selected null with per-candidate reasons when no candidate is eligible', () => {
    manifest('alpha', { cost: { tokens: 999_999, usd: 99, latencyMs: 100 } });
    const decision = router.route({
      task: task(),
      capability: 'compile-brief',
      requiredTier: 'suggest',
    });
    expect(decision.selected).toBeNull();
    expect(decision.explored).toBe(false);
    expect(decision.candidates[0]?.reasons).toEqual(['over_token_budget', 'over_usd_budget']);
  });

  it('throws a typed unknown_capability error when no registered manifest declares the capability', () => {
    manifest('alpha');
    expect(() =>
      router.route({ task: task(), capability: 'no-such-capability', requiredTier: 'suggest' }),
    ).toThrowError(
      expect.objectContaining({ name: 'RouterError', code: 'unknown_capability' }) as Error,
    );
    expect(() =>
      router.route({ task: task(), capability: 'no-such-capability', requiredTier: 'suggest' }),
    ).toThrowError(RouterError);
  });

  it('plan-only routing mutates no kernel state: only the audit log grows', () => {
    manifest('alpha');
    manifest('beta');
    const request = task();
    const frozenTask = structuredClone(request);
    const registryBefore = structuredClone(registry.list());
    const eventsBefore = auditEvents().length;
    const decision = router.route({
      task: request,
      capability: 'compile-brief',
      requiredTier: 'suggest',
      execute: false,
    });
    expect(decision.selected).not.toBeNull();
    expect(request).toEqual(frozenTask);
    expect(registry.list()).toEqual(registryBefore);
    expect(auditEvents().length).toBeGreaterThan(eventsBefore);
  });
});

describe('authority tier enforcement [CLM-0027]', () => {
  it('never routes to a manifest whose tier exceeds the task authorityCeiling', () => {
    // The ladder alone would allow this action (required ≤ actor, required
    // ≤ ceiling); the router-level ceiling rule still excludes the manifest.
    manifest('alpha', { tier: 'enforce' });
    const decision = router.route({
      task: task({ authorityCeiling: 'suggest' }),
      capability: 'compile-brief',
      requiredTier: 'suggest',
    });
    expect(decision.selected).toBeNull();
    expect(decision.candidates[0]?.reasons).toEqual(['tier_exceeds_authority_ceiling']);
  });

  it('excludes a manifest whose tier is below the required tier via the ladder check', () => {
    manifest('alpha', { tier: 'suggest' });
    const decision = router.route({
      task: task(),
      capability: 'compile-brief',
      requiredTier: 'enforce',
    });
    expect(decision.selected).toBeNull();
    expect(decision.candidates[0]?.reasons).toEqual(['ladder_exceeds_actor_tier']);
  });

  it('reports the ladder ceiling denial when the required tier exceeds the authorityCeiling', () => {
    manifest('alpha', { tier: 'enforce' });
    const decision = router.route({
      task: task({ authorityCeiling: 'advisory' }),
      capability: 'compile-brief',
      requiredTier: 'enforce',
    });
    expect(decision.selected).toBeNull();
    expect(decision.candidates[0]?.reasons).toEqual([
      'tier_exceeds_authority_ceiling',
      'ladder_exceeds_authority_ceiling',
    ]);
  });
});

describe('fitness-prior selection', () => {
  it('selects the highest fitness prior among eligible candidates', () => {
    manifest('alpha');
    manifest('beta');
    const decision = router.route({
      task: task(),
      capability: 'compile-brief',
      requiredTier: 'suggest',
      fitnessPriors: new Map([
        ['alpha', 0.2],
        ['beta', 0.9],
      ]),
    });
    expect(decision.selected?.name).toBe('beta');
  });

  it('treats a manifest with no recorded prior as the neutral 0.5', () => {
    manifest('alpha');
    manifest('beta');
    const lowKnown = router.route({
      task: task(),
      capability: 'compile-brief',
      requiredTier: 'suggest',
      fitnessPriors: new Map([['alpha', 0.2]]),
    });
    expect(lowKnown.selected?.name).toBe('beta'); // unknown 0.5 beats 0.2
    const highKnown = router.route({
      task: task(),
      capability: 'compile-brief',
      requiredTier: 'suggest',
      fitnessPriors: new Map([['alpha', 0.9]]),
    });
    expect(highKnown.selected?.name).toBe('alpha'); // 0.9 beats unknown 0.5
  });

  it('breaks fitness ties deterministically by name', () => {
    manifest('gamma');
    manifest('alpha');
    manifest('beta');
    for (let i = 0; i < 5; i += 1) {
      const decision = router.route({
        task: task(),
        capability: 'compile-brief',
        requiredTier: 'suggest',
      });
      expect(decision.selected?.name).toBe('alpha');
    }
  });

  it('prefers an exact name@version prior over the name-level prior', () => {
    manifest('alpha');
    manifest('alpha', { version: '2.0.0' });
    const decision = router.route({
      task: task(),
      capability: 'compile-brief',
      requiredTier: 'suggest',
      fitnessPriors: new Map([
        ['alpha', 0.1],
        ['alpha@2.0.0', 0.9],
      ]),
    });
    expect(decision.selected?.version).toBe('2.0.0');
  });
});

describe('audit [CLM-0026]', () => {
  it('appends a route audit event with identity facts only, and the chain verifies', () => {
    manifest('alpha');
    manifest('beta', { cost: { tokens: 999_999, usd: 0.5, latencyMs: 100 } });
    router.route({ task: task(), capability: 'compile-brief', requiredTier: 'suggest' });
    const routeEvents = auditEvents().filter((e) => e.type === 'kernel.router.route');
    expect(routeEvents).toHaveLength(1);
    expect(routeEvents[0]?.payload).toEqual({
      task: 'task-1',
      capability: 'compile-brief',
      requiredTier: 'suggest',
      execute: false,
      selected: 'alpha@1.0.0',
      explored: false,
      candidateCount: 2,
      eligibleCount: 1,
      outcome: 'routed',
    });
    // every candidate evaluation runs through the audited ladder check
    expect(auditEvents().filter((e) => e.type === 'kernel.ladder.check')).toHaveLength(2);
    expect(verifyChain(store).ok).toBe(true);
  });

  it('audits the unknown_capability outcome before throwing', () => {
    expect(() =>
      router.route({ task: task(), capability: 'ghost', requiredTier: 'suggest' }),
    ).toThrowError(RouterError);
    const last = auditEvents().at(-1);
    expect(last?.type).toBe('kernel.router.route');
    expect(last?.payload).toMatchObject({
      capability: 'ghost',
      selected: null,
      candidateCount: 0,
      outcome: 'unknown_capability',
    });
    expect(verifyChain(store).ok).toBe(true);
  });

  it('audits a no_eligible_candidate outcome with selected null', () => {
    manifest('alpha', { cost: { tokens: 999_999, usd: 0.5, latencyMs: 100 } });
    router.route({ task: task(), capability: 'compile-brief', requiredTier: 'suggest' });
    const last = auditEvents().at(-1);
    expect(last?.payload).toMatchObject({
      selected: null,
      eligibleCount: 0,
      outcome: 'no_eligible_candidate',
    });
  });
});
