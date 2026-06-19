/**
 * Unit tests for the `observe` tool (spec §8 item 7): telemetry computed
 * from the real audit chain, the real memory store, and live PATH probes —
 * never fabricated.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { QualityCheck } from '@kernloop/faculty-gates';
import { createKernloop, type Kernloop } from '../kernel.js';
import type { LoopInvoke } from '../loop/invoke.js';
import { gateTool } from './gate.js';
import { observeTool } from './observe.js';
import { runTool } from './run.js';

const dirs: string[] = [];
function freshKernloop(): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-observe-'));
  dirs.push(repo);
  const overlayDir = path.join(repo, '.kernloop');
  // Disable the default-on (#227) Docker gate sandbox so the real subprocess check
  // runs deterministically on the host (Docker path covered by #236 gate-tier tests).
  mkdirSync(overlayDir, { recursive: true });
  writeFileSync(
    path.join(overlayDir, 'overlay.yaml'),
    'id: t\ngates:\n  quality:\n    sandbox:\n      enabled: false\n',
  );
  return createKernloop({ overlayDir, rng: () => 0.99 });
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

  it('reports empty observer arrays on a fresh overlay — never invented rows', () => {
    const kern = freshKernloop();
    const report = observeTool(kern, {});
    expect(report.observer).toEqual({
      fitnessLedger: [],
      costPerGovernedDecision: [],
      driftSignals: [],
      voterSeries: [],
      lifecycleProposals: [],
    });
    kern.close();
  });

  it('reflects the real ingested ledger: a run feeds fitness, a vote verdict feeds voter series and gate cost', async () => {
    const kern = freshKernloop();
    await runTool(
      kern,
      {
        goal: 'feed the ledger',
        capability: 'gate.quality',
        workspaceDir: kern.paths.repoRoot,
        id: 'task-obs-ledger',
      },
      { checks: [passingCheck] },
    );
    const scripted: LoopInvoke = () =>
      Promise.resolve({
        output: '{"vote":"approve","reasoning":"ok"}',
        cost: { tokens: 7, usd: 0.01 },
      });
    await gateTool(
      kern,
      { gateName: 'vote', taskId: 'task-obs-vote', proposal: 'observe the ledger' },
      { invoke: scripted },
    );
    const report = observeTool(kern, {});
    // fitness: the run's Outcome was attributed to the selected manifest
    expect(report.observer.fitnessLedger.map((r) => r.subject)).toEqual([
      '@kernloop/faculty-gates@0.1.0',
    ]);
    expect(report.observer.fitnessLedger[0]).toMatchObject({ invocations: 1, successRate: 1 });
    // cost per governed decision, per gate actually seen on the chain
    const gates = report.observer.costPerGovernedDecision.map((c) => c.gate);
    expect(gates).toEqual(['quality', 'vote']);
    const vote = report.observer.costPerGovernedDecision.find((c) => c.gate === 'vote');
    expect(vote).toMatchObject({ decisions: 1, meanTokens: 21 }); // 3 voters × 7 tokens
    // voter series presence: every panel voter has one ingested vote
    expect(report.observer.voterSeries).toEqual([
      { voter: 'architect', votes: 1 },
      { voter: 'scope-steward', votes: 1 },
      { voter: 'security', votes: 1 },
    ]);
    expect(report.observer.driftSignals).toEqual([]); // no drift on a 1-outcome history
    kern.close();
  });

  it('surfaces suggest-tier lifecycle proposals from the real ledger (CLM-0092)', () => {
    const kern = freshKernloop();
    const base = {
      signals: [],
      cost: { tokens: 1, usd: 0, wallClockMs: 1 },
      traceRef: 'trace://x',
      distillCandidates: [],
    } as const;
    // A high-fitness subject → a distill proposal; the observe tool surfaces it.
    for (let i = 0; i < 4; i += 1) {
      kern.observer.ingestOutcome(
        { taskId: `star-${String(i)}`, status: 'success', ...base },
        { subject: 'star-tool' },
      );
    }
    const report = observeTool(kern, {});
    const distill = report.observer.lifecycleProposals.find((p) => p.subject === 'star-tool');
    expect(distill?.kind).toBe('distill');
    expect(distill?.tier).toBe('suggest');
    // Surfacing the proposals filed no issue and mutated nothing.
    expect(kern.observer.listIssues()).toEqual([]);
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
