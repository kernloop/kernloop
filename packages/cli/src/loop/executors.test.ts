/**
 * Unit tests for the loop executors + the composition-root loop entry: the
 * 7-voter panel, integrate's honest child aggregation, decompose's corrupt-state
 * guard, the quality-timeout knob, resume guards, the implement parse-retry
 * (#130), and the REAL default adapter invoke on PATH [CLM-0046 support].
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type Verdict } from '@kernloop/contracts';
import { type AdapterName } from '@kernloop/kernel';
import { PANEL_DEFAULT } from '@kernloop/faculty-gates';
import { resolveServed, type NodeSeam } from './node-seam.js';
import { readEnvelopes } from '../tools/audit.js';
import { JsonlCheckpointStore, type ChildResult } from '@kernloop/workflows';
import { buildLoopExecutors, type LoopRefs } from './executors.js';
import { adapterInvoke, type LoopInvoke } from './invoke.js';
import {
  LoopResumeError,
  checkpointFile,
  executeCanonicalLoop,
  loadCheckpointTask,
} from './index.js';
import {
  COST,
  boundHelpers,
  ctxFor,
  noop,
  planBrief,
  scripted,
  task,
} from './executors.testkit.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-loop-exec-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const { kernloopFor, bindingsFor } = boundHelpers(scratch);

describe('frame executor', () => {
  it('mechanically normalizes the task: trims the goal and dedupes constraints', async () => {
    const kern = kernloopFor('frame');
    const refs: LoopRefs = {};
    const executors = buildLoopExecutors(bindingsFor(kern, refs));
    const framed = (await executors['frame']?.(
      { ...task, goal: '  add a greet feature  ', constraints: ['small', 'small', 'typed'] },
      ctxFor(3),
    )) as { goal: string; constraints: string[] };
    expect(framed.goal).toBe('add a greet feature');
    expect(framed.constraints).toEqual(['small', 'typed']);
    expect(refs.framedTask).toEqual(framed); // decompose's parent is the framed task
    kern.close();
  });
});

describe('vote executor', () => {
  it('convenes the 7-voter ratification panel when the overlay says panel 7, sharing the plan brief as fallback', async () => {
    const kern = kernloopFor('vote7');
    const executors = buildLoopExecutors(bindingsFor(kern)); // refs empty: brief fallback branch
    const verdict = (await executors['vote']?.(planBrief, ctxFor(7))) as Verdict;
    expect(verdict.result).toBe('approve');
    expect(verdict.voters).toHaveLength(7);
    kern.close();
  });

  it('convenes the default 3-voter panel otherwise', async () => {
    const kern = kernloopFor('vote3');
    const executors = buildLoopExecutors(bindingsFor(kern));
    const verdict = (await executors['vote']?.(planBrief, ctxFor(3))) as Verdict;
    expect(verdict.voters).toHaveLength(3);
    kern.close();
  });

  const req = { tier: 'large' as const, effort: 'high' as const, capabilities: [] };
  const seamForAdapter = (name: AdapterName): NodeSeam => ({
    invoke: scripted,
    served: resolveServed(req, name),
  });

  it('convenes a PROVIDER-DIVERSE panel-7: distinct served per voter, no single-oracle (#369)', async () => {
    const kern = kernloopFor('vote-diverse');
    const bindings = {
      ...bindingsFor(kern),
      voteDiversity: { adapters: ['claude', 'codex', 'gemini'] as AdapterName[], seamForAdapter },
    };
    const verdict = (await buildLoopExecutors(bindings)['vote']?.(planBrief, ctxFor(7))) as Verdict;
    expect(verdict.voters).toHaveLength(7);
    // Each voter's ballot is stamped with the model class that cast it, and the
    // round-robin produced ≥2 distinct classes — genuinely independent.
    const families = new Set(verdict.voters?.map((v) => v.served?.family));
    expect(families.size).toBeGreaterThanOrEqual(2);
    expect(verdict.findings.some((f) => f.message.includes('SINGLE-ORACLE'))).toBe(false);
    kern.close();
  });

  it('DEGRADES a panel-7 with one adapter: single-oracle finding + audit (#369)', async () => {
    const kern = kernloopFor('vote-degraded');
    const bindings = {
      ...bindingsFor(kern),
      voteDiversity: { adapters: ['claude'] as AdapterName[], seamForAdapter },
    };
    const verdict = (await buildLoopExecutors(bindings)['vote']?.(planBrief, ctxFor(7))) as Verdict;
    // All ballots collapse to one class ⇒ a visible single-oracle warn finding…
    expect(verdict.findings.some((f) => f.message.includes('SINGLE-ORACLE'))).toBe(true);
    // …and a rule-7 audit so the non-independence is recorded, never silent.
    const events = readEnvelopes(path.join(kern.paths.dir, 'audit.jsonl')).filter(
      (e) => e.type === 'cli.vote.single-oracle-degraded',
    );
    expect(events).toHaveLength(1);
    kern.close();
  });

  it('panel-3 loop votes stay single-adapter (no served, no diversity finding) even with diversity available', async () => {
    const kern = kernloopFor('vote3-nodiv');
    const bindings = {
      ...bindingsFor(kern),
      voteDiversity: { adapters: ['claude', 'gemini'] as AdapterName[], seamForAdapter },
    };
    const verdict = (await buildLoopExecutors(bindings)['vote']?.(planBrief, ctxFor(3))) as Verdict;
    expect(verdict.voters?.every((v) => v.served === undefined)).toBe(true);
    expect(verdict.findings.some((f) => f.message.includes('#369'))).toBe(false);
    kern.close();
  });
});

describe('integrate executor', () => {
  it('aggregates child failures honestly: an errored child and a verdict-less child both fail the run', async () => {
    const kern = kernloopFor('integrate');
    const executors = buildLoopExecutors(bindingsFor(kern));
    const passVerdict: Verdict = {
      taskId: 'task-unit.2',
      gate: 'quality',
      result: 'pass',
      confidence: 1,
      findings: [],
      cost: { tokens: 0, usd: 0 },
    };
    const results: ChildResult[] = [
      { child: { ...task, id: 'task-unit.1' }, error: 'implement blew up' },
      { child: { ...task, id: 'task-unit.2' }, verdict: passVerdict }, // quality ran, implement output missing
    ];
    const outcome = (await executors['integrate']?.(results, ctxFor(3))) as {
      status: string;
      signals: Array<{ name: string; passed: boolean; detail: string }>;
    };
    expect(outcome.status).toBe('failure');
    expect(outcome.signals).toEqual([
      { name: 'child:task-unit.1', passed: false, detail: 'implement blew up' },
      { name: 'child:task-unit.2', passed: false, detail: 'implement missing; quality pass' },
    ]);
    kern.close();
  });
});

describe('output-contract violations (diagnosability; implement retries once, #130)', () => {
  it('implement fails on a persistently empty files array (both attempts) and preserves the raw output', async () => {
    const kern = kernloopFor('implement-violation');
    const raw = 'Nothing to write.\n```json\n{"files":[],"notes":"n/a"}\n```';
    let calls = 0;
    const invoke: LoopInvoke = () => ((calls += 1), Promise.resolve({ output: raw, cost: COST }));
    const executors = buildLoopExecutors(bindingsFor(kern, {}, invoke));
    await expect(
      executors['implement']?.({ ...task, id: 'task-unit.1' }, ctxFor(3)),
    ).rejects.toThrow('raw model output preserved at');
    expect(calls).toBe(2); // one retry on the contract failure (#130)
    const file = path.join(
      kern.paths.dir,
      'checkpoints',
      'run-unit-implement-task-unit.1-violation.txt',
    );
    expect(readFileSync(file, 'utf8')).toBe(raw);
    kern.close();
  });

  it('implement RECOVERS when attempt 1 is prose-wrapped and the retry emits clean JSON (#130)', async () => {
    const kern = kernloopFor('implement-retry');
    const clean = '{"files":[{"path":"out.ts","content":"export const x = 1;"}],"notes":"ok"}';
    let calls = 0;
    const invoke: LoopInvoke = () =>
      Promise.resolve({
        output: (calls += 1) === 1 ? 'files: cli.ts { return x } …' : clean,
        cost: COST,
      });
    const executors = buildLoopExecutors(bindingsFor(kern, {}, invoke));
    const out = await executors['implement']?.({ ...task, id: 'r.1' }, ctxFor(3));
    const outcome = out as { status: string; cost: { tokens: number } };
    expect(calls).toBe(2);
    expect(outcome.status).toBe('success');
    expect(outcome.cost.tokens).toBe(COST.tokens * 2); // both attempts metered
    kern.close();
  });

  it('vote records honest abstains on malformed ballots and preserves each voter raw output', async () => {
    const kern = kernloopFor('vote-violation');
    const raw = 'I refuse to emit JSON.';
    const invoke: LoopInvoke = (prompt) =>
      Promise.resolve({
        output: prompt.includes('Proposal under vote') ? raw : 'unused',
        cost: COST,
      });
    const executors = buildLoopExecutors(bindingsFor(kern, {}, invoke));
    const verdict = (await executors['vote']?.(planBrief, ctxFor(3))) as Verdict;
    expect(verdict.result).not.toBe('approve'); // abstains never become approval
    for (const voter of PANEL_DEFAULT) {
      const file = path.join(
        kern.paths.dir,
        'checkpoints',
        `run-unit-vote-${voter.name}-violation.txt`,
      );
      expect(readFileSync(file, 'utf8')).toBe(raw);
    }
    kern.close();
  });
});

describe('hardened prompts (data, diff-reviewable)', () => {
  it('the coder and decompose prompts demand one raw JSON object and concrete file changes', async () => {
    const kern = kernloopFor('prompt-harden');
    const prompts: string[] = [];
    const invoke: LoopInvoke = (prompt) => {
      prompts.push(prompt);
      return scripted(prompt);
    };
    const refs: LoopRefs = { framedTask: task, planBrief };
    const executors = buildLoopExecutors(bindingsFor(kern, refs, invoke));
    await executors['decompose']?.({}, ctxFor(3));
    await executors['implement']?.({ ...task, id: 'task-unit.1' }, ctxFor(3));
    const [decompose, implement] = prompts;
    expect(decompose).toContain('ONLY one raw JSON object');
    expect(decompose).toContain('concrete file changes');
    expect(implement).toContain('no markdown fences');
    expect(implement).toContain('"files" MUST contain at least one entry');
    kern.close();
  });
});

describe('decompose executor', () => {
  it('refuses to decompose without the framed task and plan (corrupt resume state)', async () => {
    const kern = kernloopFor('decompose-guard');
    const executors = buildLoopExecutors(bindingsFor(kern, {}));
    await expect(executors['decompose']?.({}, ctxFor(3))).rejects.toThrow(
      'decompose reached without framed task + plan',
    );
    kern.close();
  });
});

describe('quality executor', () => {
  it('threads the overlay gates.quality.timeoutMsPerCheck knob into the real gate', async () => {
    const kern = kernloopFor(
      'quality-timeout',
      'id: quality-timeout\ngates:\n  quality:\n    timeoutMsPerCheck: 60000\n    sandbox:\n      enabled: false\n',
    );
    const executors = buildLoopExecutors({ ...bindingsFor(kern), checks: [noop] });
    const verdict = (await executors['quality']?.({}, ctxFor(3))) as Verdict;
    expect(verdict.result).toBe('pass');
    expect(verdict.taskId).toBe(task.id); // no child in ctx: the parent id is judged
    kern.close();
  });
});

describe('executeCanonicalLoop entry', () => {
  it('throws the typed resume error when the run id has no checkpoint', async () => {
    const kern = kernloopFor('resume-missing');
    await expect(
      executeCanonicalLoop(kern, {
        task,
        workspaceDir: path.join(scratch, 'ws-missing'),
        invoke: scripted,
        resumeRunId: 'run-ghost',
      }),
    ).rejects.toThrowError(LoopResumeError);
    expect(await loadCheckpointTask(kern, 'run-ghost')).toBeUndefined();
    kern.close();
  });

  it('honors a caller-chosen runId and checkpoints under <overlay>/checkpoints/<runId>.jsonl', async () => {
    const kern = kernloopFor('fixed-runid');
    const report = await executeCanonicalLoop(kern, {
      task,
      workspaceDir: path.join(scratch, 'ws-fixed'),
      invoke: scripted,
      runId: 'run-fixed',
      checks: [noop],
    });
    expect(report.status).toBe('completed');
    expect(report.runId).toBe('run-fixed');
    expect(existsSync(checkpointFile(kern.paths.dir, 'run-fixed'))).toBe(true);
    expect(await loadCheckpointTask(kern, 'run-fixed')).toEqual(task);
    kern.close();
  });

  it('resumes from a checkpoint whose values carry no primed refs by re-running from the cursor', async () => {
    const kern = kernloopFor('resume-bare');
    const store = new JsonlCheckpointStore(checkpointFile(kern.paths.dir, 'run-bare'));
    await store.save({
      runId: 'run-bare',
      seq: 1,
      node: 'frame',
      iteration: 0,
      createdAt: new Date().toISOString(),
      state: {
        task,
        status: 'running',
        cursor: { phase: 'main', node: 'frame' },
        iteration: 0,
        values: {},
        findings: [],
        children: [],
        childResults: [],
        trace: [{ seq: 1, node: 'frame', iteration: 0 }],
      },
    });
    const report = await executeCanonicalLoop(kern, {
      task,
      workspaceDir: path.join(scratch, 'ws-bare'),
      invoke: scripted,
      resumeRunId: 'run-bare',
      checks: [noop],
    });
    expect(report.status).toBe('completed');
    expect(report.outcome?.status).toBe('success');
    kern.close();
  });
});

describe('adapterInvoke (the default model seam)', () => {
  it('runs the adapter CLI as a real subprocess and returns its parsed output and metered cost', async () => {
    const bin = path.join(scratch, 'fake-bin');
    mkdirSync(bin, { recursive: true });
    const fake = path.join(bin, 'claude');
    const reply = JSON.stringify({
      type: 'result',
      is_error: false,
      result: 'scripted reply',
      usage: { input_tokens: 11, output_tokens: 4 },
      total_cost_usd: 0.002,
    });
    writeFileSync(fake, `#!/bin/sh\ncat > /dev/null\necho '${reply}'\n`);
    chmodSync(fake, 0o755);
    const invoke = adapterInvoke('claude', { PATH: bin }, scratch); // cwd = workspace (#146)
    const result = await invoke('hello', { timeoutMs: 30_000 });
    expect(result.output).toBe('scripted reply');
    expect(result.cost.tokens).toBe(15);
    expect(result.cost.usd).toBe(0.002);
  });
});
