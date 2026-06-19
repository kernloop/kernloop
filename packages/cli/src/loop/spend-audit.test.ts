/**
 * `withSpendAudit` — the in-flight cost signal (#230·P5, CLM-0137). Each node is
 * wrapped so it appends ONE `loop.spend` audit event WHEN it actually spent
 * (delta > 0), carrying the per-node delta + the cumulative run total; a
 * zero-spend node appends nothing (the #230 vote's load-bearing anti-pollution
 * condition); a node that spends then throws still records spend-to-failure.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { TaskContract } from '@kernloop/contracts';
import { verifyChain } from '@kernloop/kernel';
import type { NodeContext, NodeExecutor } from '@kernloop/workflows';
import type { LoopBindings } from './executors.js';
import { withSpendAudit } from './executors-nodes.js';
import { readEnvelopes } from '../tools/audit.js';
import { boundHelpers, ctxFor, task } from './executors.testkit.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-spend-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const { kernloopFor, bindingsFor } = boundHelpers(scratch);

/** A LoopBindings whose `totals` is a mutable handle the fake executors bump. */
function boundWithTotals(name: string): {
  kern: ReturnType<typeof kernloopFor>;
  b: LoopBindings;
  totals: { tokens: number; usd: number };
} {
  const kern = kernloopFor(name);
  const totals = { tokens: 0, usd: 0 };
  return { kern, b: { ...bindingsFor(kern), totals }, totals };
}

/** A node executor that "spends" by bumping the shared totals, like meteredInvoke. */
function spender(
  totals: { tokens: number; usd: number },
  tokens: number,
  usd: number,
): NodeExecutor {
  return () => {
    totals.tokens += tokens;
    totals.usd += usd;
    return Promise.resolve('ok');
  };
}

function ctxAt(node: string, child?: TaskContract): NodeContext {
  return { ...ctxFor(3), node, ...(child === undefined ? {} : { child }) };
}

function spendEvents(kern: ReturnType<typeof kernloopFor>): Array<Record<string, unknown>> {
  return readEnvelopes(kern.paths.audit)
    .filter((e) => e.type === 'loop.spend')
    .map((e) => e.payload as Record<string, unknown>);
}

describe('withSpendAudit (#230, CLM-0137)', () => {
  it('emits delta + cumulative per spending node, monotonic across nodes, chain intact', async () => {
    const { kern, b, totals } = boundWithTotals('spend-monotonic');
    await withSpendAudit(b, spender(totals, 100, 0.5))({}, ctxAt('plan'));
    await withSpendAudit(b, spender(totals, 40, 0.25))({}, ctxAt('vote'));

    const events = spendEvents(kern);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ node: 'plan', nodeTokens: 100, cumulativeTokens: 100 });
    expect(events[1]).toMatchObject({ node: 'vote', nodeTokens: 40, cumulativeTokens: 140 });
    // Cumulative usd is non-decreasing (the in-flight "accumulating" signal).
    expect(events[1]!.cumulativeUsd as number).toBeGreaterThan(events[0]!.cumulativeUsd as number);
    expect(events[1]).toMatchObject({ nodeUsd: 0.25, cumulativeUsd: 0.75 });
    expect(verifyChain(kern.store).ok).toBe(true);
    kern.close();
  });

  it('a zero-spend node appends NOTHING — no audit-chain pollution', async () => {
    const { kern, b, totals } = boundWithTotals('spend-zero');
    // Executor that does not touch totals (e.g. frame/integrate — no model call).
    await withSpendAudit(b, () => Promise.resolve('noop'))({}, ctxAt('frame'));
    expect(spendEvents(kern)).toHaveLength(0);
    expect(totals).toEqual({ tokens: 0, usd: 0 });
    kern.close();
  });

  it('records spend-to-failure when a node spends then THROWS (finally), and rethrows', async () => {
    const { kern, b, totals } = boundWithTotals('spend-throw');
    const exec: NodeExecutor = () => {
      totals.tokens += 70;
      totals.usd += 0.3;
      throw new Error('node blew up after spending');
    };
    await expect(withSpendAudit(b, exec)({}, ctxAt('implement'))).rejects.toThrow('blew up');
    const events = spendEvents(kern);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ node: 'implement', nodeTokens: 70 });
    kern.close();
  });

  it('attributes spend to the child inside the fan-out (childId)', async () => {
    const { kern, b, totals } = boundWithTotals('spend-child');
    await withSpendAudit(b, spender(totals, 10, 0.1))(
      {},
      ctxAt('quality', { ...task, id: 'task.1' }),
    );
    expect(spendEvents(kern)[0]).toMatchObject({ node: 'quality', childId: 'task.1' });
    kern.close();
  });
});

/** Read this run's node-lifecycle events in file order. */
function nodeEvents(
  kern: ReturnType<typeof kernloopFor>,
): Array<{ type: string; payload: Record<string, unknown> }> {
  return readEnvelopes(kern.paths.audit)
    .filter((e) => e.type === 'loop.node.start' || e.type === 'loop.node.finish')
    .map((e) => ({ type: e.type, payload: e.payload as Record<string, unknown> }));
}

describe('withSpendAudit node lifecycle (#336 P3, CLM-0149)', () => {
  it('brackets EVERY node with loop.node.start + loop.node.finish (even a zero-spend node)', async () => {
    const { kern, b } = boundWithTotals('node-zero');
    await withSpendAudit(b, () => Promise.resolve('noop'))({}, ctxAt('frame'));
    expect(nodeEvents(kern).map((e) => e.type)).toEqual(['loop.node.start', 'loop.node.finish']);
    expect(spendEvents(kern)).toHaveLength(0); // a zero-spend node still emits no loop.spend
    kern.close();
  });

  it('emits loop.node.finish even when the node THROWS (the finally), then rethrows', async () => {
    const { kern, b } = boundWithTotals('node-throw');
    const exec: NodeExecutor = () => {
      throw new Error('boom');
    };
    await expect(withSpendAudit(b, exec)({}, ctxAt('implement'))).rejects.toThrow('boom');
    expect(nodeEvents(kern).map((e) => e.type)).toEqual(['loop.node.start', 'loop.node.finish']);
    kern.close();
  });

  it('carries ONLY already-known facts (runId, node, childId) — no fabricated ordinal', async () => {
    const { kern, b } = boundWithTotals('node-child');
    await withSpendAudit(b, () => Promise.resolve('ok'))(
      {},
      ctxAt('review', { ...task, id: 'task.2' }),
    );
    const start = nodeEvents(kern).find((e) => e.type === 'loop.node.start');
    expect(start?.payload).toEqual({
      runId: expect.any(String),
      node: 'review',
      childId: 'task.2',
    });
    kern.close();
  });
});
