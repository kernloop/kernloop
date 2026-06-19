/**
 * Pre-node budget guard (#342, CLM-0154): the reserve calculus and the
 * overshoot-PREVENTION halt that turns an enforce cap from a soft post-hoc trip
 * into a near-ceiling. The pure functions are tested here in isolation; the
 * engine wiring (guard called BEFORE dispatch, observed-max tracked per node) is
 * proven in engine.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  enforceBudgetPreNode,
  nodeReserve,
  preNodeOvershoot,
  trackNodeSpend,
  type BudgetGuard,
  type BudgetSpend,
} from './budget.js';
import type { RunState } from './state.js';

const limit = { tokens: 100, usd: 1 };
function guard(spent: BudgetSpend, mode: 'enforce' | 'unlimited' = 'enforce'): BudgetGuard {
  return { mode, limit, spent: () => spent };
}
const zero: BudgetSpend = { tokens: 0, usd: 0 };

describe('nodeReserve (#342)', () => {
  it('is the larger of the headroom floor and the largest observed node, per dim', () => {
    // headroom floor 0.1 × 100 = 10 tokens / 0.1 usd; observed-max 40 tokens / 0 usd
    expect(nodeReserve(limit, { tokens: 40, usd: 0 }, 0.1)).toEqual({ tokens: 40, usd: 0.1 });
    // no headroom, no observation → reserve 0 (cold start relies on the post-node backstop)
    expect(nodeReserve(limit, zero, 0)).toEqual({ tokens: 0, usd: 0 });
  });
});

describe('preNodeOvershoot (#342)', () => {
  it('never pre-halts for an absent guard or unlimited mode', () => {
    expect(preNodeOvershoot(undefined, { tokens: 40, usd: 0 }, 0)).toBe(false);
    expect(
      preNodeOvershoot(guard({ tokens: 90, usd: 0 }, 'unlimited'), { tokens: 40, usd: 0 }, 0),
    ).toBe(false);
  });

  it('fires when still within budget but the next node would overshoot (the fix)', () => {
    // remaining 20 tokens < reserve 40 (largest node so far) → halt BEFORE the node
    expect(preNodeOvershoot(guard({ tokens: 80, usd: 0 }), { tokens: 40, usd: 0 }, 0)).toBe(true);
  });

  it('does NOT fire when remaining covers the reserve', () => {
    // remaining 50 ≥ reserve 40
    expect(preNodeOvershoot(guard({ tokens: 50, usd: 0 }), { tokens: 40, usd: 0 }, 0)).toBe(false);
  });

  it('defers to the post-node guard when ALREADY over budget (no double-halt, clearer message)', () => {
    expect(preNodeOvershoot(guard({ tokens: 101, usd: 0 }), { tokens: 40, usd: 0 }, 0)).toBe(false);
  });

  it('the headroom floor bounds the FIRST node (cold start) when observed-max is still 0', () => {
    // observedMax 0, but floor 0.3 × 100 = 30; remaining 80 < 30? no → fine here…
    expect(preNodeOvershoot(guard({ tokens: 20, usd: 0 }), zero, 0)).toBe(false); // no floor, no obs
    // …with a floor, a run near the limit pre-halts even before any node ran
    expect(preNodeOvershoot(guard({ tokens: 80, usd: 0 }), zero, 0.3)).toBe(true); // remaining 20 < 30
  });
});

describe('enforceBudgetPreNode + trackNodeSpend (#342)', () => {
  function runningState(): RunState {
    return {
      task: {
        id: 't',
        goal: 'g',
        constraints: [],
        budget: { tokens: 100, usd: 1, wallClockMin: 1 },
        evidence: [],
        definitionOfDone: [],
        authorityCeiling: 'suggest',
        overlay: 'r',
      },
      status: 'running',
      cursor: { phase: 'main', node: 'plan' },
      iteration: 0,
      values: {},
      findings: [],
      children: [],
      childResults: [],
      trace: [],
      observedMaxNodeSpend: { tokens: 0, usd: 0 },
    };
  }

  it('escalates with a legible finding when the next node would overshoot', () => {
    const state = runningState();
    enforceBudgetPreNode(state, guard({ tokens: 80, usd: 0 }), { tokens: 40, usd: 0 }, 0);
    expect(state.status).toBe('escalated');
    expect(state.haltReason).toBe('budget');
    expect(state.findings[0]?.message).toContain('halted BEFORE the next node');
    expect(state.findings[0]?.message).toContain('largest node so far 40 tokens');
  });

  it('is a no-op when the reserve is covered', () => {
    const state = runningState();
    enforceBudgetPreNode(state, guard({ tokens: 50, usd: 0 }), { tokens: 40, usd: 0 }, 0);
    expect(state.status).toBe('running');
    expect(state.findings).toHaveLength(0);
  });

  it('trackNodeSpend keeps the per-dim max delta and ignores a negative (meter reset) delta', () => {
    const state = runningState();
    trackNodeSpend(state, { tokens: 0, usd: 0 }, { tokens: 30, usd: 0.2 });
    expect(state.observedMaxNodeSpend).toEqual({ tokens: 30, usd: 0.2 });
    trackNodeSpend(state, { tokens: 30, usd: 0.2 }, { tokens: 80, usd: 0.3 }); // delta 50 / 0.1
    expect(state.observedMaxNodeSpend).toEqual({ tokens: 50, usd: 0.2 }); // tokens grew, usd kept
    trackNodeSpend(state, { tokens: 80, usd: 0.3 }, { tokens: 10, usd: 0.0 }); // negative delta (reset)
    expect(state.observedMaxNodeSpend).toEqual({ tokens: 50, usd: 0.2 }); // unchanged
  });
});
