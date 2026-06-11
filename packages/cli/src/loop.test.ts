/**
 * P2 exit criterion, end to end [CLM-0046]: the FULL canonical loop on a
 * real feature in a real repository — a real git repo with a real TypeScript
 * package, driven through the `run` tool with a SCRIPTED invoke (the honest
 * double for the external model CLI; everything downstream is real): plan →
 * 3 voters → PM decompose under the budget invariant → a coder child whose
 * emitted file the cli WRITES into the workspace → the REAL quality gate
 * (real tsc) → integrate → retrospect into SQLite memory. Checkpoints are
 * durable JSONL; the audit chain verifies; escalate/resume is proven at the
 * composition-root level [CLM-0043, CLM-0044].
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Cost } from '@kernloop/contracts';
import { verifyChain } from '@kernloop/kernel';
import { parseTscOutput, type QualityCheck } from '@kernloop/faculty-gates';
import { createKernloop, type Kernloop } from './kernel.js';
import { checkpointFile, type LoopInvoke, type LoopReport } from './loop/index.js';
import { runTool } from './tools/run.js';
import { statusTool } from './tools/status.js';
import { readEnvelopes } from './tools/audit.js';

/** The monorepo root's real TypeScript compiler (a root devDependency). */
const monoRoot = path.resolve(import.meta.dirname, '../../..');
const tscJs = createRequire(path.join(monoRoot, 'package.json')).resolve('typescript/lib/tsc.js');

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-loop-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A REAL repository: git-initialized, with a tiny real TypeScript package. */
function fixtureRepo(name: string, overlayYaml?: string): string {
  const repo = path.join(scratch, name);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: `fixture-${name}`, version: '0.0.0', type: 'module' }, null, 2),
  );
  writeFileSync(
    path.join(repo, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] }, null, 2),
  );
  writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const fixture = true;\n');
  if (overlayYaml !== undefined) {
    mkdirSync(path.join(repo, '.kernloop'), { recursive: true });
    writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), overlayYaml);
  }
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync(
    'git',
    ['-c', 'user.name=fixture', '-c', 'user.email=fixture@test', 'commit', '-q', '-m', 'seed'],
    { cwd: repo },
  );
  return repo;
}

function kernloopFor(repo: string): Kernloop {
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}

/** The fixture's real quality check: the monorepo's actual tsc binary. */
const typecheck: QualityCheck = {
  name: 'typecheck',
  command: process.execPath,
  args: [tscJs, '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'],
  parse: parseTscOutput,
};

const GREET_TS = 'export function greet(name: string): string {\n  return `hello ${name}`;\n}\n';
const BROKEN_TS =
  'export function greet(name: string): string {\n' +
  "  const broken: number = 'not a number';\n  return broken;\n}\n";

const COST: Cost = { tokens: 7, usd: 0.001 };

/**
 * The scripted model — an honest double for the external CLI, dispatching
 * on the prompts the REAL executors assemble. `vote` is consulted once per
 * voter; `files` is what the coder "writes".
 */
function scriptedInvoke(script: {
  vote: () => 'approve' | 'reject';
  files: Array<{ path: string; content: string }>;
}): LoopInvoke {
  return (prompt) => {
    let output: string;
    if (prompt.includes('Diff under review')) {
      // Advisory reviewer: no blocking findings → the review gate approves.
      output = JSON.stringify({ findings: [], summary: 'no blocking issues found' });
    } else if (prompt.includes('Investigate the prior art')) {
      // The Researcher template's findings, folded into the Brief.
      output = 'Research: greet() is a small typed function; no prior-art conflicts.';
    } else if (prompt.includes('Proposal under vote')) {
      const vote = script.vote();
      const reasoning = vote === 'approve' ? 'sound, scoped plan' : 'scope is too vague to ship';
      output = `My ballot follows.\n${JSON.stringify({ vote, reasoning })}`;
    } else if (prompt.includes('"subtasks"')) {
      output = JSON.stringify({
        subtasks: [
          {
            goal: 'implement the greet feature in src/greet.ts',
            budget: { tokens: 1_000, usd: 0.01, wallClockMin: 5 },
            assignTo: 'coder',
          },
        ],
      });
    } else if (prompt.includes('"files"')) {
      output = `Change set:\n${JSON.stringify({ files: script.files, notes: 'adds greet()' })}`;
    } else {
      output = 'Plan: add src/greet.ts exporting a typed greet(name); verify with tsc.';
    }
    return Promise.resolve({ output, cost: COST });
  };
}

const MAIN_TRACE = [
  'frame',
  'research',
  'plan',
  'vote',
  'decompose',
  'implement',
  'quality',
  'review',
  'integrate',
  'retrospect',
];

describe('P2 exit: the full canonical loop on a real feature in a real repo', () => {
  it('runs the full canonical loop on a real feature in a real repo: vote and quality gates, checkpoints, audit, memory', async () => {
    const repo = fixtureRepo('pass');
    const kern = kernloopFor(repo);
    const invoke = scriptedInvoke({
      vote: () => 'approve',
      files: [{ path: 'src/greet.ts', content: GREET_TS }],
    });

    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'task-loop-pass',
      },
      { checks: [typecheck], invoke },
    );

    // The run completed and the Outcome is an honest success
    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.status).toBe('success');
    expect(result.outcome.cost.tokens).toBeGreaterThan(0); // metered through the one seam
    const report = result.data as LoopReport;
    expect(report.status).toBe('completed');
    expect(report.nodeTrace.map((t) => t.node)).toEqual(MAIN_TRACE);
    expect(report.outcome?.signals).toEqual([
      {
        name: 'child:task-loop-pass.1',
        passed: true,
        detail: 'implement success; quality pass; review approve (advisory)',
      },
    ]);
    expect(report.outcome?.distillCandidates).toEqual([`loop:${report.runId}`]);

    // The real feature file exists in the real repo and compiled under real tsc
    expect(readFileSync(path.join(repo, 'src', 'greet.ts'), 'utf8')).toBe(GREET_TS);

    // Checkpoints: durable JSONL, one line per completed node
    const checkpoints = readFileSync(checkpointFile(kern.paths.dir, report.runId), 'utf8');
    expect(checkpoints.trim().split('\n')).toHaveLength(MAIN_TRACE.length);

    // Audit: the chain verifies and carries all three gate verdicts
    // (vote + quality + the advisory review).
    expect(verifyChain(kern.store).ok).toBe(true);
    const gateEvents = readEnvelopes(kern.paths.audit)
      .filter((e) => e.type === 'cli.gate.verdict')
      .map((e) => e.payload as { gate: string; result: string });
    expect(gateEvents).toEqual([
      {
        gate: 'vote',
        result: 'approve',
        findings: 0,
        taskId: 'task-loop-pass',
        voters: ['architect', 'security', 'scope-steward'],
        wallClockMs: expect.any(Number) as number,
      },
      {
        gate: 'quality',
        result: 'pass',
        findings: 0,
        taskId: 'task-loop-pass.1',
        voters: [],
        wallClockMs: expect.any(Number) as number,
      },
      {
        gate: 'review',
        result: 'approve',
        findings: 0,
        taskId: 'task-loop-pass.1',
        voters: ['correctness', 'security', 'maintainability'],
        wallClockMs: expect.any(Number) as number,
      },
    ]);

    // Memory: the episodic trace is retrievable and retrospect left semantic facts
    const status = statusTool(kern, { taskId: 'task-loop-pass' });
    expect(status.found).toBe(true);
    const facts = kern.memory.recallFacts('loop task-loop-pass');
    expect(facts.some((f) => f.provenance === 'loop:retrospect')).toBe(true);
    kern.close();
  }, 120_000);

  it('escalates after K rejected votes with findings, then resumes from the checkpoint to completion', async () => {
    const repo = fixtureRepo('resume', 'id: fixture-resume\nK: 1\n');
    const kern = kernloopFor(repo);

    const rejected = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'task-loop-resume',
      },
      {
        checks: [typecheck],
        invoke: scriptedInvoke({ vote: () => 'reject', files: [] }),
      },
    );

    // Escalation is its OWN status, with the rejecting voters' findings
    expect(rejected.kind).toBe('escalated');
    if (rejected.kind !== 'escalated') throw new Error('expected escalated');
    expect(rejected.findings.length).toBeGreaterThan(0);
    expect(rejected.outcome.status).toBe('partial'); // never disguised as success
    const escalatedReport = rejected.data as LoopReport;
    // K=1: plan→vote, one rejected re-entry, then HALT at the bound
    expect(escalatedReport.nodeTrace.map((t) => t.node)).toEqual([
      'frame',
      'research',
      'plan',
      'vote',
      'plan',
      'vote',
    ]);
    expect(existsSync(path.join(repo, 'src', 'greet.ts'))).toBe(false);

    // The human "edits the plan inputs", then resumes the SAME run id
    const resumed = await runTool(
      kern,
      {
        capability: 'workflow.canonical',
        workspaceDir: repo,
        resume: rejected.runId,
      },
      {
        checks: [typecheck],
        invoke: scriptedInvoke({
          vote: () => 'approve',
          files: [{ path: 'src/greet.ts', content: GREET_TS }],
        }),
      },
    );

    expect(resumed.kind).toBe('outcome');
    if (resumed.kind !== 'outcome') throw new Error('expected outcome');
    expect(resumed.outcome.status).toBe('success');
    expect(resumed.task.id).toBe('task-loop-resume'); // the checkpointed task is the truth
    const resumedReport = resumed.data as LoopReport;
    expect(resumedReport.runId).toBe(rejected.runId);
    // The cumulative trace keeps the pre-escalation history and continues from plan
    expect(resumedReport.nodeTrace.map((t) => t.node)).toEqual([
      ...escalatedReport.nodeTrace.map((t) => t.node),
      'plan',
      'vote',
      'decompose',
      'implement',
      'quality',
      'review',
      'integrate',
      'retrospect',
    ]);
    expect(readFileSync(path.join(repo, 'src', 'greet.ts'), 'utf8')).toBe(GREET_TS);
    expect(verifyChain(kern.store).ok).toBe(true);
    kern.close();
  }, 120_000);

  it('propagates a child quality failure honestly: the loop completes with a failure Outcome', async () => {
    const repo = fixtureRepo('fail');
    const kern = kernloopFor(repo);

    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'task-loop-fail',
      },
      {
        checks: [typecheck],
        invoke: scriptedInvoke({
          vote: () => 'approve',
          files: [{ path: 'src/greet.ts', content: BROKEN_TS }],
        }),
      },
    );

    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.status).toBe('failure');
    const report = result.data as LoopReport;
    expect(report.status).toBe('completed'); // the loop ran to retrospect; the WORK failed
    expect(report.outcome?.status).toBe('failure');
    expect(report.outcome?.signals).toEqual([
      {
        name: 'child:task-loop-fail.1',
        passed: false,
        detail: 'implement success; quality fail; review approve (advisory)',
      },
    ]);
    expect(report.outcome?.distillCandidates).toEqual([]);
    const trace = statusTool(kern, { taskId: 'task-loop-fail' });
    expect(trace.found && trace.trace.status === 'failure').toBe(true);
    kern.close();
  }, 120_000);

  it('fails the run on a malformed PM decomposition: typed executor error, no fabricated children', async () => {
    const repo = fixtureRepo('parsefail');
    const kern = kernloopFor(repo);
    const invoke: LoopInvoke = (prompt) =>
      Promise.resolve({
        output: prompt.includes('Proposal under vote')
          ? JSON.stringify({ vote: 'approve', reasoning: 'ok' })
          : 'no JSON object here at all',
        cost: COST,
      });

    const result = await runTool(
      kern,
      {
        goal: 'add a greet feature',
        capability: 'workflow.canonical',
        workspaceDir: repo,
        id: 'task-loop-parsefail',
      },
      { checks: [typecheck], invoke },
    );

    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.status).toBe('failure');
    const report = result.data as LoopReport;
    expect(report.status).toBe('failed');
    expect(report.error?.code).toBe('executor_failed');
    expect(report.error?.message).toContain('subtasks');
    kern.close();
  }, 60_000);

  it('rejects --resume for a capability other than workflow.canonical and for an unknown run id', async () => {
    const repo = fixtureRepo('resume-errors');
    const kern = kernloopFor(repo);
    await expect(
      runTool(kern, { capability: 'gate.quality', resume: 'run-x', workspaceDir: repo }),
    ).rejects.toThrow('workflow.canonical');
    await expect(
      runTool(kern, { capability: 'workflow.canonical', resume: 'run-x', workspaceDir: repo }),
    ).rejects.toThrow('no checkpoint found for run "run-x"');
    kern.close();
  }, 60_000);

  it('requires a workspaceDir: the loop has nowhere honest to implement without one', async () => {
    const repo = fixtureRepo('no-workspace');
    const kern = kernloopFor(repo);
    await expect(
      runTool(
        kern,
        { goal: 'g', capability: 'workflow.canonical' },
        { invoke: scriptedInvoke({ vote: () => 'approve', files: [] }) },
      ),
    ).rejects.toThrow('workspaceDir');
    kern.close();
  }, 60_000);
});
