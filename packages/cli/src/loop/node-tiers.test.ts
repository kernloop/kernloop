/**
 * Tiered-adapter routing is SINGLE-SOURCE [CLM-0068, CLM-0076]: the canonical
 * loop derives every model-calling node's tier from the manifest/template it
 * routes to, then resolves the adapter through the kernel's pure tier→adapter
 * resolver. There is no parallel per-node tier map (NODE_TIERS is deleted).
 *
 * These tests pin (1) the node→tier DERIVATION from the real manifests
 * (research/review → cheap; plan/vote/decompose/implement → frontier), (2) the
 * kernel-resolved node→adapter binding with an `adapters` overlay block, (3)
 * the backward-compat guarantee — with NO `adapters`, every node resolves to
 * the run adapter — (4) end to end, that each node binds a DIFFERENT real
 * adapter CLI when configured, proven by distinct subprocess output, and (5)
 * the LOAD-BEARING propagation proof: flipping a tier source's declared
 * `modelTier` changes the adapter the loop binds for that node.
 *
 * HONESTY: enforcement is at the LOOP composition root, not the Router (see
 * loop/node-tiers.ts) — these tests assert loop selection, not Router behavior.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BriefSchema, TaskContractSchema, type Cost } from '@kernloop/contracts';
import type { AdapterName } from '@kernloop/kernel';
import type { NodeContext } from '@kernloop/workflows';
import { createKernloop, type Kernloop } from '../kernel.js';
import { buildLoopExecutors, type LoopBindings, type LoopRefs } from './executors.js';
import type { LoopInvoke } from './invoke.js';
import {
  nodeModelTier,
  defaultTierSources,
  type TieredNode,
  type TierSources,
} from './node-tiers.js';
import { buildInvokeForNode, nodeAdapter } from './index.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-node-tiers-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('nodeModelTier — derivation from the manifest/template each node routes to (spec §8.4)', () => {
  it('reads read/judge nodes as cheap and load-bearing generation/decisions as frontier', () => {
    expect(nodeModelTier('research')).toBe('cheap'); // Researcher template
    expect(nodeModelTier('review')).toBe('cheap'); // review gate manifest
    expect(nodeModelTier('plan')).toBe('frontier'); // PM template
    expect(nodeModelTier('decompose')).toBe('frontier'); // PM template
    expect(nodeModelTier('implement')).toBe('frontier'); // Coder template
    expect(nodeModelTier('vote')).toBe('frontier'); // vote gate manifest
  });

  it('the real sources are the shipped templates and the two model-calling gates', () => {
    const sources = defaultTierSources();
    expect(sources.researcher.modelTier).toBe('cheap');
    expect(sources.pm.modelTier).toBe('frontier');
    expect(sources.coder.modelTier).toBe('frontier');
    expect(sources.vote.modelTier).toBe('frontier');
    expect(sources.review.modelTier).toBe('cheap');
  });

  it('a gate source that omits modelTier is a manifest bug, surfaced loudly', () => {
    const broken: TierSources = { ...defaultTierSources(), vote: { modelTier: undefined } };
    expect(() => nodeModelTier('vote', broken)).toThrow(/declares no modelTier/);
  });
});

describe('nodeAdapter — kernel-resolved node→adapter binding', () => {
  const adapters = { cheap: 'codex', frontier: 'claude' } as const;

  it('binds the configured adapter for each node by its derived tier', () => {
    expect(nodeAdapter('gemini', adapters, 'research')).toBe('codex'); // cheap
    expect(nodeAdapter('gemini', adapters, 'review')).toBe('codex'); // cheap
    expect(nodeAdapter('gemini', adapters, 'plan')).toBe('claude'); // frontier
    expect(nodeAdapter('gemini', adapters, 'vote')).toBe('claude'); // frontier
    expect(nodeAdapter('gemini', adapters, 'decompose')).toBe('claude'); // frontier
    expect(nodeAdapter('gemini', adapters, 'implement')).toBe('claude'); // frontier
  });

  it('falls back to the run adapter for any tier the overlay leaves unset', () => {
    expect(nodeAdapter('opencode', { frontier: 'claude' }, 'research')).toBe('opencode');
    expect(nodeAdapter('opencode', { cheap: 'codex' }, 'plan')).toBe('opencode');
  });

  it('BACKWARD-COMPAT: with no adapters config, every node resolves to the run adapter', () => {
    for (const node of ['research', 'review', 'plan', 'vote', 'decompose', 'implement'] as const) {
      expect(nodeAdapter('gemini', undefined, node)).toBe('gemini');
      expect(nodeAdapter('gemini', {}, node)).toBe('gemini');
    }
  });
});

/**
 * LOAD-BEARING propagation proof [CLM-0076]: flip ONE tier source's declared
 * modelTier and the adapter the loop binds for that node moves with it. This is
 * the regression that proves the manifest is the single authority and there is
 * no NODE_TIERS map to diverge from it.
 */
describe('propagation — the manifest is the single authority for a node tier', () => {
  const A: AdapterName = 'codex'; // cheap
  const B: AdapterName = 'claude'; // frontier
  const adapters = { cheap: A, frontier: B } as const;

  it('research binds the cheap adapter and plan the frontier adapter by default', () => {
    expect(nodeAdapter('gemini', adapters, 'research')).toBe(A);
    expect(nodeAdapter('gemini', adapters, 'plan')).toBe(B);
  });

  it('flipping researcher.modelTier to frontier flips the research adapter to B', () => {
    const flipped: TierSources = {
      ...defaultTierSources(),
      researcher: { modelTier: 'frontier' },
    };
    // Same overlay, same node — only the manifest/template source changed.
    expect(nodeAdapter('gemini', adapters, 'research', flipped)).toBe(B);
    // And the unflipped sources still bind A — proving the source is the cause.
    expect(nodeAdapter('gemini', adapters, 'research')).toBe(A);
  });

  it('flipping the vote gate modelTier to cheap flips the vote adapter to A', () => {
    const flipped: TierSources = { ...defaultTierSources(), vote: { modelTier: 'cheap' } };
    expect(nodeAdapter('gemini', adapters, 'vote', flipped)).toBe(A);
    expect(nodeAdapter('gemini', adapters, 'vote')).toBe(B);
  });
});

/** Write a fake `claude` CLI (single-JSON result shape) echoing a marker. */
function fakeClaude(dir: string, marker: string): void {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'claude');
  const reply = JSON.stringify({
    type: 'result',
    is_error: false,
    result: marker,
    usage: { input_tokens: 1, output_tokens: 1 },
    total_cost_usd: 0.001,
  });
  writeFileSync(file, `#!/bin/sh\ncat > /dev/null\necho '${reply}'\n`);
  chmodSync(file, 0o755);
}

/** Write a fake `gemini` CLI (`-o json` response/stats shape) echoing a marker. */
function fakeGemini(dir: string, marker: string): void {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'gemini');
  const reply = JSON.stringify({
    response: marker,
    stats: { models: { 'gemini-2.0': { tokens: { input: 1, candidates: 1 } } } },
  });
  writeFileSync(file, `#!/bin/sh\ncat > /dev/null\necho '${reply}'\n`);
  chmodSync(file, 0o755);
}

describe('buildInvokeForNode — per-node seam binds the resolved adapter end to end', () => {
  it('returns a metered seam per resolved adapter; nodes of the same tier share it', () => {
    const totals = { tokens: 0, usd: 0 };
    const invokeFor = buildInvokeForNode(
      'opencode',
      { cheap: 'gemini', frontier: 'claude' },
      totals,
    );
    expect(invokeFor('plan')).toBe(invokeFor('vote')); // both frontier → same adapter → cached
    expect(invokeFor('research')).not.toBe(invokeFor('plan')); // cheap vs frontier differ
  });

  it("each node's seam invokes its resolved real adapter CLI and meters its cost", async () => {
    const bin = path.join(scratch, 'bin-cli');
    fakeGemini(bin, 'CHEAP-CLI'); // research → cheap → gemini
    fakeClaude(bin, 'FRONTIER-CLI'); // plan → frontier → claude
    const totals = { tokens: 0, usd: 0 };
    const invokeFor = buildInvokeForNode(
      'opencode',
      { cheap: 'gemini', frontier: 'claude' },
      totals,
    );
    const prevPath = process.env['PATH'];
    process.env['PATH'] = bin;
    try {
      const research = await invokeFor('research')('hi', { timeoutMs: 30_000 });
      const plan = await invokeFor('plan')('hi', { timeoutMs: 30_000 });
      expect(research.output).toBe('CHEAP-CLI'); // resolved to the cheap adapter (gemini)
      expect(plan.output).toBe('FRONTIER-CLI'); // resolved to the frontier adapter (claude)
      expect(totals.usd).toBeCloseTo(0.001); // claude reports usd; gemini reports none
    } finally {
      process.env['PATH'] = prevPath;
    }
  });
});

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

function kernloopFor(name: string): Kernloop {
  const repo = path.join(scratch, name);
  mkdirSync(path.join(repo, '.kernloop'), { recursive: true });
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}

describe('per-node seam selection through the real executors [CLM-0068]', () => {
  it('each model-calling executor draws its seam by NODE name: research cheap, vote/decompose/implement frontier', async () => {
    const kern = kernloopFor('node-seams');
    const calls: Array<{ node: TieredNode; prompt: string }> = [];
    // A node-aware invokeFor that records which node requested each seam, and
    // tags the recorded call with that node's DERIVED tier (single-source).
    const invokeFor =
      (node: TieredNode): LoopInvoke =>
      (prompt) => {
        calls.push({ node, prompt });
        return Promise.resolve({ output: respond(prompt), cost: COST });
      };
    const refs: LoopRefs = { framedTask: task, planBrief, researchBrief: planBrief };
    const ws = path.join(scratch, 'node-seams-ws');
    mkdirSync(ws, { recursive: true });
    const b: LoopBindings = { kern, workspaceDir: ws, invokeFor, adapter: 'claude', refs };
    const ex = buildLoopExecutors(b);
    await ex['research']?.(task, ctx3());
    await ex['plan']?.(planBrief, ctx3());
    await ex['vote']?.(planBrief, ctx3());
    await ex['decompose']?.({}, ctx3());
    await ex['implement']?.({ ...task, id: 'task-unit.1' }, ctx3());
    const nodeOf = (needle: string): TieredNode | undefined =>
      calls.find((c) => c.prompt.includes(needle))?.node;
    expect(nodeOf('Investigate the prior art')).toBe('research');
    expect(nodeOf('Proposal under vote')).toBe('vote');
    expect(nodeOf('"subtasks"')).toBe('decompose');
    expect(nodeOf('"files"')).toBe('implement');
    // The derived tier of each requested node matches the manifest source: the
    // research call is the ONLY cheap-tier node here; everything else frontier.
    expect(calls.filter((c) => nodeModelTier(c.node) === 'cheap')).toHaveLength(1);
    kern.close();
  });
});
