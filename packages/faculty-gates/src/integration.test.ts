/**
 * End-to-end proof against a real tool: runs the actual TypeScript compiler
 * (the workspace's own `tsc`, the engine behind `pnpm typecheck`) over a
 * tiny fixture workspace containing a type error, and asserts the gate
 * parses real tsc output into a structured fail Verdict (CLM-0031).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { VerdictSchema } from '@kernloop/contracts';
import { parseTscOutput } from './parsers.js';
import { runQualityGate } from './run.js';

/** Resolve the monorepo root's typescript (a root devDependency). */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tscJs = createRequire(path.join(repoRoot, 'package.json')).resolve('typescript/lib/tsc.js');

const workspaceDir = mkdtempSync(path.join(tmpdir(), 'kernloop-gates-it-'));
afterAll(() => rmSync(workspaceDir, { recursive: true, force: true }));

/** Five-line fixture workspace with one type error. */
const BROKEN_TS = [
  'export function add(a: number, b: number): number {',
  "  const result: number = 'not a number';",
  '  return result + a + b;',
  '}',
  '',
].join('\n');

describe('quality gate against a real typescript compiler', () => {
  it('fails a real tsc run against a workspace with a type error', async () => {
    mkdirSync(path.join(workspaceDir, 'src'), { recursive: true });
    writeFileSync(path.join(workspaceDir, 'src', 'broken.ts'), BROKEN_TS);

    const verdict = await runQualityGate({
      taskId: 'task-real-tsc',
      workspaceDir,
      checks: [
        {
          name: 'typecheck',
          command: process.execPath,
          args: [tscJs, '--noEmit', '--pretty', 'false', 'src/broken.ts'],
          parse: parseTscOutput,
        },
      ],
    });

    expect(VerdictSchema.safeParse(verdict).success).toBe(true);
    expect(verdict.result).toBe('fail');
    expect(verdict.findings.length).toBeGreaterThan(0);
    const ts2322 = verdict.findings.find((f) => f.message.includes('TS2322'));
    expect(ts2322?.severity).toBe('error');
    expect(ts2322?.path).toBe('src/broken.ts');
    expect(verdict.cost.wallClockMs).toBeGreaterThan(0);
  }, 30_000);
});
