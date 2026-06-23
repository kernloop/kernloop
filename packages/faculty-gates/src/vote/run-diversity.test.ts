/**
 * Vote-gate DIVERSITY + INDEPENDENCE-QUORUM tests (#369 provenance/findings, #405
 * distinct-class quorum) — split from run.test.ts to keep each file under the 400-line
 * ceiling. The injected `invokeVoter` is a scripted test double; what is tested is the
 * provenance recording, the diversity findings, and the independence-quorum escalation.
 */
import { describe, expect, it } from 'vitest';
import type { Brief } from '@kernloop/contracts';
import { distinctClassQuorum, runVoteGate, type InvokeVoter, type VoterBallot } from './run.js';
import { PANEL_DEFAULT } from './voters.js';

function makeBrief(): Brief {
  return {
    taskId: 'task-1',
    sections: [],
    budget: { allotted: 1000, used: 0 },
    compilerVersion: '1.0.0',
  };
}

/** Scripted voter: looks up the vote by voter name; approve by default. */
function scriptedVoter(script: Record<string, VoterBallot['vote']>): InvokeVoter {
  return (voter) =>
    Promise.resolve({
      vote: script[voter.name] ?? 'approve',
      reasoning: `${voter.name} reasoning`,
      cost: { tokens: 10, usd: 0.01 },
    });
}

function baseOptions(invokeVoter: InvokeVoter) {
  return { taskId: 'task-1', proposal: 'add a vote gate', brief: makeBrief(), invokeVoter };
}

/** A normalized served ModelIdentity for the diversity tests (#369). */
function served(provider: string, family: string) {
  return {
    provider,
    family,
    generation: '1',
    variant: null,
    tier: 'large' as const,
    raw: family,
    resolvedBy: 'table' as const,
    contextWindow: null,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
  };
}

/** Scripted voter that also reports a per-voter served identity (the composition
 * root's job in production) — `served` is keyed off voter name. */
function servedVoter(byVoter: Record<string, ReturnType<typeof served>>): InvokeVoter {
  return (voter) =>
    Promise.resolve({
      vote: 'approve',
      reasoning: 'ok',
      cost: { tokens: 10, usd: 0.01 },
      ...(byVoter[voter.name] === undefined ? {} : { served: byVoter[voter.name] }),
    });
}

describe('runVoteGate — diversity provenance + findings (#369)', () => {
  it('records each voter served identity and flags no skew on a fully diverse panel', async () => {
    const verdict = await runVoteGate(
      baseOptions(
        servedVoter({
          architect: served('anthropic', 'claude'),
          security: served('google', 'gemini'),
          'scope-steward': served('openai', 'codex'),
        }),
      ),
    );
    // Each VoterRecord carries its served class — the panel is verifiably independent.
    expect(verdict.voters?.map((v) => v.served?.family).sort()).toEqual([
      'claude',
      'codex',
      'gemini',
    ]);
    // 3 distinct classes, none a majority ⇒ no single-oracle and no skew finding.
    expect(verdict.findings.some((f) => f.message.includes('#369'))).toBe(false);
  });

  it('emits a SINGLE-ORACLE warn finding when all ballots collapse to one class', async () => {
    const one = served('anthropic', 'claude');
    const verdict = await runVoteGate(
      baseOptions(servedVoter({ architect: one, security: one, 'scope-steward': one })),
    );
    const f = verdict.findings.find((x) => x.message.includes('SINGLE-ORACLE'));
    expect(f?.severity).toBe('warn');
    expect(verdict.voters?.every((v) => v.served?.family === 'claude')).toBe(true);
  });

  it('emits a diversity-SKEW info finding when one class casts a majority', async () => {
    const verdict = await runVoteGate(
      baseOptions(
        servedVoter({
          architect: served('anthropic', 'claude'),
          security: served('anthropic', 'claude'),
          'scope-steward': served('google', 'gemini'),
        }),
      ),
    );
    const f = verdict.findings.find((x) => x.message.includes('SKEW'));
    expect(f?.severity).toBe('info');
    expect(f?.message).toContain('2/3');
  });

  it('emits a DILUTION warn finding when a voter on a diverse panel fails — adapter error (#371)', async () => {
    const claude = served('anthropic', 'claude');
    const gemini = served('google', 'gemini');
    const invoke: InvokeVoter = (voter) => {
      if (voter.name === 'scope-steward')
        return Promise.reject(new Error('adapter codex authed out'));
      return Promise.resolve({
        vote: 'approve',
        reasoning: 'ok',
        cost: { tokens: 10, usd: 0.01 },
        served: voter.name === 'architect' ? claude : gemini,
      });
    };
    const verdict = await runVoteGate(baseOptions(invoke));
    const d = verdict.findings.find((f) => f.message.includes('DILUTED'));
    expect(d?.severity).toBe('warn');
    expect(d?.message).toContain('1 of 3 voters failed');
    expect(d?.message).toContain('only 2 independent ballots'); // 2 of 3 ballots survived
    // the failed voter abstained honestly (voter_error), never a fabricated vote.
    const failed = verdict.voters?.find((v) => v.voter === 'scope-steward');
    expect(failed?.vote).toBe('abstain');
    expect(failed?.reasoning).toContain('voter_error:');
  });

  it('DILUTION co-occurs with SINGLE-ORACLE: surviving ballots one class + a failure (#371)', async () => {
    const one = served('anthropic', 'claude');
    const invoke: InvokeVoter = (voter) => {
      if (voter.name === 'scope-steward') return Promise.reject(new Error('opencode key limit'));
      return Promise.resolve({
        vote: 'approve',
        reasoning: 'ok',
        cost: { tokens: 10, usd: 0.01 },
        served: one,
      });
    };
    const verdict = await runVoteGate(baseOptions(invoke));
    expect(verdict.findings.some((f) => f.message.includes('DILUTED'))).toBe(true);
    expect(verdict.findings.some((f) => f.message.includes('SINGLE-ORACLE'))).toBe(true);
  });

  it('no DILUTION finding when every diverse voter succeeds (#371)', async () => {
    const verdict = await runVoteGate(
      baseOptions(
        servedVoter({
          architect: served('anthropic', 'claude'),
          security: served('google', 'gemini'),
          'scope-steward': served('openai', 'codex'),
        }),
      ),
    );
    expect(verdict.findings.some((f) => f.message.includes('DILUTED'))).toBe(false);
  });

  it('adds no diversity finding and no served when the panel is single-adapter (today)', async () => {
    const verdict = await runVoteGate(baseOptions(scriptedVoter({})));
    expect(verdict.findings.some((f) => f.message.includes('#369'))).toBe(false);
    expect(verdict.voters?.every((v) => v.served === undefined)).toBe(true);
  });
});

describe('distinctClassQuorum — the pure independence gate (#405/#369 Inc5b)', () => {
  const rec = (name: string, id?: ReturnType<typeof served>) => ({
    voter: name,
    vote: 'approve' as const,
    reasoning: 'ok',
    ...(id === undefined ? {} : { served: id }),
  });
  const claude = served('anthropic', 'claude');
  const gemini = served('google', 'gemini');

  it('is OFF (undefined) when neither a threshold nor a ratification profile is set', () => {
    expect(distinctClassQuorum([rec('a', claude)], undefined, false)).toBeUndefined();
  });
  it('defaults to requiring 2 classes for a ratification profile — single class escalates', () => {
    const reason = distinctClassQuorum([rec('a', claude), rec('b', claude)], undefined, true);
    expect(reason).toContain('INDEPENDENCE QUORUM');
    expect(reason).toContain('1 distinct model class');
  });
  it('is MET (undefined) when the ratification panel spans 2 distinct classes', () => {
    expect(
      distinctClassQuorum([rec('a', claude), rec('b', gemini)], undefined, true),
    ).toBeUndefined();
  });
  it('counts distinct CLASSES, not raw ballots — 3 claude ballots are 1 class, below quorum', () => {
    const reason = distinctClassQuorum(
      [rec('a', claude), rec('b', claude), rec('c', claude)],
      undefined,
      true,
    );
    expect(reason).toContain('1 distinct model class(es) among 3 ballots');
  });
  it('an explicit minDistinctClasses overrides the ratification default (1 disables it)', () => {
    expect(distinctClassQuorum([rec('a', claude), rec('b', claude)], 1, true)).toBeUndefined();
  });
  it('an explicit threshold engages even without a ratification profile', () => {
    expect(distinctClassQuorum([rec('a', claude), rec('b', gemini)], 3, false)).toContain(
      'below the 3 required',
    );
  });
  it('is inert on a single-adapter / endpoint-only panel (no served identities)', () => {
    expect(distinctClassQuorum([rec('a'), rec('b'), rec('c')], 2, true)).toBeUndefined();
  });
});

describe('runVoteGate — distinct-class quorum escalation (#405/#369 Inc5b)', () => {
  const claude = served('anthropic', 'claude');
  const gemini = served('google', 'gemini');

  it('a single-oracle RATIFICATION panel ESCALATES instead of auto-approving', async () => {
    const verdict = await runVoteGate({
      ...baseOptions(servedVoter({ architect: claude, security: claude, 'scope-steward': claude })),
      panel: PANEL_DEFAULT, // 3 unanimous approvals, but all one class
      ratificationProfile: true,
    });
    expect(verdict.result).toBe('escalate'); // would be 'approve' without the quorum
    expect(verdict.findings.some((f) => f.message.includes('INDEPENDENCE QUORUM'))).toBe(true);
  });

  it('a 2-class RATIFICATION panel does NOT escalate (quorum met) — approves', async () => {
    const verdict = await runVoteGate({
      ...baseOptions(servedVoter({ architect: claude, security: gemini, 'scope-steward': claude })),
      ratificationProfile: true,
    });
    expect(verdict.result).toBe('approve');
    expect(verdict.findings.some((f) => f.message.includes('INDEPENDENCE QUORUM'))).toBe(false);
  });

  it('WITHOUT a ratification profile a single-class panel is byte-identical (still approves)', async () => {
    const verdict = await runVoteGate(
      baseOptions(servedVoter({ architect: claude, security: claude, 'scope-steward': claude })),
    );
    expect(verdict.result).toBe('approve'); // opt-in/default-off everywhere but ratification
  });

  it('minDistinctClasses:1 opts a ratification panel OUT (single-oracle approves)', async () => {
    const verdict = await runVoteGate({
      ...baseOptions(servedVoter({ architect: claude, security: claude, 'scope-steward': claude })),
      ratificationProfile: true,
      minDistinctClasses: 1,
    });
    expect(verdict.result).toBe('approve');
  });

  it('a single-adapter panel (no served) on a ratification profile is byte-identical (approves)', async () => {
    const verdict = await runVoteGate({
      ...baseOptions(scriptedVoter({})),
      ratificationProfile: true,
    });
    expect(verdict.result).toBe('approve');
  });

  it('COMPOSED: precision weights × quorum — the quorum still escalates a single-oracle panel', async () => {
    // Even with precision weights applied, a single-oracle ratification escalates: the
    // independence gate overrides the (weighted) tally, never silently auto-deciding.
    const verdict = await runVoteGate({
      ...baseOptions(servedVoter({ architect: claude, security: claude, 'scope-steward': claude })),
      ratificationProfile: true,
      weights: [1.4, 1.2, 0.8],
    });
    expect(verdict.result).toBe('escalate');
    expect(verdict.findings.some((f) => f.message.includes('INDEPENDENCE QUORUM'))).toBe(true);
  });
});
