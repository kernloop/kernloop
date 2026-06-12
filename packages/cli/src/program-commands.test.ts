/**
 * The `kernloop program decompose` CLI suite (CLM-0096). Proves the wired,
 * suggest-tier preview path: a valid goal+spec prints the proposed epic/story
 * child tree with correct child ids + altitude tags and audits
 * `cli.program.decompose` (goalChars, never the goal verbatim); a budget-breach
 * and a bad altitude exit 1 with a clear message; a missing `--goal`/`--spec`
 * throws a usage error. It is a pure preview — it mutates nothing (no GitHub).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConstraintTags, type TaskContract } from '@kernloop/contracts';
import { initOverlay } from './overlay.js';
import { programCommand } from './program-commands.js';
import type { CliIo } from './cli.js';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-program-cli-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A bare repo overlay (no tracker needed — decompose never touches one). */
function repo(): string {
  const r = tmp();
  initOverlay(r);
  return r;
}

/** Write a spec JSON file into the repo and return its path. */
function writeSpec(r: string, specs: unknown): string {
  const file = path.join(r, 'spec.json');
  writeFileSync(file, JSON.stringify(specs));
  return file;
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

const STORY = {
  goal: 'Build login',
  budget: { tokens: 4_000, usd: 0.4, wallClockMin: 10 },
  assignTo: 'coder',
  altitude: 'story',
};

describe('kernloop program decompose — the suggest-tier preview', () => {
  it('prints the child tree with correct ids + altitude tags and audits the op', async () => {
    const r = repo();
    const spec = writeSpec(r, [
      STORY,
      { ...STORY, goal: 'Build logout', altitude: 'story', track: 'auth', sprint: 's1' },
    ]);
    const { io, out } = makeIo(r);
    const code = await programCommand(
      ['decompose', '--goal', 'Ship the auth program', '--spec', spec, '--id', 'program-x'],
      io,
      helpers,
    );
    expect(code).toBe(0);
    const report = JSON.parse(out[0]!) as { parent: TaskContract; children: TaskContract[] };
    expect(report.parent.id).toBe('program-x');
    expect(report.children.map((c) => c.id)).toEqual(['program-x.1', 'program-x.2']);
    const first = parseConstraintTags(report.children[0]!.constraints);
    expect(first.altitude).toBe('story');
    expect(first.assign).toBe('agent.coder');
    const second = parseConstraintTags(report.children[1]!.constraints);
    expect(second.track).toBe('auth');
    expect(second.sprint).toBe('s1');

    const event = auditEvents(r).find((e) => e.type === 'cli.program.decompose');
    expect(event?.payload.parentId).toBe('program-x');
    expect(event?.payload.childCount).toBe(2);
  });

  it('audits goalChars only — never the goal verbatim', async () => {
    const r = repo();
    const spec = writeSpec(r, [STORY]);
    const { io } = makeIo(r);
    const SECRET_GOAL = 'SECRET-PROGRAM-GOAL-do-not-leak';
    await programCommand(['decompose', '--goal', SECRET_GOAL, '--spec', spec], io, helpers);
    const raw = readFileSync(path.join(r, '.kernloop', 'audit.jsonl'), 'utf8');
    expect(raw).toContain('cli.program.decompose');
    expect(raw).not.toContain(SECRET_GOAL);
    const event = auditEvents(r).find((e) => e.type === 'cli.program.decompose');
    expect(event?.payload.goalChars).toBe(SECRET_GOAL.length);
  });

  it('a budget-breaching spec exits 1 with a clear message naming the breach', async () => {
    const r = repo();
    // Default overlay budget is bounded; two large slices breach tokens.
    const spec = writeSpec(r, [
      { ...STORY, budget: { tokens: 9_999_999, usd: 0.5, wallClockMin: 10 } },
      { ...STORY, budget: { tokens: 9_999_999, usd: 0.5, wallClockMin: 10 } },
    ]);
    const { io, err } = makeIo(r);
    const code = await programCommand(['decompose', '--goal', 'G', '--spec', spec], io, helpers);
    expect(code).toBe(1);
    const report = JSON.parse(err[0]!) as { error: string; message: string };
    expect(report.error).toBe('ScrumBudgetExceededError');
    expect(report.message).toContain('tokens');
  });

  it('a bad altitude exits 1 with a clear message', async () => {
    const r = repo();
    const spec = writeSpec(r, [{ ...STORY, altitude: 'saga' }]);
    const { io, err } = makeIo(r);
    const code = await programCommand(['decompose', '--goal', 'G', '--spec', spec], io, helpers);
    expect(code).toBe(1);
    const report = JSON.parse(err[0]!) as { error: string };
    expect(report.error).toBe('InvalidStorySpecError');
  });

  it('a missing --goal throws a usage error', async () => {
    const r = repo();
    const spec = writeSpec(r, [STORY]);
    const { io } = makeIo(r);
    await expect(programCommand(['decompose', '--spec', spec], io, helpers)).rejects.toThrow(
      /usage/,
    );
  });

  it('a missing --spec throws a usage error', async () => {
    const r = repo();
    const { io } = makeIo(r);
    await expect(programCommand(['decompose', '--goal', 'G'], io, helpers)).rejects.toThrow(
      /usage/,
    );
  });

  it('a non-array spec file exits 1 with a clean ProgramInputError (no raw throw)', async () => {
    const r = repo();
    const spec = writeSpec(r, { not: 'an array' });
    const { io, err } = makeIo(r);
    const code = await programCommand(['decompose', '--goal', 'G', '--spec', spec], io, helpers);
    expect(code).toBe(1);
    const report = JSON.parse(err[0]!) as { error: string; message: string };
    expect(report.error).toBe('ProgramInputError');
    expect(report.message).toContain('array');
  });

  it('a malformed-JSON spec file exits 1 with a clean ProgramInputError (no raw SyntaxError)', async () => {
    const r = repo();
    const spec = path.join(r, 'spec.json');
    writeFileSync(spec, '{ not valid json ');
    const { io, err } = makeIo(r);
    const code = await programCommand(['decompose', '--goal', 'G', '--spec', spec], io, helpers);
    expect(code).toBe(1);
    const report = JSON.parse(err[0]!) as { error: string; message: string };
    expect(report.error).toBe('ProgramInputError');
    expect(report.message).toContain('not valid JSON');
  });

  it('a missing spec file exits 1 with a clean ProgramInputError (no raw ENOENT)', async () => {
    const r = repo();
    const { io, err } = makeIo(r);
    const code = await programCommand(
      ['decompose', '--goal', 'G', '--spec', path.join(r, 'nope.json')],
      io,
      helpers,
    );
    expect(code).toBe(1);
    expect((JSON.parse(err[0]!) as { error: string }).error).toBe('ProgramInputError');
  });

  it('rejects an unknown program verb with a usage error', async () => {
    const r = repo();
    const { io } = makeIo(r);
    await expect(programCommand(['frobnicate'], io, helpers)).rejects.toThrow(/usage/);
  });
});
