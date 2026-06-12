/**
 * Unit tests for the loop executors and the composition-root loop entry:
 * the 7-voter ratification panel, integrate's honest child aggregation,
 * decompose's corrupt-state guard, the overlay quality-timeout knob, the
 * resume guards, and the REAL default adapter invoke against a scripted
 * executable on PATH [CLM-0046 support].
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
import { BriefSchema, TaskContractSchema, type Cost, type Verdict } from '@kernloop/contracts';
import { PANEL_DEFAULT, type QualityCheck } from '@kernloop/faculty-gates';
import { emptyDiscoveredCache } from '@kernloop/faculty-models';
import { JsonlCheckpointStore, type ChildResult, type NodeContext } from '@kernloop/workflows';
import { createKernloop, type Kernloop } from '../kernel.js';
import { buildLoopExecutors, type LoopBindings, type LoopRefs } from './executors.js';
import { adapterInvoke, type LoopInvoke } from './invoke.js';
import { resolveServed, type NodeSeam } from './node-seam.js';
import {
  LoopResumeError,
  checkpointFile,
  executeCanonicalLoop,
  loadCheckpointTask,
} from './index.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-loop-exec-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Wrap a scripted invoke as a NodeSeam with honest served provenance (medium/medium on claude). */
function seamOf(invoke: LoopInvoke): NodeSeam {
  return {
    invoke,
    served: resolveServed({ tier: 'medium', effort: 'medium', capabilities: [] }, 'claude'),
  };
}

function kernloopFor(name: string, overlayYaml?: string): Kernloop {
  const repo = path.join(scratch, name);
  mkdirSync(path.join(repo, '.kernloop'), { recursive: true });
  if (overlayYaml !== undefined) {
    writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), overlayYaml);
  }
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

/** Scripted invoke for the direct executor tests (always approves). */
const scripted: LoopInvoke = (prompt) => {
  let output = 'Plan: do the thing.';
  if (prompt.includes('Diff under review')) {
    output = JSON.stringify({ findings: [], summary: 'clean' });
  } else if (prompt.includes('Investigate the prior art')) {
    output = 'Research: no prior-art conflicts; the change is self-contained.';
  } else if (prompt.includes('Proposal under vote')) {
    output = JSON.stringify({ vote: 'approve', reasoning: 'sound' });
  } else if (prompt.includes('"subtasks"')) {
    output = JSON.stringify({
      subtasks: [
        {
          goal: 'write the feature file',
          budget: { tokens: 1_000, usd: 0.01, wallClockMin: 5 },
          assignTo: 'coder',
        },
      ],
    });
  } else if (prompt.includes('"files"')) {
    output = JSON.stringify({ files: [{ path: 'src/feature.ts', content: 'export {};\n' }] });
  }
  return Promise.resolve({ output, cost: COST });
};

/** A trivially real quality check (the platform node binary, exit 0). */
const noop: QualityCheck = {
  name: 'noop',
  command: process.execPath,
  args: ['-e', 'process.exit(0)'],
  parse: () => [],
};

function bindingsFor(
  kern: Kernloop,
  refs: LoopRefs = {},
  invoke: LoopInvoke = scripted,
): LoopBindings {
  const workspaceDir = path.join(scratch, 'unit-ws');
  mkdirSync(workspaceDir, { recursive: true }); // quality checks spawn with cwd = workspace
  // Injected-invoke parity: every node resolves to the same injected invoke,
  // so a custom invoke reaches per-node executors too (the loop's
  // injected-invoke backward-compat contract, [CLM-0078]).
  return {
    kern,
    workspaceDir,
    invoke,
    invokeFor: () => seamOf(invoke),
    adapter: 'claude',
    refs,
    discovered: emptyDiscoveredCache('test'),
  };
}

function ctxFor(panel: 3 | 7): NodeContext {
  return {
    runId: 'run-unit',
    taskId: task.id,
    iteration: 0,
    config: {
      K: 3,
      gates: { vote: { strategy: 'unanimous', panel } },
      nodeOverrides: {},
    },
    node: 'vote',
    findings: [],
  };
}

const planBrief = BriefSchema.parse({
  taskId: task.id,
  sections: [
    { name: 'plan', content: 'the plan', tokens: 2, priority: 1, provenance: [{ ref: 'x' }] },
  ],
  budget: { allotted: 100, used: 2 },
  compilerVersion: 'unit',
});

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

describe('output-contract violations (diagnosability, one honest attempt)', () => {
  it('implement fails on an empty files array and preserves the raw output under checkpoints/', async () => {
    const kern = kernloopFor('implement-violation');
    const raw = 'Nothing to write for this "files" task.\n```json\n{"files":[],"notes":"n/a"}\n```';
    const invoke: LoopInvoke = () => Promise.resolve({ output: raw, cost: COST });
    const executors = buildLoopExecutors(bindingsFor(kern, {}, invoke));
    const child = { ...task, id: 'task-unit.1' };
    await expect(executors['implement']?.(child, ctxFor(3))).rejects.toThrow(
      'raw model output preserved at',
    );
    const file = path.join(
      kern.paths.dir,
      'checkpoints',
      'run-unit-implement-task-unit.1-violation.txt',
    );
    expect(readFileSync(file, 'utf8')).toBe(raw);
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
      'id: quality-timeout\ngates:\n  quality:\n    timeoutMsPerCheck: 60000\n',
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
    const invoke = adapterInvoke('claude', { PATH: bin });
    const result = await invoke('hello', { timeoutMs: 30_000 });
    expect(result.output).toBe('scripted reply');
    expect(result.cost.tokens).toBe(15);
    expect(result.cost.usd).toBe(0.002);
  });
});
