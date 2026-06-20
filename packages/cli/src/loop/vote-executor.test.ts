/**
 * The vote-gate loop node (#369): the provider-DIVERSE panel-7 routing and the
 * retrospect-time voter-outcome labeling that feeds precision. Co-located with
 * vote-executor.ts; split from executors.test.ts for line budget.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type Verdict } from '@kernloop/contracts';
import { type AdapterName } from '@kernloop/kernel';
import { buildLoopExecutors, type LoopRefs } from './executors.js';
import { resolveServed, type NodeSeam } from './node-seam.js';
import { readEnvelopes } from '../tools/audit.js';
import { boundHelpers, ctxFor, planBrief, scripted } from './executors.testkit.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-vote-exec-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const { kernloopFor, bindingsFor } = boundHelpers(scratch);

describe('vote executor — provider-diverse panel (#369)', () => {
  const req = { tier: 'large' as const, effort: 'high' as const, capabilities: [] };
  const seamForAdapter = (name: AdapterName): NodeSeam => ({
    invoke: scripted,
    served: resolveServed(req, name),
  });

  it('convenes a PROVIDER-DIVERSE panel-7: distinct served per voter, no single-oracle', async () => {
    const kern = kernloopFor('vote-diverse');
    const bindings = {
      ...bindingsFor(kern),
      voteDiversity: { adapters: ['claude', 'codex', 'agy'] as AdapterName[], seamForAdapter },
    };
    const verdict = (await buildLoopExecutors(bindings)['vote']?.(planBrief, ctxFor(7))) as Verdict;
    expect(verdict.voters).toHaveLength(7);
    const families = new Set(verdict.voters?.map((v) => v.served?.family));
    expect(families.size).toBeGreaterThanOrEqual(2); // genuinely independent
    expect(verdict.findings.some((f) => f.message.includes('SINGLE-ORACLE'))).toBe(false);
    kern.close();
  });

  it('DEGRADES a panel-7 with one adapter: single-oracle finding + audit', async () => {
    const kern = kernloopFor('vote-degraded');
    const bindings = {
      ...bindingsFor(kern),
      voteDiversity: { adapters: ['claude'] as AdapterName[], seamForAdapter },
    };
    const verdict = (await buildLoopExecutors(bindings)['vote']?.(planBrief, ctxFor(7))) as Verdict;
    expect(verdict.findings.some((f) => f.message.includes('SINGLE-ORACLE'))).toBe(true);
    const events = readEnvelopes(path.join(kern.paths.dir, 'audit.jsonl')).filter(
      (e) => e.type === 'cli.vote.single-oracle-degraded',
    );
    expect(events).toHaveLength(1);
    kern.close();
  });

  it('two UNCATALOGUED adapters (codex + opencode) do NOT collapse to a single oracle (#381)', async () => {
    const kern = kernloopFor('vote-uncatalogued');
    const bindings = {
      ...bindingsFor(kern),
      voteDiversity: { adapters: ['codex', 'opencode'] as AdapterName[], seamForAdapter },
    };
    const verdict = (await buildLoopExecutors(bindings)['vote']?.(planBrief, ctxFor(7))) as Verdict;
    // Both serve the harness default → globally both normalize to unknown/unknown,
    // which would falsely read as ONE class. The vote-scoped identity keys an unknown
    // class by its adapter, so the panel reads as TWO providers, not a single oracle.
    const providers = new Set(verdict.voters?.map((v) => v.served?.provider));
    expect(providers).toEqual(new Set(['codex', 'opencode']));
    expect(verdict.findings.some((f) => f.message.includes('SINGLE-ORACLE'))).toBe(false);
    kern.close();
  });

  it('panel-3 loop votes stay single-adapter (no served) even with diversity available', async () => {
    const kern = kernloopFor('vote3-nodiv');
    const bindings = {
      ...bindingsFor(kern),
      voteDiversity: { adapters: ['claude', 'agy'] as AdapterName[], seamForAdapter },
    };
    const verdict = (await buildLoopExecutors(bindings)['vote']?.(planBrief, ctxFor(3))) as Verdict;
    expect(verdict.voters?.every((v) => v.served === undefined)).toBe(true);
    expect(verdict.findings.some((f) => f.message.includes('#369'))).toBe(false);
    kern.close();
  });
});

describe('retrospect — voter-outcome labeling (#369 Inc3a)', () => {
  const planVoteVerdict: Verdict = {
    taskId: 'task-unit',
    gate: 'vote',
    result: 'approve',
    confidence: 1,
    findings: [],
    voters: [
      { voter: 'aye', vote: 'approve', reasoning: '' },
      { voter: 'nay', vote: 'reject', reasoning: '' },
    ],
    cost: { tokens: 0, usd: 0 },
  };
  const outcomeWith = (status: 'success' | 'failure') => ({
    taskId: 'task-unit',
    status,
    signals: [],
    cost: { tokens: 0, usd: 0 },
    traceRef: 'loop:r',
    distillCandidates: [],
  });

  it('labels approve-correct on success and reject-correct on failure', () => {
    const kern = kernloopFor('label-success');
    const refs: LoopRefs = { planVoteVerdict };
    void buildLoopExecutors(bindingsFor(kern, refs))['retrospect']?.(
      outcomeWith('success'),
      ctxFor(3),
    );
    // approve matched success ⇒ correct (precision 1); reject did not ⇒ wrong (precision 0).
    expect(kern.observer.runningPrecision('aye')).toMatchObject({ labeled: 1, precision: 1 });
    expect(kern.observer.runningPrecision('nay')).toMatchObject({ labeled: 1, precision: 0 });
    kern.close();
  });

  it('inverts the labels when the run FAILED (a vindicated rejecter is correct)', () => {
    const kern = kernloopFor('label-failure');
    const refs: LoopRefs = { planVoteVerdict };
    void buildLoopExecutors(bindingsFor(kern, refs))['retrospect']?.(
      outcomeWith('failure'),
      ctxFor(3),
    );
    expect(kern.observer.runningPrecision('aye')).toMatchObject({ labeled: 1, precision: 0 });
    expect(kern.observer.runningPrecision('nay')).toMatchObject({ labeled: 1, precision: 1 });
    kern.close();
  });

  it('labels nothing when no plan vote was stashed (a resume past the vote)', () => {
    const kern = kernloopFor('label-none');
    void buildLoopExecutors(bindingsFor(kern, {}))['retrospect']?.(
      outcomeWith('success'),
      ctxFor(3),
    );
    expect(kern.observer.runningPrecision('aye').labeled).toBe(0);
    kern.close();
  });

  it('does NOT label an abstaining voter (abstention is no prediction)', () => {
    const kern = kernloopFor('label-abstain');
    const refs: LoopRefs = {
      planVoteVerdict: {
        ...planVoteVerdict,
        voters: [{ voter: 'undecided', vote: 'abstain', reasoning: '' }],
      },
    };
    void buildLoopExecutors(bindingsFor(kern, refs))['retrospect']?.(
      outcomeWith('failure'),
      ctxFor(3),
    );
    expect(kern.observer.runningPrecision('undecided').labeled).toBe(0);
    kern.close();
  });
});
