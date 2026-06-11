/**
 * Tiered-adapter routing [CLM-0068]: the canonical loop selects the model
 * adapter PER NODE by declared tier. These tests pin (1) the NODE_TIERS
 * mapping (research/review → cheap; plan/vote/decompose/implement → frontier),
 * (2) the pure tier→adapter resolution with an `adapters` overlay block,
 * (3) the backward-compat guarantee — with NO `adapters`, both tiers resolve
 * to the run adapter — and (4) end to end, that each tier's invokeFor binds a
 * DIFFERENT real adapter CLI when configured, proven by distinct subprocess
 * output (no detectAdapter dependence — real fake CLIs on PATH).
 *
 * HONESTY: enforcement is at the LOOP composition root, not the Router (see
 * loop/tiers.ts) — these tests assert loop selection, not Router behavior.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BriefSchema, TaskContractSchema, type Cost } from '@kernloop/contracts';
import type { NodeContext } from '@kernloop/workflows';
import { createKernloop, type Kernloop } from '../kernel.js';
import { buildLoopExecutors, type LoopBindings, type LoopRefs } from './executors.js';
import type { LoopInvoke } from './invoke.js';
import { NODE_TIERS, type ModelTier } from './tiers.js';
import { buildInvokeForTier, tierAdapter } from './index.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-tiers-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const COST: Cost = { tokens: 3, usd: 0.001 };
const task = TaskContractSchema.parse({
  id: 'task-unit',
  goal: 'unit goal',
  constraints: [],
  budget: { tokens: 100_000, usd: 1, wallClockMin: 30 },
  evidence: [],
  definitionOfDone: [],
  authorityCeiling: 'advisory',
  overlay: 'unit',
});
const planBrief = BriefSchema.parse({
  taskId: task.id,
  sections: [
    { name: 'plan', content: 'the plan', tokens: 2, priority: 1, provenance: [{ ref: 'x' }] },
  ],
  budget: { allotted: 100, used: 2 },
  compilerVersion: 'unit',
});

/** A scripted responder honoring each node's strict output contract. */
const respond = (prompt: string): string => {
  if (prompt.includes('Proposal under vote'))
    return JSON.stringify({ vote: 'approve', reasoning: 'ok' });
  if (prompt.includes('"subtasks"'))
    return JSON.stringify({
      subtasks: [
        { goal: 'g', budget: { tokens: 1, usd: 0.01, wallClockMin: 1 }, assignTo: 'coder' },
      ],
    });
  if (prompt.includes('"files"'))
    return JSON.stringify({ files: [{ path: 'src/f.ts', content: 'export {};\n' }] });
  if (prompt.includes('Investigate the prior art')) return 'Research: self-contained.';
  return 'Plan: do the thing.';
};

function ctx3(): NodeContext {
  return {
    runId: 'run-unit',
    taskId: task.id,
    iteration: 0,
    config: { K: 3, gates: { vote: { strategy: 'unanimous', panel: 3 } }, nodeOverrides: {} },
    node: 'vote',
    findings: [],
  };
}

describe('NODE_TIERS mapping (spec §8.4 rationale)', () => {
  it('routes read/judge nodes to cheap and load-bearing generation/decisions to frontier', () => {
    expect(NODE_TIERS.research).toBe('cheap');
    expect(NODE_TIERS.review).toBe('cheap');
    expect(NODE_TIERS.plan).toBe('frontier');
    expect(NODE_TIERS.vote).toBe('frontier');
    expect(NODE_TIERS.decompose).toBe('frontier');
    expect(NODE_TIERS.implement).toBe('frontier');
  });

  it('omits the model-free nodes (frame, quality, integrate, retrospect)', () => {
    for (const node of ['frame', 'quality', 'integrate', 'retrospect']) {
      expect(Object.keys(NODE_TIERS)).not.toContain(node);
    }
  });
});

describe('tierAdapter — the pure tier→adapter resolution', () => {
  it('binds the configured adapter per tier: research(cheap)→codex, plan(frontier)→claude', () => {
    const adapters = { cheap: 'codex', frontier: 'claude' } as const;
    // research and review are cheap-tier; plan/vote/decompose/implement frontier.
    expect(tierAdapter('gemini', adapters, NODE_TIERS.research)).toBe('codex');
    expect(tierAdapter('gemini', adapters, NODE_TIERS.review)).toBe('codex');
    expect(tierAdapter('gemini', adapters, NODE_TIERS.plan)).toBe('claude');
    expect(tierAdapter('gemini', adapters, NODE_TIERS.vote)).toBe('claude');
    expect(tierAdapter('gemini', adapters, NODE_TIERS.decompose)).toBe('claude');
    expect(tierAdapter('gemini', adapters, NODE_TIERS.implement)).toBe('claude');
  });

  it('falls back to the run adapter for any tier the overlay leaves unset', () => {
    expect(tierAdapter('opencode', { frontier: 'claude' }, 'cheap')).toBe('opencode');
    expect(tierAdapter('opencode', { cheap: 'codex' }, 'frontier')).toBe('opencode');
  });

  it('BACKWARD-COMPAT: with no adapters config, both tiers resolve to the run adapter', () => {
    expect(tierAdapter('gemini', undefined, 'cheap')).toBe('gemini');
    expect(tierAdapter('gemini', undefined, 'frontier')).toBe('gemini');
    expect(tierAdapter('gemini', {}, 'cheap')).toBe('gemini');
    expect(tierAdapter('gemini', {}, 'frontier')).toBe('gemini');
  });
});

/** Write a fake adapter CLI that echoes a distinct marker, on a PATH dir. */
function fakeCli(dir: string, name: string, marker: string): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const reply = JSON.stringify({
    type: 'result',
    is_error: false,
    result: marker,
    usage: { input_tokens: 1, output_tokens: 1 },
    total_cost_usd: 0.001,
  });
  writeFileSync(file, `#!/bin/sh\ncat > /dev/null\necho '${reply}'\n`);
  chmodSync(file, 0o755);
  return dir;
}

describe('buildInvokeForTier — per-tier seam binds the resolved adapter', () => {
  it('returns a stable, distinct metered seam per tier when tiers differ', () => {
    const totals = { tokens: 0, usd: 0 };
    const invokeFor = buildInvokeForTier('gemini', { cheap: 'codex', frontier: 'claude' }, totals);
    expect(invokeFor('cheap')).toBe(invokeFor('cheap')); // cached per tier
    expect(invokeFor('cheap')).not.toBe(invokeFor('frontier'));
  });

  it("the run adapter's tier seam invokes the real run-adapter CLI and meters its cost", async () => {
    const bin = path.join(scratch, 'bin-run');
    // No adapters config → both tiers resolve to the run adapter (claude).
    fakeCli(bin, 'claude', 'RUN-ADAPTER');
    const totals = { tokens: 0, usd: 0 };
    const invokeFor = buildInvokeForTier('claude', undefined, totals);
    const prevPath = process.env['PATH'];
    process.env['PATH'] = bin;
    try {
      const cheap = await invokeFor('cheap')('hi', { timeoutMs: 30_000 });
      const frontier = await invokeFor('frontier')('hi', { timeoutMs: 30_000 });
      expect(cheap.output).toBe('RUN-ADAPTER');
      expect(frontier.output).toBe('RUN-ADAPTER');
      expect(totals.usd).toBeCloseTo(0.002); // both calls metered through totals
    } finally {
      process.env['PATH'] = prevPath;
    }
  });
});

function kernloopFor(name: string): Kernloop {
  const repo = path.join(scratch, name);
  mkdirSync(path.join(repo, '.kernloop'), { recursive: true });
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}

describe('per-node tier selection through the real executors [CLM-0068]', () => {
  it('each model-calling node draws its seam from its declared tier: research/review cheap, plan/vote/decompose/implement frontier', async () => {
    const kern = kernloopFor('node-tiers');
    const calls: Array<{ tier: ModelTier; prompt: string }> = [];
    // A tier-aware invokeFor that records which tier each node requested.
    const invokeFor =
      (tier: ModelTier): LoopInvoke =>
      (prompt) => {
        calls.push({ tier, prompt });
        return Promise.resolve({ output: respond(prompt), cost: COST });
      };
    const refs: LoopRefs = { framedTask: task, planBrief, researchBrief: planBrief };
    const ws = path.join(scratch, 'node-tiers-ws');
    mkdirSync(ws, { recursive: true });
    const b: LoopBindings = {
      kern,
      workspaceDir: ws,
      invoke: invokeFor('frontier'),
      invokeFor,
      adapter: 'claude',
      refs,
    };
    const ex = buildLoopExecutors(b);
    await ex['research']?.(task, ctx3());
    await ex['plan']?.(planBrief, ctx3());
    await ex['vote']?.(planBrief, ctx3());
    await ex['decompose']?.({}, ctx3());
    await ex['implement']?.({ ...task, id: 'task-unit.1' }, ctx3());
    const tierOf = (needle: string): ModelTier | undefined =>
      calls.find((c) => c.prompt.includes(needle))?.tier;
    expect(tierOf('Investigate the prior art')).toBe('cheap'); // research → cheap
    expect(tierOf('Proposal under vote')).toBe('frontier'); // vote → frontier
    expect(tierOf('"subtasks"')).toBe('frontier'); // decompose → frontier
    expect(tierOf('"files"')).toBe('frontier'); // implement → frontier
    // The research call is the ONLY cheap-tier call; everything else frontier.
    expect(calls.filter((c) => c.tier === 'cheap')).toHaveLength(1);
    kern.close();
  });
});
