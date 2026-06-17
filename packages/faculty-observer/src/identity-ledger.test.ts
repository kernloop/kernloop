/**
 * The per-MODEL-CALL identity fitness series (#66, CLM-0125): an ADDITIVE
 * series keyed on the normalized ModelIdentity tuple `(provider, family,
 * generation, tier)`, written by `ingestModelFitness` — distinct from and never
 * touching the subject-keyed `observer_fitness` ledger.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Cost, ModelIdentity, Outcome } from '@kernloop/contracts';
import { createObserver, InvalidModelFitnessError, type Observer } from './index.js';

const tmpDirs: string[] = [];
function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernloop-observer-id-'));
  tmpDirs.push(dir);
  return path.join(dir, 'overlay.sqlite');
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Observer with a deterministic ms clock advancing by 1 per write. */
function observerWithTicker(): Observer {
  let now = 1000;
  return createObserver(tmpDb(), { clock: () => ++now });
}

/** A catalogued claude identity; `over` bumps fields (e.g. a generation jump). */
function identity(over: Partial<ModelIdentity> = {}): ModelIdentity {
  return {
    provider: 'anthropic',
    family: 'claude-opus',
    generation: '3.5',
    variant: null,
    tier: 'large',
    raw: 'claude-3-5-opus',
    resolvedBy: 'table',
    contextWindow: 200000,
    inputCostPerMTok: 15,
    outputCostPerMTok: 75,
    ...over,
  };
}

const COST: Cost = { tokens: 100, usd: 0.5, wallClockMs: 1000 };

function makeOutcome(): Outcome {
  return {
    taskId: 'task-1',
    status: 'success',
    signals: [],
    cost: { tokens: 10, usd: 0.1 },
    traceRef: 'trace://task-1',
    distillCandidates: [],
  };
}

describe('ingestModelFitness — additive per-model-call identity series (#66, CLM-0125)', () => {
  it('two distinct served aliases that normalize to the SAME tuple accumulate ONE row', () => {
    const observer = observerWithTicker();
    // Same (provider, family, generation, tier) — different `raw` alias/variant.
    observer.ingestModelFitness(identity({ raw: 'opus' }), true, COST);
    observer.ingestModelFitness(identity({ raw: 'claude-opus-latest' }), false, {
      tokens: 0,
      usd: 0,
      wallClockMs: 0,
    });
    const ledger = observer.identityFitnessLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      key: { provider: 'anthropic', family: 'claude-opus', generation: '3.5', tier: 'large' },
      invocations: 2,
      successRate: 0.5,
      cost: { tokens: 100, usd: 0.5, wallClockMs: 1000 },
    });
    observer.close();
  });

  it('a generation bump is recorded as two DISTINCT rows, each keeping its own series', () => {
    const observer = observerWithTicker();
    // Two calls on the OLD generation, one on the NEW — same family/tier.
    observer.ingestModelFitness(identity({ generation: '3.5' }), true, COST);
    observer.ingestModelFitness(identity({ generation: '3.5' }), true, COST);
    observer.ingestModelFitness(identity({ generation: '4.8' }), true, COST);
    const old = observer.fitnessForIdentity({
      provider: 'anthropic',
      family: 'claude-opus',
      generation: '3.5',
      tier: 'large',
    });
    const next = observer.fitnessForIdentity({
      provider: 'anthropic',
      family: 'claude-opus',
      generation: '4.8',
      tier: 'large',
    });
    // They do NOT merge: each generation keeps its own series (transfer is the
    // ROUTER later reading the matching-class row; at the ledger level the same
    // class shares a row and a different generation is a distinct row).
    expect(old?.invocations).toBe(2);
    expect(next?.invocations).toBe(1);
    expect(observer.identityFitnessLedger()).toHaveLength(2);
    observer.close();
  });

  it('an `unknown` identity never merges into a named class row', () => {
    const observer = observerWithTicker();
    observer.ingestModelFitness(identity(), true, COST);
    // The honest unknown bucket: family/generation/tier from servedIdentity's
    // unknown default — never invented as a named class.
    const unknown = identity({
      provider: 'unknown',
      family: 'unknown',
      generation: '0',
      tier: 'small',
      raw: '',
      resolvedBy: 'unknown',
      contextWindow: null,
      inputCostPerMTok: null,
      outputCostPerMTok: null,
    });
    observer.ingestModelFitness(unknown, false, { tokens: 0, usd: 0, wallClockMs: 0 });
    const named = observer.fitnessForIdentity({
      provider: 'anthropic',
      family: 'claude-opus',
      generation: '3.5',
      tier: 'large',
    });
    const bucket = observer.fitnessForIdentity({
      provider: 'unknown',
      family: 'unknown',
      generation: '0',
      tier: 'small',
    });
    expect(named?.invocations).toBe(1);
    expect(bucket?.invocations).toBe(1);
    expect(observer.identityFitnessLedger()).toHaveLength(2);
    observer.close();
  });

  it('leaves the subject-keyed observer_fitness UNTOUCHED (writes only the identity table)', () => {
    const observer = observerWithTicker();
    // The subject-keyed ledger still works on its own.
    observer.ingestOutcome(makeOutcome(), { subject: 'manifest-x' });
    expect(observer.fitness('manifest-x')?.invocations).toBe(1);
    // ingestModelFitness writes ONLY the identity series, not the subject ledger.
    observer.ingestModelFitness(identity(), true, COST);
    expect(observer.fitnessLedger()).toHaveLength(1); // still just manifest-x
    expect(observer.fitness('manifest-x')?.invocations).toBe(1); // unchanged
    expect(observer.identityFitnessLedger()).toHaveLength(1); // the new series
    observer.close();
  });

  it('rejects an invalid identity or cost at the boundary (typed error)', () => {
    const observer = observerWithTicker();
    const bad = { ...identity(), tier: 'gigantic' } as unknown as ModelIdentity;
    expect(() => observer.ingestModelFitness(bad, true, COST)).toThrow(InvalidModelFitnessError);
    const badCost = { tokens: -1, usd: 0 } as unknown as Cost;
    expect(() => observer.ingestModelFitness(identity(), true, badCost)).toThrow(
      InvalidModelFitnessError,
    );
    observer.close();
  });
});
