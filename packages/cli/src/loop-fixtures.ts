/**
 * Shared fixtures for the canonical-loop integration tests (loop.test.ts and
 * loop-iteration.test.ts): a REAL git repo with a tiny real TypeScript package,
 * the real tsc quality check, and the scripted model double. Kept in a non-test
 * module so both suites share one definition and neither file outgrows the
 * 400-line budget. `loopScratch()` returns the per-process scratch dir; tests
 * register `rmSync` cleanup in their own afterAll.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Cost } from '@kernloop/contracts';
import { parseTscOutput, type QualityCheck } from '@kernloop/faculty-gates';
import { createKernloop, type Kernloop } from './kernel.js';
import type { LoopInvoke } from './loop/index.js';

/** The monorepo root's real TypeScript compiler (a root devDependency). */
const monoRoot = path.resolve(import.meta.dirname, '../../..');
const tscJs = createRequire(path.join(monoRoot, 'package.json')).resolve('typescript/lib/tsc.js');

/** A fresh per-process scratch directory the fixtures write repos into. */
export function loopScratch(): string {
  return mkdtempSync(path.join(tmpdir(), 'kernloop-cli-loop-'));
}

/** The fixture's real quality check: the monorepo's actual tsc binary. */
export const typecheck: QualityCheck = {
  name: 'typecheck',
  command: process.execPath,
  args: [tscJs, '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'],
  parse: parseTscOutput,
};

export const GREET_TS =
  'export function greet(name: string): string {\n  return `hello ${name}`;\n}\n';
export const BROKEN_TS =
  'export function greet(name: string): string {\n' +
  "  const broken: number = 'not a number';\n  return broken;\n}\n";

export const COST: Cost = { tokens: 7, usd: 0.001 };

/** A REAL repository: git-initialized, with a tiny real TypeScript package. */
export function fixtureRepo(scratch: string, name: string, overlayYaml?: string): string {
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

/** An assembled kernloop over a fixture repo (deterministic rng for the vote panel). */
export function kernloopFor(repo: string): Kernloop {
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}

/**
 * The scripted model — an honest double for the external CLI, dispatching on
 * the prompts the REAL executors assemble. `vote` is consulted once per voter;
 * `files` is what the coder "writes".
 */
export function scriptedInvoke(script: {
  vote: () => 'approve' | 'reject';
  files: Array<{ path: string; content: string }>;
}): LoopInvoke {
  return (prompt) => {
    let output: string;
    if (prompt.includes('Diff under review')) {
      output = JSON.stringify({ findings: [], summary: 'no blocking issues found' });
    } else if (prompt.includes('Investigate the prior art')) {
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
