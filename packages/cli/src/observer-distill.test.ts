/**
 * The FITNESS-GATED distill verb `kernloop observer distill --subject S` (#50,
 * CLM-0117). Proves the earned-distillation rule: a subject is distilled into a
 * suggest-tier skill proposal ONLY when the Observer's lifecycle pass deems it
 * distill-worthy (sustained success over the minimum invocations, with a real
 * recent trace); a subject that has not earned it is REFUSED. The proposal lands
 * in skills/proposed/ (never live) — a human PR moves it live, so nothing is
 * auto-merged — and the act is audited as cli.observer.distill.
 */
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Cost } from '@kernloop/contracts';
import { initOverlay } from './overlay.js';
import { observerCommand } from './observer-commands.js';
import { createKernloop, type Kernloop } from './kernel.js';
import { runTool } from './tools/run.js';
import type { LoopInvoke } from './loop/index.js';
import type { CliIo } from './cli.js';

const dirs: string[] = [];
function repoDir(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-observer-distill-'));
  dirs.push(repo);
  initOverlay(repo);
  return repo;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeIo(cwd: string): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t) => out.push(t), err: (t) => err.push(t), cwd }, out, err };
}

const helpers = {
  mixedFlags: (args: string[], _strs: readonly string[], bools: readonly string[]) => {
    const v: Record<string, string | boolean> = {};
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a.startsWith('--')) {
        const name = a.slice(2);
        if (bools.includes(name)) v[name] = true;
        else v[name] = args[++i]!;
      }
    }
    return v;
  },
  str: (x: string | boolean | undefined) => (typeof x === 'string' ? x : undefined),
} as unknown as Parameters<typeof observerCommand>[2];

const ZERO_COST: Cost = { tokens: 0, usd: 0 };
const EMISSION = JSON.stringify({
  name: 'episodic-read-probe',
  oneLiner: 'Probe the episodic store and report what is recorded.',
  body: '# episodic-read-probe\n\nProbe the episodic store.\n\n## When to use\n\nWhen a task needs the recorded trace state.\n\n## Steps\n\n1. Run the memory.episodic.read capability.\n',
});
const scriptedInvoke = (): LoopInvoke => () =>
  Promise.resolve({ output: EMISSION, cost: ZERO_COST });

/** Record a real success Outcome through the run path (memory + observer fitness). */
async function recordTrace(kern: Kernloop, taskId: string): Promise<void> {
  const result = await runTool(kern, {
    goal: 'probe the episodic store',
    capability: 'memory.episodic.read',
    id: taskId,
  });
  expect(result.kind).toBe('outcome');
}

function auditTypes(repo: string): string[] {
  return readFileSync(path.join(repo, '.kernloop', 'audit.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { type: string }).type);
}

describe('kernloop observer distill — fitness-gated distillation (#50)', () => {
  it('distills an EARNED subject’s recent trace into a suggest-tier proposal, audited, never live', async () => {
    const repo = repoDir();
    const kern = createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
    // Three successful runs of one capability → its subject earns a distill proposal.
    for (const id of ['ed-1', 'ed-2', 'ed-3']) await recordTrace(kern, id);
    const proposal = kern.observer.lifecycleProposals().find((p) => p.kind === 'distill');
    expect(proposal?.traceId).toBeDefined();
    const subject = proposal!.subject;
    kern.close();

    const { io, out } = makeIo(repo);
    const code = await observerCommand(['distill', '--subject', subject], io, helpers, {
      invoke: scriptedInvoke(),
    });
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as {
      subject: string;
      trace: string;
      tier: string;
      status: string;
      skillFile: string;
    };
    expect(report.tier).toBe('suggest'); // earned, but still only a proposal
    expect(report.status).toBe('proposed');
    expect(report.trace).toBe(proposal!.traceId); // distilled the cited recent success
    expect(report.skillFile).toContain(path.join('skills', 'proposed')); // never the live library
    expect(existsSync(report.skillFile)).toBe(true); // the SKILL.md was actually written
    expect(auditTypes(repo)).toContain('cli.observer.distill');
  }, 30_000);

  it('REFUSES to distill a subject that has not earned it (no high-fitness proposal)', async () => {
    const repo = repoDir();
    const { io } = makeIo(repo);
    await expect(
      observerCommand(['distill', '--subject', 'never-run-subject'], io, helpers, {}),
    ).rejects.toThrow('not distill-worthy');
  });

  it('requires --subject', async () => {
    const repo = repoDir();
    const { io } = makeIo(repo);
    await expect(observerCommand(['distill'], io, helpers, {})).rejects.toThrow('--subject');
  });
});
