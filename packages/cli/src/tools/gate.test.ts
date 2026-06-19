/**
 * Unit tests for the `gate` tool — all three spec §5.3 gates through the
 * one uniform entry point: every Verdict is published on the bus (audited
 * [CLM-0032]), ingested by the observer (spec §5.5), and recorded as
 * telemetry; vote and review run real faculty gates over a scripted invoke
 * (an honest double for the model CLI); unknown gates are typed errors.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyChain } from '@kernloop/kernel';
import type { Cost } from '@kernloop/contracts';
import type { QualityCheck } from '@kernloop/faculty-gates';
import { createKernloop, type Kernloop } from '../kernel.js';
import type { LoopInvoke } from '../loop/invoke.js';
import { readEnvelopes } from './audit.js';
import { UnknownGateError, gateTool } from './gate.js';

const dirs: string[] = [];
function freshKernloop(): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-gate-'));
  dirs.push(repo);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop') });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A real check that runs node and exits with the given code. */
function nodeCheck(name: string, exitCode: number): QualityCheck {
  return {
    name,
    command: process.execPath,
    args: ['-e', `process.exit(${String(exitCode)})`],
    parse: () => [],
  };
}

const ZERO_COST: Cost = { tokens: 0, usd: 0 };

/** Scripted invoke: one fixed output, prompts captured. */
function scriptedInvoke(output: string, prompts: string[] = []): LoopInvoke {
  return (prompt) => {
    prompts.push(prompt);
    return Promise.resolve({ output, cost: ZERO_COST });
  };
}

describe('gateTool quality', () => {
  it('appends every quality-gate Verdict to the audit chain, and the chain verifies', async () => {
    const kern = freshKernloop();
    const verdict = await gateTool(
      kern,
      { gateName: 'quality', taskId: 'task-gate-1', workspaceDir: kern.paths.repoRoot },
      { checks: [nodeCheck('ok', 0)] },
    );
    expect(verdict.result).toBe('pass');
    const envelopes = readEnvelopes(kern.paths.audit);
    const publish = envelopes.find(
      (e) =>
        e.type === 'kernel.bus.publish' &&
        (e.payload as { contract: string }).contract === 'Verdict',
    );
    expect((publish?.payload as { messageId: string }).messageId).toBe('task-gate-1');
    const telemetry = envelopes.find((e) => e.type === 'cli.gate.verdict');
    expect(telemetry?.payload).toMatchObject({
      taskId: 'task-gate-1',
      gate: 'quality',
      result: 'pass',
    });
    expect(verifyChain(kern.store).ok).toBe(true);
    kern.close();
  });

  it('emits a fail Verdict (also audited) when a check fails', async () => {
    const kern = freshKernloop();
    const verdict = await gateTool(
      kern,
      { gateName: 'quality', taskId: 'task-gate-2', workspaceDir: kern.paths.repoRoot },
      { checks: [nodeCheck('broken', 1)] },
    );
    expect(verdict.result).toBe('fail');
    expect(verdict.findings.some((f) => f.severity === 'error')).toBe(true);
    const telemetry = readEnvelopes(kern.paths.audit).find((e) => e.type === 'cli.gate.verdict');
    expect((telemetry?.payload as { result: string }).result).toBe('fail');
    kern.close();
  });
});

describe('gateTool vote', () => {
  it('convenes the 3-voter panel over one shared compiled Brief and publishes the Verdict', async () => {
    const kern = freshKernloop();
    const prompts: string[] = [];
    const verdict = await gateTool(
      kern,
      { gateName: 'vote', taskId: 'task-vote-1', proposal: 'adopt the kernel eleven' },
      { invoke: scriptedInvoke('{"vote":"approve","reasoning":"sound"}', prompts) },
    );
    expect(verdict).toMatchObject({ taskId: 'task-vote-1', gate: 'vote', result: 'approve' });
    expect(verdict.voters?.map((v) => v.voter)).toEqual(['architect', 'security', 'scope-steward']);
    // every voter saw the same shared brief and the proposal (spec §8.3)
    expect(prompts).toHaveLength(3);
    for (const prompt of prompts) expect(prompt).toContain('adopt the kernel eleven');
    // the Verdict is audited and the observer ingested every voter record
    const telemetry = readEnvelopes(kern.paths.audit).find((e) => e.type === 'cli.gate.verdict');
    expect(telemetry?.payload).toMatchObject({
      gate: 'vote',
      result: 'approve',
      voters: ['architect', 'security', 'scope-steward'],
    });
    // the per-voter ballot is in the tamper-evident chain — WHO voted HOW, not
    // just the panel + aggregate (#345). Votes only; reasoning stays in observer.
    expect((telemetry?.payload as { ballots: unknown }).ballots).toEqual([
      { voter: 'architect', vote: 'approve' },
      { voter: 'security', vote: 'approve' },
      { voter: 'scope-steward', vote: 'approve' },
    ]);
    expect(kern.observer.voterSeries('architect')).toHaveLength(1);
    expect(kern.observer.voterSeries('architect')[0]).toMatchObject({
      gate: 'vote',
      vote: 'approve',
      taskId: 'task-vote-1',
    });
    expect(kern.observer.costPerGovernedDecision('vote')?.decisions).toBe(1);
    expect(verifyChain(kern.store).ok).toBe(true);
    kern.close();
  });

  it('records a malformed ballot as an honest abstain, never a coerced vote', async () => {
    const kern = freshKernloop();
    const verdict = await gateTool(
      kern,
      { gateName: 'vote', taskId: 'task-vote-2', proposal: 'p', panel: 3, strategy: 'unanimous' },
      { invoke: scriptedInvoke('I refuse to emit JSON') },
    );
    expect(verdict.result).not.toBe('approve'); // unanimity is unreachable on abstains
    expect(verdict.voters?.every((v) => v.vote === 'abstain')).toBe(true);
    kern.close();
  });
});

describe('gateTool review', () => {
  const REPORT = JSON.stringify({
    findings: [
      { severity: 'error', message: 'unvalidated input crosses a boundary', path: 'a.ts' },
    ],
    summary: 'one blocking correctness finding',
  });

  it('convenes the reviewer panel over an inline diff and rejects on an error finding', async () => {
    const kern = freshKernloop();
    const prompts: string[] = [];
    const verdict = await gateTool(
      kern,
      { gateName: 'review', taskId: 'task-rev-1', diff: '--- a/a.ts\n+++ b/a.ts\n+bad' },
      { invoke: scriptedInvoke(REPORT, prompts) },
    );
    expect(verdict).toMatchObject({ taskId: 'task-rev-1', gate: 'review', result: 'reject' });
    expect(verdict.voters?.map((v) => v.voter)).toEqual([
      'correctness',
      'security',
      'maintainability',
    ]);
    expect(prompts).toHaveLength(3);
    for (const prompt of prompts) expect(prompt).toContain('+++ b/a.ts');
    // findings carry per-reviewer attribution after the merge
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.message).toContain('reviewers:');
    // audited + ingested into the observer's series and cost ledger
    const telemetry = readEnvelopes(kern.paths.audit).find((e) => e.type === 'cli.gate.verdict');
    expect(telemetry?.payload).toMatchObject({ gate: 'review', result: 'reject' });
    expect(kern.observer.voterSeries('correctness')).toHaveLength(1);
    expect(kern.observer.costPerGovernedDecision('review')?.decisions).toBe(1);
    kern.close();
  });

  it('reads the diff from --diff-file and treats a reviewer parse failure as that reviewer abstaining', async () => {
    const kern = freshKernloop();
    const diffFile = path.join(kern.paths.repoRoot, 'change.diff');
    writeFileSync(diffFile, '--- a/b.ts\n+++ b/b.ts\n+ok\n', 'utf8');
    let call = 0;
    const invoke: LoopInvoke = () => {
      call += 1;
      // the first reviewer violates the contract; the other two report clean
      const output = call === 1 ? 'not json at all' : '{"findings":[],"summary":"clean"}';
      return Promise.resolve({ output, cost: ZERO_COST });
    };
    const verdict = await gateTool(
      kern,
      { gateName: 'review', taskId: 'task-rev-2', diffFile, context: 'tiny change' },
      { invoke },
    );
    expect(verdict.result).toBe('approve');
    const abstains = verdict.voters?.filter((v) => v.vote === 'abstain') ?? [];
    expect(abstains).toHaveLength(1);
    expect(abstains[0]?.reasoning).toContain('reviewer_error');
    kern.close();
  });

  it('requires exactly one of diff and diffFile', async () => {
    const kern = freshKernloop();
    await expect(
      gateTool(kern, { gateName: 'review', taskId: 't' }, { invoke: scriptedInvoke('{}') }),
    ).rejects.toThrow(/exactly one of diff or diffFile/);
    kern.close();
  });
});

describe('gateTool unknown gates', () => {
  it('rejects unknown gates with a typed error naming the three that exist', async () => {
    const kern = freshKernloop();
    await expect(gateTool(kern, { gateName: 'oracle' } as never)).rejects.toThrow(UnknownGateError);
    await expect(gateTool(kern, { gateName: 'oracle' } as never)).rejects.toThrow(
      /quality, vote, review/,
    );
    kern.close();
  });
});
