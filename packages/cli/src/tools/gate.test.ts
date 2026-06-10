/**
 * Unit tests for the `gate` tool: every quality-gate Verdict appends to the
 * audit chain [CLM-0032]; unknown gates are typed errors, not stubs.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyChain } from '@kernloop/kernel';
import type { QualityCheck } from '@kernloop/faculty-gates';
import { createKernloop, type Kernloop } from '../kernel.js';
import { readEnvelopes } from './audit.js';
import { UnknownGateError, gateTool } from './gate.js';

const dirs: string[] = [];
function freshKernloop(): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-gate-'));
  dirs.push(repo);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop') });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A real check that runs node and exits with the given code. */
function nodeCheck(name: string, exitCode: number): QualityCheck {
  return {
    name,
    command: process.execPath,
    args: ['-e', `process.exit(${String(exitCode)})`],
    parse: () => [],
  };
}

describe('gateTool', () => {
  it('appends every quality-gate Verdict to the audit chain, and the chain verifies', async () => {
    const kern = freshKernloop();
    const verdict = await gateTool(
      kern,
      { gateName: 'quality', taskId: 'task-gate-1', workspaceDir: kern.paths.repoRoot },
      { checks: [nodeCheck('ok', 0)] },
    );
    expect(verdict.result).toBe('pass');
    const envelopes = readEnvelopes(kern.paths.audit);
    const publish = envelopes.find(
      (e) =>
        e.type === 'kernel.bus.publish' &&
        (e.payload as { contract: string }).contract === 'Verdict',
    );
    expect((publish?.payload as { messageId: string }).messageId).toBe('task-gate-1');
    const telemetry = envelopes.find((e) => e.type === 'cli.gate.verdict');
    expect(telemetry?.payload).toMatchObject({
      taskId: 'task-gate-1',
      gate: 'quality',
      result: 'pass',
    });
    expect(verifyChain(kern.store).ok).toBe(true);
    kern.close();
  });

  it('emits a fail Verdict (also audited) when a check fails', async () => {
    const kern = freshKernloop();
    const verdict = await gateTool(
      kern,
      { gateName: 'quality', taskId: 'task-gate-2', workspaceDir: kern.paths.repoRoot },
      { checks: [nodeCheck('broken', 1)] },
    );
    expect(verdict.result).toBe('fail');
    expect(verdict.findings.some((f) => f.severity === 'error')).toBe(true);
    const telemetry = readEnvelopes(kern.paths.audit).find((e) => e.type === 'cli.gate.verdict');
    expect((telemetry?.payload as { result: string }).result).toBe('fail');
    kern.close();
  });

  it('rejects unknown gates with a typed error — vote and review are absent, not stubbed', async () => {
    const kern = freshKernloop();
    await expect(
      gateTool(kern, { gateName: 'vote', taskId: 't', workspaceDir: kern.paths.repoRoot }),
    ).rejects.toThrow(UnknownGateError);
    await expect(
      gateTool(kern, { gateName: 'review', taskId: 't', workspaceDir: kern.paths.repoRoot }),
    ).rejects.toThrow(/P1 ships quality only/);
    kern.close();
  });
});
