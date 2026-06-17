/**
 * Influence / honesty tests for priors seeding (CLM-0126) — the load-bearing
 * proof that the seeded priors ACTUALLY change routing, not merely that the
 * loader ran. Two manifests serve one capability; a reviewed priors.yaml
 * favoring B flips the selection to B; with the file absent (or the opt-in off)
 * the deterministic tiebreak picks A. Also: key alignment (`name@version`
 * lookup), bias-not-eliminate (an unseen subject stays selectable), and the
 * opt-out (a present file with seedPriors:false → no audit event, no influence).
 *
 * The Router is NOT modified — these tests exercise its existing
 * `fitnessPriors` path (CLM-0028) through the run composition root.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '@kernloop/contracts';
import YAML from 'yaml';
import { createKernloop, type Kernloop } from '../kernel.js';
import { readEnvelopes } from './audit.js';
import { runTool } from './run.js';

const dirs: string[] = [];

/** A kern whose rng never explores (0.99 ≥ epsilon), so the PRIOR decides. */
function freshKernloop(overlayYaml?: string): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-seed-influence-'));
  dirs.push(repo);
  const overlayDir = path.join(repo, '.kernloop');
  mkdirSync(overlayDir, { recursive: true });
  if (overlayYaml !== undefined) {
    writeFileSync(path.join(overlayDir, 'overlay.yaml'), overlayYaml, 'utf8');
  }
  return createKernloop({ overlayDir, rng: () => 0.99 });
}

/** Write a priors.yaml into the kern's overlay (the path the loader reads). */
function writePriors(kern: Kernloop, priors: unknown[]): void {
  writeFileSync(kern.paths.priors, YAML.stringify({ version: '1', priors }), 'utf8');
}

/** Register a faculty manifest serving `cap.flip` under `name@version`. */
function manifest(name: string, version: string): Manifest {
  return {
    name,
    version,
    kind: 'faculty',
    capabilities: [{ name: 'cap.flip' }],
    contracts: { consumes: ['TaskContract'], emits: ['Outcome'] },
    cost: { tokens: 1000, usd: 0.5, latencyMs: 100 },
    tier: 'suggest',
    claims: [],
    maturity: 'experimental',
  };
}

/** Register two competing manifests A and B for the same capability. */
function registerAB(kern: Kernloop): void {
  kern.registry.register(manifest('aaa-cap', '1.0.0'));
  kern.registry.register(manifest('zzz-cap', '1.0.0'));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('priors seeding influence (CLM-0126)', () => {
  it('RANKING FLIP: with seedPriors:true and a priors.yaml favoring B, route() selects B', async () => {
    const kern = freshKernloop('id: t\nrouter:\n  seedPriors: true\n');
    registerAB(kern);
    // Favor B (zzz-cap) heavily; A (aaa-cap) absent → neutral. Deep sample so
    // the Laplace score stays high (49/50 → 0.962), clearly above neutral 0.5.
    writePriors(kern, [
      { subject: 'zzz-cap@1.0.0', invocations: 50, successRate: 0.98, lastUsedAt: Date.now() },
    ]);
    const result = await runTool(kern, {
      goal: 'route the flip capability',
      capability: 'cap.flip',
      id: 'flip-seeded',
      execute: false,
    });
    expect(result.kind).toBe('routing');
    if (result.kind !== 'routing') throw new Error('expected routing');
    expect(result.decision.selected).toBe('zzz-cap@1.0.0'); // B wins via the prior
    kern.close();
  });

  it('RANKING FLIP baseline: with the file ABSENT, the deterministic tiebreak selects A', async () => {
    const kern = freshKernloop('id: t\nrouter:\n  seedPriors: true\n');
    registerAB(kern);
    // No priors.yaml written → loader returns null → neutral priors → the
    // name-ascending tiebreak picks aaa-cap. Proves the flip was the prior.
    const result = await runTool(kern, {
      goal: 'route the flip capability',
      capability: 'cap.flip',
      id: 'flip-absent',
      execute: false,
    });
    if (result.kind !== 'routing') throw new Error('expected routing');
    expect(result.decision.selected).toBe('aaa-cap@1.0.0'); // A is the default
    // No file → no audit event.
    const seeded = readEnvelopes(kern.paths.audit).filter(
      (e) => e.type === 'cli.router.priors-seeded',
    );
    expect(seeded).toHaveLength(0);
    kern.close();
  });

  it('KEY ALIGNMENT: a seeded prior for `zzz-cap@1.0.0` applies to the matching manifest', async () => {
    const kern = freshKernloop('id: t\nrouter:\n  seedPriors: true\n');
    registerAB(kern);
    writePriors(kern, [
      { subject: 'zzz-cap@1.0.0', invocations: 30, successRate: 0.95, lastUsedAt: Date.now() },
    ]);
    const result = await runTool(kern, {
      goal: 'route',
      capability: 'cap.flip',
      id: 'flip-key',
      execute: false,
    });
    if (result.kind !== 'routing') throw new Error('expected routing');
    // The export `subject` is the Router's exact `name@version` lookup key —
    // a mismatch here would mean the export↔seed loop is fiction.
    expect(result.decision.selected).toBe('zzz-cap@1.0.0');
    const seeded = readEnvelopes(kern.paths.audit).filter(
      (e) => e.type === 'cli.router.priors-seeded',
    )[0];
    const payload = seeded?.payload as { scores: { subject: string }[]; sha256: string };
    expect(payload.scores.map((s) => s.subject)).toContain('zzz-cap@1.0.0');
    expect(payload.sha256).toMatch(/^[0-9a-f]{64}$/);
    kern.close();
  });

  it('BIAS NOT ELIMINATE: an UNSEEN subject (absent from priors.yaml) is still selectable', async () => {
    const kern = freshKernloop('id: t\nrouter:\n  seedPriors: true\n');
    // Only A is registered; the priors.yaml seeds an UNRELATED subject. A has
    // no prior (neutral) yet must still be the selected, eligible candidate —
    // the neutral fallback keeps an unseen subject in play (CLM-0028 intact).
    kern.registry.register(manifest('aaa-cap', '1.0.0'));
    writePriors(kern, [
      {
        subject: 'some-other-thing@9.9.9',
        invocations: 40,
        successRate: 0.99,
        lastUsedAt: Date.now(),
      },
    ]);
    const result = await runTool(kern, {
      goal: 'route',
      capability: 'cap.flip',
      id: 'flip-unseen',
      execute: false,
    });
    if (result.kind !== 'routing') throw new Error('expected routing');
    expect(result.decision.selected).toBe('aaa-cap@1.0.0'); // unseen → still selected
    kern.close();
  });

  it('STALE: an old priors.yaml still seeds, but warns and records stale:true in the audit event', async () => {
    const kern = freshKernloop('id: t\nrouter:\n  seedPriors: true\n');
    registerAB(kern);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // lastUsedAt ~ 60 days ago, well past the 30-day staleness threshold.
    writePriors(kern, [
      {
        subject: 'zzz-cap@1.0.0',
        invocations: 40,
        successRate: 0.98,
        lastUsedAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
      },
    ]);
    const result = await runTool(kern, {
      goal: 'route',
      capability: 'cap.flip',
      id: 'flip-stale',
      execute: false,
    });
    if (result.kind !== 'routing') throw new Error('expected routing');
    expect(result.decision.selected).toBe('zzz-cap@1.0.0'); // stale still influences
    expect(warn).toHaveBeenCalled();
    const seeded = readEnvelopes(kern.paths.audit).filter(
      (e) => e.type === 'cli.router.priors-seeded',
    )[0];
    expect((seeded?.payload as { stale: boolean }).stale).toBe(true);
    kern.close();
  });

  it('OPT-OUT: seedPriors:false with a present file → no audit event, routing identical to no-file', async () => {
    const kern = freshKernloop('id: t\nrouter:\n  seedPriors: false\n');
    registerAB(kern);
    // The file FAVORS B, but the opt-in is off, so it must be ignored entirely.
    writePriors(kern, [
      { subject: 'zzz-cap@1.0.0', invocations: 50, successRate: 0.99, lastUsedAt: Date.now() },
    ]);
    const result = await runTool(kern, {
      goal: 'route',
      capability: 'cap.flip',
      id: 'flip-optout',
      execute: false,
    });
    if (result.kind !== 'routing') throw new Error('expected routing');
    expect(result.decision.selected).toBe('aaa-cap@1.0.0'); // identical to no-file
    const seeded = readEnvelopes(kern.paths.audit).filter(
      (e) => e.type === 'cli.router.priors-seeded',
    );
    expect(seeded).toHaveLength(0); // opt-out → no audit event
    kern.close();
  });
});
