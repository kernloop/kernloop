/**
 * Unit tests for the `observe` tool (spec §8 item 7): telemetry computed
 * from the real audit chain, the real memory store, and live PATH probes —
 * never fabricated.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { QualityCheck } from '@kernloop/faculty-gates';
import { createKernloop, type Kernloop } from '../kernel.js';
import { observeTool } from './observe.js';
import { runTool } from './run.js';

const dirs: string[] = [];
function freshKernloop(): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-observe-'));
  dirs.push(repo);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const passingCheck: QualityCheck = {
  name: 'ok',
  command: process.execPath,
  args: ['-e', 'process.exit(0)'],
  parse: () => [],
};

describe('observeTool', () => {
  it('derives event counts, routing, verdict, and outcome figures from the audit chain', async () => {
    const kern = freshKernloop();
    await runTool(
      kern,
      {
        goal: 'observe a gate',
        capability: 'gate.quality',
        workspaceDir: kern.paths.repoRoot,
        id: 'task-obs-1',
      },
      { checks: [passingCheck] },
    );
    await runTool(kern, {
      goal: 'observe a recall',
      capability: 'memory.semantic.recall',
      id: 'task-obs-2',
    });
    const report = observeTool(kern, {});
    expect(report.audit.verified).toBe(true);
    expect(report.audit.length).toBeGreaterThan(0);
    expect(report.routing.decisions).toBe(2);
    expect(report.routing.routed).toBe(2);
    expect(report.verdicts).toEqual({ total: 1, pass: 1, fail: 0 });
    expect(report.outcomes.total).toBe(2);
    expect(report.outcomes.byStatus.success).toBe(2);
    expect(report.outcomes.totalWallClockMs).toBeGreaterThan(0);
    expect(report.eventCounts['kernel.router.route']).toBe(2);
    expect(report.eventCounts['cli.gate.verdict']).toBe(1);
    kern.close();
  });

  it('counts episodic traces from the real memory store', async () => {
    const kern = freshKernloop();
    expect(observeTool(kern, {}).memory.episodicTraces).toBe(0);
    await runTool(kern, {
      goal: 'one trace',
      capability: 'memory.episodic.read',
      id: 'task-obs-3',
    });
    expect(observeTool(kern, {}).memory.episodicTraces).toBe(1);
    kern.close();
  });

  it('probes all five adapters for availability and marks ollama experimental', () => {
    const kern = freshKernloop();
    const report = observeTool(kern, {});
    expect(report.adapters.map((a) => a.adapter)).toEqual([
      'claude',
      'codex',
      'gemini',
      'opencode',
      'ollama',
    ]);
    for (const adapter of report.adapters) {
      expect(typeof adapter.available).toBe('boolean');
    }
    expect(report.adapters.find((a) => a.adapter === 'ollama')?.experimental).toBe(true);
    kern.close();
  });
});
