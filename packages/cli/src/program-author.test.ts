/**
 * The `kernloop program author` CLI suite (CLM-0103). Proves the wired,
 * suggest-tier, model-AUTHORED preview path: a scripted invoke (an honest
 * double for the external model CLI — everything downstream of the seam is
 * real) returns a JSON array of story specs, which is parsed robustly (even
 * wrapped in ```json fences / prose) and run through the SAME deterministic
 * `decomposeGoal` the file-driven verb uses. The model PROPOSES, the faculty
 * ENFORCES (budget-sum invariant, identity/altitude/assign derivation), nothing
 * is mutated, and a malformed / schema-invalid / budget-breaching model output
 * is a CLEAN exit 1 — never a fabricated spec, never an unhandled throw. The
 * audit event carries goalChars, never the goal verbatim, and the model is
 * invoked with a prompt that contains the goal.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConstraintTags, type Cost, type TaskContract } from '@kernloop/contracts';
import { initOverlay } from './overlay.js';
import { programCommand } from './program-commands.js';
import type { LoopInvoke } from './loop/invoke.js';
import type { CliIo } from './cli.js';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-program-author-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A bare repo overlay (author never touches a tracker). */
function repo(): string {
  const r = tmp();
  initOverlay(r);
  return r;
}

function makeIo(cwd: string): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t) => out.push(t), err: (t) => err.push(t), cwd }, out, err };
}

const helpers = {
  outFlags: () => ({}),
  strFlags: () => ({}),
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
  withKernloop: async () => 0,
  str: (x: string | boolean | undefined) => (typeof x === 'string' ? x : undefined),
} as unknown as Parameters<typeof programCommand>[2];

function auditEvents(r: string): Array<{ type: string; payload: Record<string, unknown> }> {
  return readFileSync(path.join(r, '.kernloop', 'audit.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> });
}

const ZERO_COST: Cost = { tokens: 0, usd: 0 };

/** Scripted invoke: returns `output` and captures every prompt it was handed. */
function scriptedInvoke(output: string, prompts: string[] = []): LoopInvoke {
  return (prompt) => {
    prompts.push(prompt);
    return Promise.resolve({ output, cost: ZERO_COST });
  };
}

/** An invoke that throws — proves a clean usage error never reaches the model. */
const throwingInvoke: LoopInvoke = () => {
  throw new Error('author must not invoke the model on a usage error');
};

/** Two valid stories whose budgets sum within the default overlay budget. */
const TWO_STORIES = [
  {
    goal: 'Build login',
    budget: { tokens: 4_000, usd: 0.4, wallClockMin: 10 },
    assignTo: 'coder',
    altitude: 'story',
  },
  {
    goal: 'Document login',
    budget: { tokens: 3_000, usd: 0.3, wallClockMin: 8 },
    assignTo: 'documenter',
    altitude: 'story',
    track: 'auth',
    sprint: 's1',
  },
];

interface AuthorOut {
  op: string;
  adapter: string;
  parent: TaskContract;
  children: TaskContract[];
}

describe('kernloop program author — the model-authored suggest-tier preview', () => {
  it('a valid JSON-array model output prints the proposed tree, echoes the adapter, mutates nothing', async () => {
    const r = repo();
    const { io, out } = makeIo(r);
    const code = await programCommand(
      ['author', '--goal', 'Ship the auth program', '--id', 'prog', '--adapter', 'gemini'],
      io,
      helpers,
      { invoke: scriptedInvoke(JSON.stringify(TWO_STORIES)) },
    );
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as AuthorOut;
    expect(report.op).toBe('author');
    expect(report.adapter).toBe('gemini');
    expect(report.parent.id).toBe('prog');
    expect(report.children.map((c) => c.id)).toEqual(['prog.1', 'prog.2']);
    const first = parseConstraintTags(report.children[0]!.constraints);
    expect(first.altitude).toBe('story');
    expect(first.assign).toBe('agent.coder');
    const second = parseConstraintTags(report.children[1]!.constraints);
    expect(second.assign).toBe('agent.documenter');
    expect(second.track).toBe('auth');
    expect(second.sprint).toBe('s1');
    // Mutates nothing: suggest-tier ceiling, and no program row is written to
    // the ledger (the `list` verb reports zero programs after author ran).
    expect(report.children.every((c) => c.authorityCeiling === 'suggest')).toBe(true);
    const { io: listIo, out: listOut } = makeIo(r);
    await programCommand(['list'], listIo, helpers);
    expect((JSON.parse(listOut[0]!) as { programs: unknown[] }).programs).toEqual([]);
  });

  it('parses a model output that wraps the JSON array in ```json fences and prose', async () => {
    const r = repo();
    const { io, out } = makeIo(r);
    const wrapped = [
      "Sure! Here's the plan I propose:",
      '```json',
      JSON.stringify(TWO_STORIES, null, 2),
      '```',
      'Let me know if you want changes.',
    ].join('\n');
    const code = await programCommand(['author', '--goal', 'G', '--id', 'prog'], io, helpers, {
      invoke: scriptedInvoke(wrapped),
    });
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as AuthorOut;
    expect(report.children.map((c) => c.id)).toEqual(['prog.1', 'prog.2']);
    expect(report.adapter).toBe('claude'); // default adapter echoed
  });

  it('invokes the model with a prompt that contains the goal', async () => {
    const r = repo();
    const { io } = makeIo(r);
    const prompts: string[] = [];
    const GOAL = 'Ship the auth program for the customer portal';
    await programCommand(['author', '--goal', GOAL], io, helpers, {
      invoke: scriptedInvoke(JSON.stringify(TWO_STORIES), prompts),
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(GOAL);
  });

  it('a malformed-JSON model output exits 1 with a clean ProgramInputError (no fabricated specs)', async () => {
    const r = repo();
    const { io, err } = makeIo(r);
    const code = await programCommand(['author', '--goal', 'G'], io, helpers, {
      invoke: scriptedInvoke('[ { "goal": "x", not valid json '),
    });
    expect(code).toBe(1);
    const report = JSON.parse(err[0]!) as { error: string; message: string };
    expect(report.error).toBe('ProgramInputError');
    // Nothing was decomposed/audited as a successful author.
    expect(auditEvents(r).some((e) => e.type === 'cli.program.author')).toBe(false);
  });

  it('a non-array model output exits 1 with a clean ProgramInputError', async () => {
    const r = repo();
    const { io, err } = makeIo(r);
    const code = await programCommand(['author', '--goal', 'G'], io, helpers, {
      invoke: scriptedInvoke('I cannot produce that plan, sorry.'),
    });
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('ProgramInputError');
  });

  it('a schema-invalid model output (bad altitude / missing budget) exits 1 cleanly', async () => {
    const r = repo();
    const { io, err } = makeIo(r);
    const badAltitude = await programCommand(['author', '--goal', 'G'], io, helpers, {
      invoke: scriptedInvoke(JSON.stringify([{ ...TWO_STORIES[0], altitude: 'saga' }])),
    });
    expect(badAltitude).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('ProgramInputError');

    const { io: io2, err: err2 } = makeIo(r);
    const missingBudget = await programCommand(['author', '--goal', 'G'], io2, helpers, {
      invoke: scriptedInvoke(JSON.stringify([{ goal: 'x', assignTo: 'coder', altitude: 'story' }])),
    });
    expect(missingBudget).toBe(1);
    expect((JSON.parse(err2[0]!) as { error: string }).error).toBe('ProgramInputError');
  });

  it('a model output whose budgets BREACH the parent exits 1 (ScrumBudgetExceededError)', async () => {
    const r = repo();
    const { io, err } = makeIo(r);
    const breaching = [
      { ...TWO_STORIES[0], budget: { tokens: 9_999_999, usd: 0.5, wallClockMin: 10 } },
      { ...TWO_STORIES[0], budget: { tokens: 9_999_999, usd: 0.5, wallClockMin: 10 } },
    ];
    const code = await programCommand(['author', '--goal', 'G'], io, helpers, {
      invoke: scriptedInvoke(JSON.stringify(breaching)),
    });
    expect(code).toBe(1);
    const report = JSON.parse(err[0]!) as { error: string; message: string };
    expect(report.error).toBe('ScrumBudgetExceededError');
    expect(report.message).toContain('tokens');
  });

  it('a missing --goal throws a usage error and never invokes the model', async () => {
    const r = repo();
    const { io } = makeIo(r);
    await expect(
      programCommand(['author', '--id', 'prog'], io, helpers, { invoke: throwingInvoke }),
    ).rejects.toThrow(/usage/);
  });

  it('an invalid --adapter exits 1 with a clean ProgramInputError (not a raw ZodError)', async () => {
    const r = repo();
    const { io, err } = makeIo(r);
    const code = await programCommand(
      ['author', '--goal', 'G', '--adapter', 'bogus-adapter'],
      io,
      helpers,
      { invoke: throwingInvoke },
    );
    expect(code).toBe(1);
    const report = JSON.parse(err[0]!) as { error: string; message: string };
    expect(report.error).toBe('ProgramInputError');
    expect(report.message).toContain('--adapter');
  });

  it('prefers a fenced ```json block over a stray prose bracket', async () => {
    const r = repo();
    const { io, out } = makeIo(r);
    // Prose with a decoy `[1]` BEFORE the real fenced array.
    const wrapped = `Here is step [1] of my plan:\n\n\`\`\`json\n${JSON.stringify(TWO_STORIES)}\n\`\`\`\n`;
    const code = await programCommand(['author', '--goal', 'G', '--id', 'prog'], io, helpers, {
      invoke: scriptedInvoke(wrapped),
    });
    expect(code).toBe(0);
    expect((JSON.parse(out[0]!) as AuthorOut).children.map((c) => c.id)).toEqual([
      'prog.1',
      'prog.2',
    ]);
  });

  it('an empty model array yields zero children and exits 0 (parity with decompose)', async () => {
    const r = repo();
    const { io, out } = makeIo(r);
    const code = await programCommand(['author', '--goal', 'G'], io, helpers, {
      invoke: scriptedInvoke('[]'),
    });
    expect(code).toBe(0);
    expect((JSON.parse(out[0]!) as AuthorOut).children).toEqual([]);
  });

  it('audits cli.program.author with goalChars only — never the goal verbatim', async () => {
    const r = repo();
    const { io } = makeIo(r);
    const SECRET_GOAL = 'SECRET-AUTHOR-GOAL-do-not-leak';
    await programCommand(['author', '--goal', SECRET_GOAL], io, helpers, {
      invoke: scriptedInvoke(JSON.stringify(TWO_STORIES)),
    });
    const raw = readFileSync(path.join(r, '.kernloop', 'audit.jsonl'), 'utf8');
    expect(raw).toContain('cli.program.author');
    expect(raw).not.toContain(SECRET_GOAL);
    const event = auditEvents(r).find((e) => e.type === 'cli.program.author');
    expect(event?.payload.op).toBe('author');
    expect(event?.payload.adapter).toBe('claude');
    expect(event?.payload.childCount).toBe(2);
    expect(event?.payload.goalChars).toBe(SECRET_GOAL.length);
  });
});
