/**
 * Vote gate runner tests (CLM-0037..0039). The injected `invokeVoter` is
 * scripted per test — an honest test double for the external model CLI;
 * what is claimed (and therefore what is tested) is the panel/aggregation/
 * recording machinery around it.
 */
import { describe, expect, it } from 'vitest';
import { VerdictSchema, type Brief } from '@kernloop/contracts';
import { FINDING_REASONING_CAP, runVoteGate, type InvokeVoter, type VoterBallot } from './run.js';
import { PANEL_DEFAULT, PANEL_RATIFICATION, type VoterTemplate } from './voters.js';

function makeBrief(): Brief {
  return {
    taskId: 'task-1',
    sections: [],
    budget: { allotted: 1000, used: 0 },
    compilerVersion: '1.0.0',
  };
}

const ZERO = { tokens: 0, usd: 0 };

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

describe('runVoteGate — panels (CLM-0037)', () => {
  it('convenes the default 3-voter panel when no panel is given', async () => {
    const invoked: string[] = [];
    const verdict = await runVoteGate({
      ...baseOptions((voter) => {
        invoked.push(voter.name);
        return Promise.resolve({ vote: 'approve', reasoning: 'ok', cost: ZERO });
      }),
    });
    expect(invoked).toEqual(PANEL_DEFAULT.map((v) => v.name));
    expect(verdict.voters).toHaveLength(3);
    expect(verdict.result).toBe('approve');
  });

  it('convenes the 7-voter ratification panel when given', async () => {
    const verdict = await runVoteGate({
      ...baseOptions(scriptedVoter({ contrarian: 'reject', 'scope-steward': 'reject' })),
      panel: PANEL_RATIFICATION,
      strategy: 'supermajority',
    });
    expect(verdict.voters?.map((v) => v.voter)).toEqual(PANEL_RATIFICATION.map((v) => v.name));
    expect(verdict.result).toBe('approve'); // 5/7 ≥ 2/3
    expect(verdict.confidence).toBeCloseTo(5 / 7);
  });

  it('defaults to simple_majority and rejects a 1-2 panel', async () => {
    const verdict = await runVoteGate({
      ...baseOptions(scriptedVoter({ security: 'reject', 'scope-steward': 'reject' })),
    });
    expect(verdict.result).toBe('reject');
    expect(verdict.confidence).toBeCloseTo(1 / 3);
  });

  it('abstains when every voter abstains', async () => {
    const verdict = await runVoteGate({
      ...baseOptions(() =>
        Promise.resolve({ vote: 'abstain', reasoning: 'cannot judge', cost: ZERO }),
      ),
    });
    expect(verdict.result).toBe('abstain');
    expect(verdict.confidence).toBe(0);
  });

  it('rejects an empty panel rather than abstaining silently', async () => {
    await expect(runVoteGate({ ...baseOptions(scriptedVoter({})), panel: [] })).rejects.toThrow(
      'panel must contain at least one voter',
    );
  });
});

describe('runVoteGate — shared Brief (CLM-0039)', () => {
  it('passes the identical Brief object to every voter', async () => {
    const brief = makeBrief();
    const seen: Brief[] = [];
    await runVoteGate({
      taskId: 'task-1',
      proposal: 'p',
      brief,
      panel: PANEL_RATIFICATION,
      invokeVoter: (_voter, b) => {
        seen.push(b);
        return Promise.resolve({ vote: 'approve', reasoning: 'ok', cost: ZERO });
      },
    });
    expect(seen).toHaveLength(7);
    for (const b of seen) {
      expect(b).toBe(brief); // object identity — one compile, n voters
    }
  });
});

describe('runVoteGate — voter records (CLM-0038)', () => {
  it("records every voter's vote and reasoning in panel order", async () => {
    const verdict = await runVoteGate({
      ...baseOptions(scriptedVoter({ security: 'reject', 'scope-steward': 'abstain' })),
    });
    expect(verdict.voters).toEqual([
      { voter: 'architect', vote: 'approve', reasoning: 'architect reasoning' },
      { voter: 'security', vote: 'reject', reasoning: 'security reasoning' },
      { voter: 'scope-steward', vote: 'abstain', reasoning: 'scope-steward reasoning' },
    ]);
  });

  it('records a throwing voter as abstain with voter_error reasoning', async () => {
    const verdict = await runVoteGate({
      ...baseOptions((voter) => {
        if (voter.name === 'security') return Promise.reject(new Error('model CLI exploded'));
        return Promise.resolve({ vote: 'approve', reasoning: 'ok', cost: ZERO });
      }),
    });
    const security = verdict.voters?.find((v) => v.voter === 'security');
    expect(security?.vote).toBe('abstain');
    expect(security?.reasoning).toBe('voter_error: model CLI exploded');
    expect(verdict.result).toBe('approve'); // 2/2 non-abstain approve
  });

  it('records a schema-invalid ballot as abstain, never coercing a vote', async () => {
    const verdict = await runVoteGate({
      ...baseOptions((voter) => {
        if (voter.name === 'architect') {
          return Promise.resolve({ vote: 'maybe', reasoning: 1 } as unknown as VoterBallot);
        }
        return Promise.resolve({ vote: 'reject', reasoning: 'no', cost: ZERO });
      }),
    });
    const architect = verdict.voters?.find((v) => v.voter === 'architect');
    expect(architect?.vote).toBe('abstain');
    expect(architect?.reasoning).toContain('voter_error: invalid ballot:');
    expect(verdict.result).toBe('reject');
  });
});

describe('runVoteGate — findings, cost, schema', () => {
  it('emits one warn finding per dissenting voter, with capped reasoning', async () => {
    const long = 'x'.repeat(FINDING_REASONING_CAP + 100);
    const verdict = await runVoteGate({
      ...baseOptions((voter) => {
        if (voter.name === 'security') {
          return Promise.resolve({ vote: 'reject', reasoning: long, cost: ZERO });
        }
        if (voter.name === 'scope-steward') {
          return Promise.resolve({ vote: 'abstain', reasoning: '', cost: ZERO });
        }
        return Promise.resolve({ vote: 'approve', reasoning: 'fine', cost: ZERO });
      }),
    });
    expect(verdict.findings).toHaveLength(2);
    const [rejectFinding, abstainFinding] = verdict.findings;
    expect(rejectFinding?.severity).toBe('warn');
    expect(rejectFinding?.message).toContain('voter "security" voted reject');
    expect(rejectFinding?.message.length).toBeLessThanOrEqual(
      FINDING_REASONING_CAP + 'voter "security" voted reject: …'.length,
    );
    expect(abstainFinding?.message).toContain('voter "scope-steward" voted abstain');
    expect(abstainFinding?.message).toContain('(no reasoning given)');
  });

  it('emits no findings when the panel approves unanimously', async () => {
    const verdict = await runVoteGate({ ...baseOptions(scriptedVoter({})) });
    expect(verdict.findings).toEqual([]);
  });

  it('sums voter costs, including per-adapter breakdowns', async () => {
    const costs: Record<string, VoterBallot['cost']> = {
      architect: { tokens: 100, usd: 0.1, byAdapter: { claude: { tokens: 100, usd: 0.1 } } },
      security: { tokens: 50, usd: 0.05, byAdapter: { codex: { tokens: 50, usd: 0.05 } } },
      'scope-steward': {
        tokens: 25,
        usd: 0.025,
        byAdapter: { claude: { tokens: 25, usd: 0.025 } },
      },
    };
    const verdict = await runVoteGate({
      ...baseOptions((voter) =>
        Promise.resolve({
          vote: 'approve',
          reasoning: 'ok',
          cost: costs[voter.name] ?? ZERO,
        }),
      ),
    });
    expect(verdict.cost.tokens).toBe(175);
    expect(verdict.cost.usd).toBeCloseTo(0.175);
    expect(verdict.cost.wallClockMs).toBeGreaterThanOrEqual(0);
    expect(verdict.cost.byAdapter).toEqual({
      claude: { tokens: 125, usd: 0.125 },
      codex: { tokens: 50, usd: 0.05 },
    });
  });

  it('charges zero cost for an errored voter', async () => {
    const verdict = await runVoteGate({
      ...baseOptions((voter) => {
        if (voter.name === 'architect') return Promise.reject(new Error('down'));
        return Promise.resolve({ vote: 'approve', reasoning: 'ok', cost: { tokens: 7, usd: 0.2 } });
      }),
    });
    expect(verdict.cost.tokens).toBe(14);
    expect(verdict.cost.usd).toBeCloseTo(0.4);
  });

  it('emits a schema-valid Verdict for the vote gate', async () => {
    const verdict = await runVoteGate({ ...baseOptions(scriptedVoter({ security: 'reject' })) });
    expect(VerdictSchema.safeParse(verdict).success).toBe(true);
    expect(verdict.gate).toBe('vote');
    expect(verdict.taskId).toBe('task-1');
  });
});

describe('runVoteGate — concurrency', () => {
  it('invokes every voter before any ballot resolves (concurrent panel)', async () => {
    const invoked: string[] = [];
    const resolvers: Array<(b: VoterBallot) => void> = [];
    const promise = runVoteGate({
      ...baseOptions((voter: VoterTemplate) => {
        invoked.push(voter.name);
        return new Promise<VoterBallot>((resolve) => resolvers.push(resolve));
      }),
    });
    // All three voters launched while every ballot is still pending.
    await Promise.resolve();
    expect(invoked).toEqual(PANEL_DEFAULT.map((v) => v.name));
    expect(resolvers).toHaveLength(3);
    for (const resolve of resolvers) {
      resolve({ vote: 'approve', reasoning: 'ok', cost: ZERO });
    }
    const verdict = await promise;
    expect(verdict.result).toBe('approve');
  });
});
