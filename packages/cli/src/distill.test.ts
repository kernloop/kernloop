/**
 * Tests for `distill` [CLM-0049] and the procedural-library ratification
 * path it enforces [CLM-0050]: a real recorded trace in a temp overlay, a
 * scripted invoke (an honest double for the external model CLI — everything
 * downstream of the seam is real), and structural proof that runtime code
 * can write proposals only, never the live skills library.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { TaskContractSchema, type Cost } from '@kernloop/contracts';
import * as memoryExports from '@kernloop/faculty-memory';
import { JsonlCheckpointStore } from '@kernloop/workflows';
import { createKernloop, type Kernloop } from './kernel.js';
import {
  SKILL_NAME_MAX,
  SkillNameError,
  TraceNotFoundError,
  distillFromTrace,
  proposedSkillsRoot,
  resolveProposalDir,
} from './distill.js';
import * as cliExports from './index.js';
import { LoopParseError, checkpointFile, type LoopInvoke } from './loop/index.js';
import { readEnvelopes } from './tools/audit.js';
import { runTool } from './tools/run.js';

const dirs: string[] = [];
function repoDir(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-distill-'));
  dirs.push(repo);
  return repo;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshKernloop(repo: string): Kernloop {
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}

/** Record a real Outcome through the real run path (episodic read capability). */
async function recordTrace(kern: Kernloop, taskId: string, goal: string): Promise<void> {
  const result = await runTool(kern, { goal, capability: 'memory.episodic.read', id: taskId });
  expect(result.kind).toBe('outcome');
}

const ZERO_COST: Cost = { tokens: 0, usd: 0 };

/** Scripted invoke: returns `output` and captures every prompt it was handed. */
function scriptedInvoke(output: string, prompts: string[] = []): LoopInvoke {
  return (prompt) => {
    prompts.push(prompt);
    return Promise.resolve({ output, cost: ZERO_COST });
  };
}

const EMISSION = JSON.stringify({
  name: 'episodic-read-probe',
  oneLiner: 'Probe the episodic store and report what is recorded.',
  body: '# episodic-read-probe\n\nProbe the episodic store and report what is recorded.\n\n## When to use\n\nWhen a task needs the recorded trace state.\n\n## Steps\n\n1. Run the memory.episodic.read capability.\n',
});

describe('distillFromTrace [CLM-0049]', () => {
  it('distills a recorded trace into skills/proposed with SKILL.md and a valid suggest-tier PROPOSAL.yaml', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    await recordTrace(kern, 'task-distill-1', 'probe the episodic store');
    const prompts: string[] = [];
    const proposal = await distillFromTrace({
      kern,
      trace: 'task-distill-1',
      invoke: scriptedInvoke(EMISSION, prompts),
    });
    // the prompt carried the REAL trace summary, not an invention
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('task-distill-1');
    expect(prompts[0]).toContain('probe the episodic store');
    // the proposal record is the suggest-tier PROPOSAL.yaml shape
    expect(proposal).toMatchObject({
      name: 'episodic-read-probe',
      sourceTrace: 'task-distill-1',
      tier: 'suggest',
      status: 'proposed',
      cost: ZERO_COST,
    });
    const dir = path.join(repo, 'skills', 'proposed', 'episodic-read-probe');
    expect(proposal.skillFile).toBe(path.join(dir, 'SKILL.md'));
    expect(readFileSync(proposal.skillFile, 'utf8')).toContain('# episodic-read-probe');
    const yaml = YAML.parse(readFileSync(proposal.proposalFile, 'utf8')) as Record<string, unknown>;
    expect(yaml).toMatchObject({
      name: 'episodic-read-probe',
      oneLiner: 'Probe the episodic store and report what is recorded.',
      sourceTrace: 'task-distill-1',
      tier: 'suggest',
      status: 'proposed',
    });
    expect(typeof yaml['proposedAt']).toBe('string');
    // every proposal write is audited (constitutional rule 7)
    const audited = readEnvelopes(kern.paths.audit).find((e) => e.type === 'cli.distill.proposed');
    expect(audited?.payload).toMatchObject({
      name: 'episodic-read-probe',
      sourceTrace: 'task-distill-1',
      tier: 'suggest',
    });
    kern.close();
  });

  it('includes the loop node trace in the prompt when the trace id names a checkpointed run', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    await recordTrace(kern, 'task-loop-run', 'run the canonical loop');
    // a real checkpoint stream written through the real store
    const task = TaskContractSchema.parse({
      id: 'task-loop-run',
      goal: 'run the canonical loop',
      constraints: [],
      budget: { tokens: 1000, usd: 1, wallClockMin: 5 },
      evidence: [],
      definitionOfDone: [],
      authorityCeiling: 'advisory',
      overlay: kern.config.id,
    });
    await new JsonlCheckpointStore(checkpointFile(kern.paths.dir, 'task-loop-run')).save({
      runId: 'task-loop-run',
      seq: 1,
      node: 'frame',
      iteration: 0,
      state: {
        task,
        status: 'completed',
        cursor: { phase: 'done' },
        iteration: 0,
        values: {},
        findings: [],
        children: [],
        childResults: [],
        trace: [{ seq: 1, node: 'frame', iteration: 0 }],
      },
      createdAt: new Date().toISOString(),
    });
    const prompts: string[] = [];
    await distillFromTrace({
      kern,
      trace: 'task-loop-run',
      invoke: scriptedInvoke(EMISSION, prompts),
    });
    expect(prompts[0]).toContain('Loop nodes executed');
    expect(prompts[0]).toContain('1. frame (iteration 0)');
    kern.close();
  });

  it('throws a typed not-found error for a trace memory has never seen', async () => {
    const kern = freshKernloop(repoDir());
    let invoked = 0;
    const invoke: LoopInvoke = () => {
      invoked += 1;
      return Promise.resolve({ output: EMISSION, cost: ZERO_COST });
    };
    await expect(distillFromTrace({ kern, trace: 'task-never-ran', invoke })).rejects.toThrow(
      TraceNotFoundError,
    );
    expect(invoked).toBe(0); // no model spend on an invented input
    kern.close();
  });

  it('a malformed model emission is a typed violation with the raw output preserved', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    await recordTrace(kern, 'task-bad-model', 'misbehave');
    await expect(
      distillFromTrace({
        kern,
        trace: 'task-bad-model',
        invoke: scriptedInvoke('Sure! Here is a skill idea, in prose only.'),
      }),
    ).rejects.toThrow(LoopParseError);
    const violation = path.join(
      kern.paths.dir,
      'checkpoints',
      'task-bad-model-distill-violation.txt',
    );
    expect(readFileSync(violation, 'utf8')).toContain('in prose only');
    expect(existsSync(path.join(repo, 'skills'))).toBe(false); // nothing was written
    kern.close();
  });
});

describe('ratification path — the live library has no runtime write path [CLM-0050]', () => {
  it('distill writes land under skills/proposed and the live library is never written', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    await recordTrace(kern, 'task-proposed-only', 'stay in the proposed area');
    await distillFromTrace({
      kern,
      trace: 'task-proposed-only',
      invoke: scriptedInvoke(EMISSION),
    });
    // skills/ contains EXACTLY the proposed area — no live skills/<name>/
    expect(readdirSync(path.join(repo, 'skills'))).toEqual(['proposed']);
    expect(readdirSync(path.join(repo, 'skills', 'proposed'))).toEqual(['episodic-read-probe']);
    expect(existsSync(path.join(repo, 'skills', 'episodic-read-probe'))).toBe(false);
    kern.close();
  });

  it('rejects a proposal name that escapes the proposed area with a typed error', async () => {
    const repo = repoDir();
    const kern = freshKernloop(repo);
    await recordTrace(kern, 'task-escape', 'attempt a traversal');
    for (const evil of ['../evil', '/tmp/evil', 'evil/../../up']) {
      await expect(
        distillFromTrace({
          kern,
          trace: 'task-escape',
          invoke: scriptedInvoke(JSON.stringify({ name: evil, oneLiner: 'x', body: 'y' })),
        }),
      ).rejects.toThrow(SkillNameError);
    }
    expect(existsSync(path.join(repo, 'skills'))).toBe(false); // nothing escaped, nothing landed
    expect(existsSync(path.join(repo, 'evil'))).toBe(false);
    kern.close();
  });

  it('resolveProposalDir resolves only direct children of skills/proposed', () => {
    const repo = repoDir();
    expect(resolveProposalDir(repo, 'a-valid-name')).toBe(
      path.join(proposedSkillsRoot(repo), 'a-valid-name'),
    );
    const rejected = [
      '../evil',
      '..',
      '/etc/evil',
      'a/b',
      'a\\b',
      'UPPER-case',
      '-leading-dash',
      'trailing-dash-',
      'double--dash',
      '.hidden',
      'a'.repeat(SKILL_NAME_MAX + 1),
    ];
    for (const name of rejected) {
      expect(() => resolveProposalDir(repo, name)).toThrow(SkillNameError);
    }
  });

  it('no exported cli or memory runtime function writes into the live skills library', () => {
    // The package's ONLY skills-path writer target resolution is
    // resolveProposalDir (tested above to be confined to skills/proposed/).
    // Here: the export surfaces carry no other skills-shaped entry point —
    // every skills-related export is the read-only index or the proposal
    // path, and the memory faculty exports no procedural-write API at all
    // (p3 design notes open question 3, strictest reading).
    const skillExports = Object.keys(cliExports).filter((name) =>
      /skill|proposal|distill/i.test(name),
    );
    expect(skillExports.sort()).toEqual([
      'SKILL_NAME_MAX',
      'SkillNameError',
      'SkillProposalEmissionSchema',
      'distillFromTrace',
      'gatherSkillsIndex',
      'proposedSkillsRoot',
      'resolveProposalDir',
    ]);
    expect(Object.keys(memoryExports).filter((name) => /skill|procedural/i.test(name))).toEqual([]);
  });
});
