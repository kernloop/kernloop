/**
 * The advisory review gate (spec §6 child chain) and the Researcher-driven
 * research node (spec §5.7), as loop executors [CLM-0064, CLM-0067].
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BriefSchema,
  OutcomeSchema,
  TaskContractSchema,
  type Cost,
  type Verdict,
} from '@kernloop/contracts';
import type { ChildResult, NodeContext } from '@kernloop/workflows';
import { createKernloop, type Kernloop } from '../kernel.js';
import { buildLoopExecutors, type LoopBindings, type LoopRefs } from './executors.js';
import type { LoopInvoke } from './invoke.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-loop-gates-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function kernloopFor(name: string): Kernloop {
  const repo = path.join(scratch, name);
  mkdirSync(path.join(repo, '.kernloop'), { recursive: true });
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}

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

const COST: Cost = { tokens: 3, usd: 0.001 };

/** Scripted invoke: reviewers raise no findings; the Researcher returns prose. */
const scripted: LoopInvoke = (prompt) => {
  let output = 'Plan: do the thing.';
  if (prompt.includes('Diff under review')) {
    output = JSON.stringify({ findings: [], summary: 'clean' });
  } else if (prompt.includes('Investigate the prior art')) {
    output = 'Research: no prior-art conflicts; the change is self-contained.';
  }
  return Promise.resolve({ output, cost: COST });
};

function bindingsFor(kern: Kernloop, refs: LoopRefs = {}): LoopBindings {
  const workspaceDir = path.join(scratch, 'unit-ws');
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(path.join(workspaceDir, '.keep'), '');
  return {
    kern,
    workspaceDir,
    invokeFor: () => scripted,
    adapter: 'claude',
    refs,
  };
}

function reviewCtx(): NodeContext {
  return {
    runId: 'run-unit',
    taskId: task.id,
    iteration: 0,
    config: { K: 3, gates: { vote: { strategy: 'unanimous', panel: 3 } }, nodeOverrides: {} },
    node: 'review',
    child: task,
    findings: [],
  };
}

function ctx(): NodeContext {
  return { ...reviewCtx(), node: 'research', child: undefined };
}

function auditedGates(kern: Kernloop): string[] {
  return readFileSync(kern.paths.audit, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { type: string; payload: { gate?: string } })
    .filter((e) => e.type === 'cli.gate.verdict')
    .map((e) => e.payload.gate ?? '');
}

describe('review executor — advisory review gate in the loop [CLM-0064]', () => {
  it('reviews the child diff, returns an advisory Verdict, and audits it', async () => {
    const kern = kernloopFor('review-ok');
    const refs: LoopRefs = {
      writtenByChild: { [task.id]: [{ path: 'src/x.ts', content: 'export const x = 1;\n' }] },
    };
    const executors = buildLoopExecutors(bindingsFor(kern, refs));
    const verdict = (await executors['review']?.(undefined, reviewCtx())) as Verdict;
    expect(verdict.gate).toBe('review');
    expect(verdict.result).toBe('approve');
    expect(verdict.voters?.map((v) => v.voter)).toEqual([
      'correctness',
      'security',
      'maintainability',
    ]);
    expect(auditedGates(kern)).toContain('review');
    kern.close();
  });

  it('abstains honestly when no diff was stashed (a resume that landed after implement)', async () => {
    const kern = kernloopFor('review-empty');
    const executors = buildLoopExecutors(bindingsFor(kern, {}));
    const verdict = (await executors['review']?.(undefined, reviewCtx())) as Verdict;
    expect(verdict.result).toBe('abstain');
    expect(verdict.findings).toEqual([]);
    kern.close();
  });

  it('is advisory: a rejecting review does NOT block the child or the run', async () => {
    const kern = kernloopFor('review-advisory');
    const executors = buildLoopExecutors(bindingsFor(kern));
    const childId = 'task-unit.1';
    const verdictFor = (gate: string, result: Verdict['result']): Verdict => ({
      taskId: childId,
      gate,
      result,
      confidence: 1,
      findings: result === 'reject' ? [{ severity: 'error', message: 'nit' }] : [],
      cost: { tokens: 0, usd: 0 },
    });
    const results: ChildResult[] = [
      {
        child: { ...task, id: childId },
        output: OutcomeSchema.parse({
          taskId: childId,
          status: 'success',
          signals: [],
          cost: { tokens: 0, usd: 0 },
          traceRef: 'x',
          distillCandidates: [],
        }),
        verdict: verdictFor('quality', 'pass'),
        reviewVerdict: verdictFor('review', 'reject'),
      },
    ];
    const outcome = (await executors['integrate']?.(results, reviewCtx())) as {
      status: string;
      signals: Array<{ passed: boolean; detail: string }>;
    };
    expect(outcome.status).toBe('success');
    expect(outcome.signals[0]?.passed).toBe(true);
    expect(outcome.signals[0]?.detail).toContain('review reject (advisory)');
    kern.close();
  });
});

describe('research executor — folds Researcher findings into the Brief [CLM-0067]', () => {
  it('appends a research section carrying template:researcher provenance', async () => {
    const kern = kernloopFor('research');
    const executors = buildLoopExecutors(bindingsFor(kern));
    const brief = BriefSchema.parse(await executors['research']?.(task, ctx()));
    const research = brief.sections.find((s) => s.name === 'research');
    expect(research).toBeDefined();
    expect(research?.provenance.some((p) => p.ref === 'template:researcher')).toBe(true);
    kern.close();
  });
});
