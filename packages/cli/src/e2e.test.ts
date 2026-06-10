/**
 * P1 exit criterion, end to end [CLM-0036]: one real task through the
 * quality gate — real routing via registered manifests, a real TypeScript
 * compile in a real workspace fixture, a real Verdict published on the bus,
 * a real Outcome recorded to SQLite, and a verifiable audit chain carrying
 * the routing, verdict, and outcome events. Nothing mocked.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { OutcomeSchema, VerdictSchema } from '@kernloop/contracts';
import { verifyChain } from '@kernloop/kernel';
import { parseTscOutput, type QualityCheck } from '@kernloop/faculty-gates';
import { createKernloop } from './kernel.js';
import { runTool } from './tools/run.js';
import { statusTool } from './tools/status.js';
import { auditTool, readEnvelopes } from './tools/audit.js';
import { observeTool } from './tools/observe.js';

/** The monorepo root's real TypeScript compiler (a root devDependency). */
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const tscJs = createRequire(path.join(repoRoot, 'package.json')).resolve('typescript/lib/tsc.js');

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-e2e-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Scaffold a tiny REAL TypeScript workspace fixture. */
function fixtureWorkspace(name: string, source: string): string {
  const dir = path.join(scratch, name);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: `fixture-${name}`, version: '0.0.0', type: 'module' }, null, 2),
  );
  writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] }, null, 2),
  );
  writeFileSync(path.join(dir, 'src', 'main.ts'), source);
  return dir;
}

/** The fixture's definition-of-done check: the real tsc over the fixture. */
const typecheck: QualityCheck = {
  name: 'typecheck',
  command: process.execPath,
  args: [tscJs, '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'],
  parse: parseTscOutput,
};

const GOOD_TS = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';
const BROKEN_TS =
  'export function add(a: number, b: number): number {\n' +
  "  const result: number = 'not a number';\n" +
  '  return result + a + b;\n}\n';

describe('P1 exit: one real task end-to-end through the quality gate', () => {
  it('runs a real task through routing, the real quality gate, audit, and memory — and passes', async () => {
    const overlay = path.join(scratch, 'pass-repo', '.kernloop');
    const kern = createKernloop({ overlayDir: overlay, rng: () => 0.99 });
    const workspace = fixtureWorkspace('pass', GOOD_TS);

    const result = await runTool(
      kern,
      {
        goal: 'pass quality',
        capability: 'gate.quality',
        workspaceDir: workspace,
        id: 'task-e2e-pass',
      },
      { checks: [typecheck] },
    );

    // Verdict: real tsc passed (CLM-0032: verdict on the chain via the bus)
    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(VerdictSchema.safeParse(result.verdict).success).toBe(true);
    expect(result.verdict?.result).toBe('pass');
    expect(result.verdict?.cost.wallClockMs).toBeGreaterThan(0);

    // Outcome: success, schema-valid, measured cost (CLM-0034)
    expect(OutcomeSchema.safeParse(result.outcome).success).toBe(true);
    expect(result.outcome.status).toBe('success');
    expect(result.outcome.signals).toEqual([
      { name: 'gate:quality', passed: true, detail: 'pass with 0 finding(s)' },
    ]);

    // Memory: outcome recorded, answerable via status (cross-session SQLite)
    const status = statusTool(kern, { taskId: 'task-e2e-pass' });
    expect(status.found).toBe(true);
    if (status.found) expect(status.trace.status).toBe('success');

    // Audit: the chain verifies and carries routing + verdict + outcome events
    const verify = auditTool(kern, { op: 'verify' });
    if (verify.op !== 'verify') throw new Error('expected verify');
    expect(verify.result.ok).toBe(true);
    const types = readEnvelopes(kern.paths.audit).map((e) => e.type);
    expect(types).toContain('kernel.router.route');
    expect(types).toContain('cli.gate.verdict');
    expect(types).toContain('cli.run.outcome');
    const publishes = readEnvelopes(kern.paths.audit)
      .filter((e) => e.type === 'kernel.bus.publish')
      .map((e) => (e.payload as { contract: string }).contract);
    expect(publishes).toContain('TaskContract');
    expect(publishes).toContain('Verdict');
    expect(publishes).toContain('Outcome');

    // Observe: the run is visible as real telemetry (spec §8 item 7)
    const report = observeTool(kern, {});
    expect(report.verdicts).toEqual({ total: 1, pass: 1, fail: 0 });
    expect(report.outcomes.byStatus.success).toBe(1);
    kern.close();
  }, 60_000);

  it('fails honestly on a workspace with a type error: fail Verdict, failure Outcome, verified chain', async () => {
    const overlay = path.join(scratch, 'fail-repo', '.kernloop');
    const kern = createKernloop({ overlayDir: overlay, rng: () => 0.99 });
    const workspace = fixtureWorkspace('fail', BROKEN_TS);

    const result = await runTool(
      kern,
      {
        goal: 'pass quality',
        capability: 'gate.quality',
        workspaceDir: workspace,
        id: 'task-e2e-fail',
      },
      { checks: [typecheck] },
    );

    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.verdict?.result).toBe('fail');
    const ts2322 = result.verdict?.findings.find((f) => f.message.includes('TS2322'));
    expect(ts2322?.severity).toBe('error');
    expect(result.outcome.status).toBe('failure');

    const status = statusTool(kern, { taskId: 'task-e2e-fail' });
    expect(status.found && status.trace.status === 'failure').toBe(true);
    expect(verifyChain(kern.store).ok).toBe(true);
    const report = observeTool(kern, {});
    expect(report.verdicts).toEqual({ total: 1, pass: 0, fail: 1 });
    expect(report.outcomes.byStatus.failure).toBe(1);
    kern.close();
  }, 60_000);
});
