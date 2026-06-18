/**
 * The advisory review gate (spec §6 child chain) and the Researcher-driven
 * research node (spec §5.8), as loop executors [CLM-0064, CLM-0067].
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
import { emptyDiscoveredCache } from '@kernloop/faculty-models';
import { createKernloop, type Kernloop } from '../kernel.js';
import { buildLoopExecutors, type LoopBindings, type LoopRefs } from './executors.js';
import type { LoopInvoke } from './invoke.js';
import { nodeRequirement } from './node-model.js';
import { resolveServed } from './node-seam.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-loop-gates-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function kernloopFor(name: string, overlayYaml?: string): Kernloop {
  const repo = path.join(scratch, name);
  mkdirSync(path.join(repo, '.kernloop'), { recursive: true });
  if (overlayYaml !== undefined)
    writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), overlayYaml);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}

/** Overlay opting IN to the goal-fidelity (groundedness) review — default off (#226 item 3). */
const GROUNDEDNESS_ON = 'id: unit\ngates:\n  review:\n    groundedness: true\n';

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

function bindingsFor(
  kern: Kernloop,
  refs: LoopRefs = {},
  invoke: LoopInvoke = scripted,
): LoopBindings {
  const workspaceDir = path.join(scratch, 'unit-ws');
  mkdirSync(workspaceDir, { recursive: true });
  writeFileSync(path.join(workspaceDir, '.keep'), '');
  return {
    kern,
    workspaceDir,
    invoke,
    invokeFor: () => ({
      invoke,
      served: resolveServed({ tier: 'medium', effort: 'medium', capabilities: [] }, 'claude'),
    }),
    adapter: 'claude',
    refs,
    discovered: emptyDiscoveredCache('test'),
    totals: { tokens: 0, usd: 0 },
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
  it('threads the child GOAL + acceptance criteria into the review context (#226 item 3)', async () => {
    const kern = kernloopFor('review-grounded', GROUNDEDNESS_ON); // opt in to the goal-fidelity lens
    const child = TaskContractSchema.parse({
      ...task,
      goal: 'add a greet feature returning hello',
      definitionOfDone: [{ name: 'acc', command: 'node verify.mjs' }],
    });
    const refs: LoopRefs = {
      writtenByChild: { [child.id]: [{ path: 'src/x.ts', content: 'export const x = 1;\n' }] },
    };
    const prompts: string[] = [];
    const capture: LoopInvoke = (prompt) => {
      prompts.push(prompt);
      return Promise.resolve({
        output: JSON.stringify({ findings: [], summary: 'clean' }),
        cost: COST,
      });
    };
    const executors = buildLoopExecutors(bindingsFor(kern, refs, capture));
    await executors['review']?.(undefined, { ...reviewCtx(), child });
    // EVERY reviewer prompt carries the goal so a goal-fidelity judgment is possible…
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) expect(p).toContain('add a greet feature returning hello');
    // …and the groundedness reviewer specifically sees the acceptance criteria it must cite.
    const grounded = prompts.find((p) => p.includes('groundedness reviewer'));
    expect(grounded).toBeDefined();
    expect(grounded).toContain('## Goal');
    expect(grounded).toContain('## Acceptance criteria');
    expect(grounded).toContain('acc: node verify.mjs');
    kern.close();
  });

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

  it('is advisory but SURFACED: a rejecting review adds a needs-review signal without failing the run (#226 item 5)', async () => {
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
      signals: Array<{ name: string; passed: boolean; detail: string }>;
    };
    // The run still SUCCEEDS (review is advisory, never auto-fails) …
    expect(outcome.status).toBe('success');
    expect(outcome.signals[0]?.passed).toBe(true);
    expect(outcome.signals[0]?.detail).toContain('review reject (advisory)');
    // … but the reject is now SURFACED as a non-blocking needs-review signal (#226 item 5),
    // carrying the child id and the concrete review finding — visible at the terminal.
    const needsReview = outcome.signals.find((s) => s.name === 'needs-review');
    expect(needsReview).toBeDefined();
    expect(needsReview?.passed).toBe(false);
    expect(needsReview?.detail).toContain(childId);
    expect(needsReview?.detail).toContain('nit');
    kern.close();
  });

  it('emits NO needs-review signal when the review approves (#226 item 5)', async () => {
    const kern = kernloopFor('review-clean');
    const executors = buildLoopExecutors(bindingsFor(kern));
    const childId = 'task-unit.1';
    const cleanVerdict = (gate: string, result: Verdict['result']): Verdict => ({
      taskId: childId,
      gate,
      result,
      confidence: 1,
      findings: [],
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
        verdict: cleanVerdict('quality', 'pass'),
        reviewVerdict: cleanVerdict('review', 'approve'),
      },
    ];
    const outcome = (await executors['integrate']?.(results, reviewCtx())) as {
      status: string;
      signals: Array<{ name: string }>;
    };
    expect(outcome.status).toBe('success');
    expect(outcome.signals.some((s) => s.name === 'needs-review')).toBe(false);
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

  it('provenance names the SERVED model+effort the node derived [CLM-0078]', async () => {
    const kern = kernloopFor('research-served');
    // Per-node seam over the scripted base: research derives from the Researcher
    // template (large/high) → claude opus, so the served ref names opus@high.
    const b = bindingsFor(kern);
    const served: LoopBindings = {
      ...b,
      invokeFor: (node) => ({
        invoke: scripted,
        served: resolveServed(nodeRequirement(node), 'claude'),
      }),
    };
    const brief = BriefSchema.parse(await buildLoopExecutors(served)['research']?.(task, ctx()));
    const research = brief.sections.find((s) => s.name === 'research');
    expect(research?.provenance.some((p) => p.ref === 'model:claude/opus@high')).toBe(true);
    kern.close();
  });

  it('provenance also names the NORMALIZED served identity (table hit) [CLM-0081]', async () => {
    const kern = kernloopFor('research-identity');
    // research → Researcher template (large) → claude opus alias, which the
    // vendored catalog resolves to the claude-opus class @4.8/large by TABLE.
    const b = bindingsFor(kern);
    const served: LoopBindings = {
      ...b,
      invokeFor: (node) => ({
        invoke: scripted,
        served: resolveServed(nodeRequirement(node), 'claude'),
      }),
    };
    const brief = BriefSchema.parse(await buildLoopExecutors(served)['research']?.(task, ctx()));
    const research = brief.sections.find((s) => s.name === 'research');
    expect(
      research?.provenance.some((p) => p.ref === 'identity:claude-opus@4.8/large(table)'),
    ).toBe(true);
    kern.close();
  });

  it('a harness-default served model normalizes to an honest unknown identity [CLM-0081]', async () => {
    const kern = kernloopFor('research-identity-default');
    // codex ships no tier alias → the served model is '' (harness default):
    // kernloop pinned no model, so the identity is honestly unknown, not guessed.
    const b = bindingsFor(kern);
    const served: LoopBindings = {
      ...b,
      invokeFor: (node) => ({
        invoke: scripted,
        served: resolveServed(nodeRequirement(node), 'codex'),
      }),
    };
    const brief = BriefSchema.parse(await buildLoopExecutors(served)['research']?.(task, ctx()));
    const research = brief.sections.find((s) => s.name === 'research');
    expect(research?.provenance.some((p) => p.ref === 'identity:unknown(unknown)')).toBe(true);
    expect(research?.provenance.some((p) => p.ref.startsWith('identity:'))).toBe(true);
    kern.close();
  });
});

describe('the quality node runs the child task’s definition-of-done (#226)', () => {
  /** A quality node whose ONLY checks are the child's DoD (base checks suppressed). */
  function qualityWith(kern: Kernloop) {
    return buildLoopExecutors({ ...bindingsFor(kern), checks: [] })['quality'];
  }
  const childWithDod = (id: string, command: string) =>
    TaskContractSchema.parse({ ...task, id, definitionOfDone: [{ name: 'acc', command }] });

  it('fails the verdict when the child’s acceptance command fails', async () => {
    const kern = kernloopFor('dod-loop-fail');
    const child = childWithDod('task-unit.dod', 'false');
    const verdict = (await qualityWith(kern)?.(undefined, {
      ...reviewCtx(),
      node: 'quality',
      child,
    })) as Verdict;
    expect(verdict.result).toBe('fail');
    expect(verdict.findings.some((f) => f.message.includes('dod:acc'))).toBe(true);
    kern.close();
  });

  it('passes when the child’s acceptance command passes', async () => {
    const kern = kernloopFor('dod-loop-pass');
    const child = childWithDod('task-unit.dod', 'true');
    const verdict = (await qualityWith(kern)?.(undefined, {
      ...reviewCtx(),
      node: 'quality',
      child,
    })) as Verdict;
    expect(verdict.result).toBe('pass');
    kern.close();
  });
});
