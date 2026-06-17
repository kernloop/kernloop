/**
 * Composition-root wiring tests for live identity-fitness routing (#229 item 2,
 * CLM-0128) — the conditions that live ONLY in routePriors/predictIdentity:
 * the opt-in gate (condition 1), the per-candidate provenance audit event
 * (condition 5), `name@version` key alignment with the seeded baseline + Router,
 * and the predict-identity degradation paths (no model / endpoint adapter).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Manifest } from '@kernloop/contracts';
import { createKernloop, type Kernloop } from '../kernel.js';
import { resolveServed, servedIdentity } from '../loop/node-seam.js';
import { readEnvelopes } from './audit.js';
import { routePriors } from './live-fitness-wiring.js';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function freshKernloop(overlayYaml?: string): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-livefit-wiring-'));
  dirs.push(repo);
  const overlayDir = path.join(repo, '.kernloop');
  mkdirSync(overlayDir, { recursive: true });
  if (overlayYaml !== undefined) {
    writeFileSync(path.join(overlayDir, 'overlay.yaml'), overlayYaml, 'utf8');
  }
  return createKernloop({ overlayDir, rng: () => 0.99 });
}

function manifest(name: string, capability: string, withModel: boolean): Manifest {
  return {
    name,
    version: '1.0.0',
    kind: 'faculty',
    capabilities: [{ name: capability }],
    contracts: { consumes: ['TaskContract'], emits: ['Outcome'] },
    cost: { tokens: 1000, usd: 0.5, latencyMs: 100 },
    tier: 'suggest',
    claims: [],
    maturity: 'experimental',
    ...(withModel ? { model: { tier: 'large', effort: 'medium', capabilities: [] } } : {}),
  };
}

function liveEvents(kern: Kernloop): ReturnType<typeof readEnvelopes> {
  return readEnvelopes(kern.paths.audit).filter((e) => e.type === 'cli.router.live-fitness');
}

describe('routePriors — opt-in gate (condition 1)', () => {
  it('with liveFitness OFF, emits no live-fitness event and returns the (empty) seeded fragment', () => {
    const kern = freshKernloop(); // defaults: seedPriors false, liveFitness false
    kern.registry.register(manifest('m-off', 'cap.off', true));
    const frag = routePriors(kern, 'cap.off', 'claude', 'task-off');
    expect(frag.fitnessPriors).toBeUndefined(); // no priors.yaml, no live
    expect(liveEvents(kern)).toHaveLength(0);
  });
});

describe('routePriors — live override, provenance, key alignment (conditions 2/5)', () => {
  it('keys the live override on name@version and audits live-exact provenance', () => {
    const kern = freshKernloop('id: t\nrouter:\n  liveFitness: true\n');
    kern.registry.register(manifest('m-live', 'cap.live', true));
    // Seed the identity ledger for the class (large,claude) resolves to.
    const id = servedIdentity(
      resolveServed({ tier: 'large', effort: 'medium', capabilities: [] }, 'claude'),
    );
    for (let i = 0; i < 8; i++)
      kern.observer.ingestModelFitness(id, true, { tokens: 0, usd: 0, wallClockMs: 0 });

    const frag = routePriors(kern, 'cap.live', 'claude', 'task-live');
    // The override is keyed name@version (the Router's primary lookup key).
    expect(frag.fitnessPriors?.get('m-live@1.0.0')).toBeGreaterThan(0.7);

    const events = liveEvents(kern);
    expect(events).toHaveLength(1);
    const decisions = (events[0]?.payload as { decisions: { subject: string; source: string }[] })
      .decisions;
    const d = decisions.find((x) => x.subject === 'm-live@1.0.0');
    expect(d?.source).toBe('live-exact');
  });

  it('degrades a candidate with NO model requirement to a neutral decision', () => {
    const kern = freshKernloop('id: t\nrouter:\n  liveFitness: true\n');
    kern.registry.register(manifest('m-nomodel', 'cap.nomodel', false));
    routePriors(kern, 'cap.nomodel', 'claude', 'task-nm');
    const decisions = (
      liveEvents(kern)[0]?.payload as { decisions: { subject: string; source: string }[] }
    ).decisions;
    expect(decisions.find((x) => x.subject === 'm-nomodel@1.0.0')?.source).toBe('neutral');
  });
});
