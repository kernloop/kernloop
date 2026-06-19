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
  // ALWAYS disable the (default-on, #227) Docker gate sandbox so fixtures run tsc
  // deterministically on the HOST (the Docker --network none path is covered by the
  // #236 gate-tier tests). Appended only when the custom overlay has no `gates:` of
  // its own (else it must disable sandbox itself — avoids a duplicate `gates:` key).
  {
    const sandboxOff = 'gates:\n  quality:\n    sandbox:\n      enabled: false\n';
    const yaml =
      overlayYaml === undefined
        ? `id: ${name}\n${sandboxOff}`
        : overlayYaml.includes('gates:')
          ? overlayYaml
          : `${overlayYaml}${sandboxOff}`;
    mkdirSync(path.join(repo, '.kernloop'), { recursive: true });
    writeFileSync(path.join(repo, '.kernloop', 'overlay.yaml'), yaml);
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
/** A scripted reviewer report: a goal-mismatch reject (#226 item 3 wiring) or a clean approve. */
function reviewOutput(groundednessReject: boolean): string {
  return groundednessReject
    ? JSON.stringify({
        findings: [
          {
            severity: 'error',
            message: 'the diff implements the wrong feature — it fails the stated goal/criterion',
          },
        ],
        summary: 'goal mismatch: the diff does not satisfy the stated goal',
      })
    : JSON.stringify({ findings: [], summary: 'no blocking issues found' });
}

export function scriptedInvoke(script: {
  vote: () => 'approve' | 'reject';
  files: Array<{ path: string; content: string }>;
  /**
   * When true, the GROUNDEDNESS reviewer (#226 item 3) returns the goal-mismatch
   * REJECT a correct reviewer WOULD return for a wrong-feature diff. This is the
   * EXPECTED verdict scripted for a hermetic WIRING test (does a groundedness
   * reject flow to a needs-review signal?) — it does NOT exercise a real model's
   * judgment (that is the live eval). Default false → the groundedness reviewer
   * approves like the others.
   */
  groundednessReject?: boolean;
}): LoopInvoke {
  return (prompt) => {
    let output: string;
    if (prompt.includes('Diff under review')) {
      output = reviewOutput(
        script.groundednessReject === true && prompt.includes('groundedness reviewer'),
      );
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
