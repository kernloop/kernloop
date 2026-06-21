/**
 * Correlation-aware vote aggregation (#369 Inc4, CLM-0167). Voters that share a
 * served model CLASS are not independent evidence; the opt-in discount downweights
 * a provider-correlated bloc toward its effective-independent size. These tests pin
 * the discount INVARIANTS (c(1)=1, monotonic non-increasing), DEMONSTRATE the
 * failure it fixes (a correlated bloc out-voting a more-diverse dissent), and prove
 * the off / single-adapter paths are byte-identical.
 */
import { describe, expect, it } from 'vitest';
import { type Brief, type ModelIdentity } from '@kernloop/contracts';
import { correlationDiscount } from './strategies.js';
import { runVoteGate, type InvokeVoter, type VoterBallot } from './run.js';
import { PANEL_RATIFICATION } from './voters.js';

function makeBrief(): Brief {
  return {
    taskId: 't',
    sections: [],
    budget: { allotted: 1000, used: 0 },
    compilerVersion: '1.0.0',
  };
}

/** A normalized served class for `provider/family` (composition-root-filled in prod). */
function served(provider: string, family: string): ModelIdentity {
  return {
    provider,
    family,
    generation: '1',
    variant: null,
    tier: 'large',
    raw: family,
    resolvedBy: 'table',
    contextWindow: null,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
  };
}

/** Per-voter scripted ballot (vote + optional served), keyed by voter name. */
function panelVoter(
  byName: Record<string, { vote: VoterBallot['vote']; served?: ModelIdentity }>,
): InvokeVoter {
  return (voter) => {
    const spec = byName[voter.name] ?? { vote: 'approve' };
    return Promise.resolve({
      vote: spec.vote,
      reasoning: `${voter.name}`,
      cost: { tokens: 1, usd: 0 },
      ...(spec.served === undefined ? {} : { served: spec.served }),
    });
  };
}

// The 7 ratification voters: a 4-strong bloc all on ONE class approves; the 3
// remaining each on a DISTINCT class reject. Raw head-count = 4 approve / 3 reject.
const A = served('anthropic', 'claude');
const BLOC_APPROVE_DIVERSE_REJECT = panelVoter({
  architect: { vote: 'approve', served: A },
  security: { vote: 'approve', served: A },
  devex: { vote: 'approve', served: A },
  'ai-ml': { vote: 'approve', served: A },
  pm: { vote: 'reject', served: served('openai', 'codex') },
  contrarian: { vote: 'reject', served: served('google', 'gemini') },
  'scope-steward': { vote: 'reject', served: served('meta', 'llama') },
});

describe('correlationDiscount — invariants (#369 Inc4, CLM-0167)', () => {
  it('c(1) = 1 for both forms — a singleton class is undiscounted', () => {
    expect(correlationDiscount('sqrt', 1)).toBe(1);
    expect(correlationDiscount('linear', 1)).toBe(1);
  });

  it('is monotonic NON-INCREASING in K (more correlation ⇒ no more weight each)', () => {
    for (const form of ['sqrt', 'linear'] as const) {
      for (let k = 1; k < 12; k += 1) {
        expect(correlationDiscount(form, k + 1)).toBeLessThanOrEqual(correlationDiscount(form, k));
      }
    }
  });

  it('sqrt is softer than linear for K≥2, and clamps K<1 to 1', () => {
    expect(correlationDiscount('sqrt', 4)).toBeCloseTo(0.5); // 1/sqrt(4)
    expect(correlationDiscount('linear', 4)).toBe(0.25); // 1/4 — more aggressive
    expect(correlationDiscount('sqrt', 4)).toBeGreaterThan(correlationDiscount('linear', 4));
    expect(correlationDiscount('sqrt', 0)).toBe(1); // clamp
  });
});

describe('runVoteGate — correlation-aware aggregation (#369 Inc4, CLM-0167)', () => {
  const base = {
    taskId: 't',
    proposal: 'p',
    brief: makeBrief(),
    panel: PANEL_RATIFICATION,
    strategy: 'simple_majority' as const,
  };

  it('DEMONSTRATION: a 4-voter one-class bloc out-votes 3 diverse dissenters — but the discount FLIPS it', async () => {
    // Unweighted: 4 approve / 3 reject → approve. The 4 approvers are ONE provider
    // (~2 independent voices); the 3 rejecters are 3 distinct providers. The discount
    // corrects for that: sqrt gives the bloc 4*(1/2)=2.0 effective vs 3*(1)=3.0.
    const off = await runVoteGate({ ...base, invokeVoter: BLOC_APPROVE_DIVERSE_REJECT });
    expect(off.result).toBe('approve'); // raw head-count carries the correlated bloc

    const on = await runVoteGate({
      ...base,
      invokeVoter: BLOC_APPROVE_DIVERSE_REJECT,
      correlationAware: true,
    });
    expect(on.result).toBe('reject'); // 2.0 effective approve < 3.0 effective reject
  });

  it('surfaces a VISIBLE info finding naming the discounted class and its effective votes', async () => {
    const v = await runVoteGate({
      ...base,
      invokeVoter: BLOC_APPROVE_DIVERSE_REJECT,
      correlationAware: true,
    });
    const finding = v.findings?.find((f) => f.message.includes('correlation discount'));
    expect(finding?.severity).toBe('info');
    expect(finding?.message).toContain('anthropic/claude'); // the discounted class, readable label
    expect(finding?.message).toContain('2.00 effective'); // 4 ballots → 2.0 under sqrt
  });

  it('linear form discounts harder than sqrt (4 → 1.0 effective, one vote per class)', async () => {
    const v = await runVoteGate({
      ...base,
      invokeVoter: BLOC_APPROVE_DIVERSE_REJECT,
      correlationAware: true,
      correlationForm: 'linear',
    });
    expect(v.result).toBe('reject');
    expect(v.findings?.some((f) => f.message.includes('1.00 effective'))).toBe(true);
  });

  it('composes with Inc3 precision weights — the finding reports the REAL weighted contribution', async () => {
    // Both precisionWeighted (weights) AND correlationAware on: the class's effective
    // votes must be c(K)×Σ(base weights), not the unweighted K×c(K). The 4 anthropic
    // approvers each carry precision weight 1.5 → baseSum 6.0; sqrt c(4)=0.5 → 3.0
    // effective (vs 2.0 unweighted), so the finding must say 3.00, not 2.00.
    const v = await runVoteGate({
      ...base,
      invokeVoter: BLOC_APPROVE_DIVERSE_REJECT,
      weights: [1.5, 1.5, 1.5, 1.5, 1, 1, 1], // panel order: 4 approvers weighted, 3 rejecters neutral
      correlationAware: true,
    });
    const finding = v.findings?.find((f) => f.message.includes('correlation discount'));
    expect(finding?.message).toContain('3.00 effective'); // 6.0 baseSum × 0.5 = 3.0, reflects precision
    // Tally: approve 6.0×0.5=3.0 vs reject 3×1×1=3.0 → simple_majority tie → reject.
    expect(v.result).toBe('reject');
  });

  it('OFF is byte-identical: same panel, correlationAware unset ⇒ approve, no discount finding', async () => {
    const v = await runVoteGate({ ...base, invokeVoter: BLOC_APPROVE_DIVERSE_REJECT });
    expect(v.result).toBe('approve');
    expect(v.findings?.some((f) => f.message.includes('correlation discount'))).toBe(false);
  });

  it('inert on a single-adapter panel: correlationAware ON but NO served ⇒ unchanged + no finding', async () => {
    // No voter reports a served identity (a single-adapter panel) → nothing to group.
    const noServed = panelVoter({
      architect: { vote: 'approve' },
      security: { vote: 'approve' },
      devex: { vote: 'approve' },
      'ai-ml': { vote: 'approve' },
      pm: { vote: 'reject' },
      contrarian: { vote: 'reject' },
      'scope-steward': { vote: 'reject' },
    });
    const on = await runVoteGate({ ...base, invokeVoter: noServed, correlationAware: true });
    expect(on.result).toBe('approve'); // 4/7 unchanged — no served classes to discount
    expect(on.findings?.some((f) => f.message.includes('correlation discount'))).toBe(false);
  });
});
