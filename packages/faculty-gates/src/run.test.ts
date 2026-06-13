import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { VerdictSchema, type Finding } from '@kernloop/contracts';
import type { InProcessCheck, SubprocessCheck } from './checks.js';
import { parseTscOutput } from './parsers.js';
import { runQualityGate } from './run.js';

/**
 * Fixture commands are tiny node scripts run via process.execPath — fast,
 * deterministic, no real pnpm runs. Each emits a real tool-output sample
 * (or nothing) and exits with a fixed code.
 */
const fixtureDir = mkdtempSync(path.join(tmpdir(), 'kernloop-gates-'));
afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

let scriptCount = 0;
function scriptCheck(
  name: string,
  source: string,
  parse: SubprocessCheck['parse'] = () => [],
): SubprocessCheck {
  scriptCount += 1;
  const file = path.join(fixtureDir, `check-${String(scriptCount)}.mjs`);
  writeFileSync(file, source);
  return { name, command: process.execPath, args: [file], parse };
}

/** Real `tsc --noEmit --pretty false` failure output, fed through a fixture. */
const TSC_FAILURE = [
  "src/math.ts(2,9): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/math.ts(5,3): error TS2304: Cannot find name 'bogus'.",
].join('\\n');

describe('runQualityGate', () => {
  it('emits a pass verdict for a passing workspace', async () => {
    const verdict = await runQualityGate({
      taskId: 'task-pass',
      workspaceDir: fixtureDir,
      checks: [
        scriptCheck('typecheck', 'process.exit(0);'),
        scriptCheck('lint', 'process.exit(0);'),
        scriptCheck('test', 'process.exit(0);'),
      ],
    });
    expect(verdict.result).toBe('pass');
    expect(verdict.gate).toBe('quality');
    expect(verdict.taskId).toBe('task-pass');
    expect(verdict.findings).toEqual([]);
    expect(verdict.confidence).toBe(1);
  });

  it('emits a fail verdict with parsed findings for typecheck-shaped failure output', async () => {
    const verdict = await runQualityGate({
      taskId: 'task-tsc',
      workspaceDir: fixtureDir,
      checks: [
        scriptCheck(
          'typecheck',
          `process.stdout.write("${TSC_FAILURE}\\n"); process.exit(2);`,
          parseTscOutput,
        ),
      ],
    });
    expect(verdict.result).toBe('fail');
    expect(verdict.findings).toHaveLength(2);
    expect(verdict.findings[0]?.severity).toBe('error');
    expect(verdict.findings[0]?.path).toBe('src/math.ts');
    expect(verdict.findings[0]?.message).toContain('TS2322');
  });

  it('fails with a timeout finding when a check exceeds its timeout', async () => {
    const verdict = await runQualityGate({
      taskId: 'task-timeout',
      workspaceDir: fixtureDir,
      timeoutMsPerCheck: 300,
      checks: [scriptCheck('test', 'setInterval(() => {}, 1000);')],
    });
    expect(verdict.result).toBe('fail');
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.severity).toBe('error');
    expect(verdict.findings[0]?.message).toContain('timed out after 300ms');
  });

  it('falls back to an output-tail finding when nothing parses', async () => {
    const verdict = await runQualityGate({
      taskId: 'task-tail',
      workspaceDir: fixtureDir,
      checks: [
        scriptCheck('lint', 'process.stderr.write("inscrutable explosion\\n"); process.exit(1);'),
      ],
    });
    expect(verdict.result).toBe('fail');
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.message).toContain('check "lint" exited 1');
    expect(verdict.findings[0]?.message).toContain('inscrutable explosion');
  });

  it('keeps only non-blocking findings when a check exits zero', async () => {
    const noisy: Finding[] = [
      { severity: 'info', message: 'note' },
      { severity: 'warn', message: 'console statement' },
      { severity: 'error', message: 'phantom error despite exit 0' },
    ];
    const verdict = await runQualityGate({
      taskId: 'task-exit0',
      workspaceDir: fixtureDir,
      checks: [scriptCheck('lint', 'process.exit(0);', () => noisy)],
    });
    expect(verdict.result).toBe('pass');
    expect(verdict.findings.map((f) => f.severity)).toEqual(['info', 'warn']);
  });

  it('aggregates mixed severities across checks', async () => {
    const verdict = await runQualityGate({
      taskId: 'task-mixed',
      workspaceDir: fixtureDir,
      checks: [
        scriptCheck('lint', 'process.exit(0);', () => [
          { severity: 'info', message: 'style note' },
          { severity: 'warn', message: 'lint warning' },
        ]),
        scriptCheck('test', 'process.exit(1);', () => [
          { severity: 'warn', message: 'flaky retry' },
          { severity: 'error', message: 'test failed: adds numbers' },
        ]),
      ],
    });
    expect(verdict.result).toBe('fail');
    expect(verdict.findings.map((f) => f.severity)).toEqual(['info', 'warn', 'warn', 'error']);
  });

  it('reports a spawn failure as an error finding', async () => {
    const verdict = await runQualityGate({
      taskId: 'task-spawn',
      workspaceDir: fixtureDir,
      checks: [
        {
          name: 'ghost',
          command: path.join(fixtureDir, 'no-such-binary'),
          args: [],
          parse: () => [],
        },
      ],
    });
    expect(verdict.result).toBe('fail');
    expect(verdict.findings[0]?.message).toContain('check "ghost" failed to start');
  });

  it('emits a schema-valid verdict with zero token cost', async () => {
    const verdict = await runQualityGate({
      taskId: 'task-schema',
      workspaceDir: fixtureDir,
      checks: [scriptCheck('typecheck', 'process.exit(0);')],
    });
    expect(VerdictSchema.safeParse(verdict).success).toBe(true);
    expect(verdict.cost.tokens).toBe(0);
    expect(verdict.cost.usd).toBe(0);
  });

  it('measures wallClockMs greater than zero', async () => {
    const verdict = await runQualityGate({
      taskId: 'task-clock',
      workspaceDir: fixtureDir,
      checks: [scriptCheck('test', 'process.exit(0);')],
    });
    expect(verdict.cost.wallClockMs).toBeGreaterThan(0);
  });
});

describe('runQualityGate — in-process checks', () => {
  const inproc = (name: string, run: InProcessCheck['run']): InProcessCheck => ({ name, run });

  it('passes an in-process check that returns no findings', async () => {
    const verdict = await runQualityGate({
      taskId: 'ip-pass',
      workspaceDir: fixtureDir,
      checks: [inproc('docs', () => [])],
    });
    expect(verdict.result).toBe('pass');
    expect(verdict.findings).toEqual([]);
  });

  it('threads an in-process check error finding through to a fail verdict', async () => {
    const verdict = await runQualityGate({
      taskId: 'ip-fail',
      workspaceDir: fixtureDir,
      checks: [inproc('docs', () => [{ severity: 'error', message: 'no doc on "f"' }])],
    });
    expect(verdict.result).toBe('fail');
    expect(verdict.findings).toContainEqual({ severity: 'error', message: 'no doc on "f"' });
  });

  it('keeps an in-process info finding non-blocking (verdict still passes)', async () => {
    const verdict = await runQualityGate({
      taskId: 'ip-info',
      workspaceDir: fixtureDir,
      checks: [inproc('docs', () => [{ severity: 'info', message: 'Python not covered' }])],
    });
    expect(verdict.result).toBe('pass');
    expect(verdict.findings.some((f) => f.severity === 'info')).toBe(true);
  });

  it('awaits an async in-process check', async () => {
    const verdict = await runQualityGate({
      taskId: 'ip-async',
      workspaceDir: fixtureDir,
      checks: [
        inproc('docs', () => Promise.resolve([{ severity: 'error', message: 'async fail' }])),
      ],
    });
    expect(verdict.result).toBe('fail');
  });

  it('turns a throwing in-process check into an error finding (never silently passes)', async () => {
    const verdict = await runQualityGate({
      taskId: 'ip-throw',
      workspaceDir: fixtureDir,
      checks: [
        inproc('docs', () => {
          throw new Error('boom');
        }),
      ],
    });
    expect(verdict.result).toBe('fail');
    expect(verdict.findings.some((f) => f.severity === 'error' && f.message.includes('boom'))).toBe(
      true,
    );
  });

  it('times out a hung in-process check as an error finding', async () => {
    const verdict = await runQualityGate({
      taskId: 'ip-timeout',
      workspaceDir: fixtureDir,
      timeoutMsPerCheck: 20,
      checks: [inproc('docs', () => new Promise<Finding[]>(() => {}))],
    });
    expect(verdict.result).toBe('fail');
    expect(verdict.findings.some((f) => f.message.includes('timed out'))).toBe(true);
  });
});
