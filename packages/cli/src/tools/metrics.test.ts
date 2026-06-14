/**
 * Tests for `kernloop metrics` (#125): Prometheus exposition text DERIVED from
 * the real audit chain and Observer ledger of a fresh overlay — never fabricated.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { QualityCheck } from '@kernloop/faculty-gates';
import { createKernloop, type Kernloop } from '../kernel.js';
import { runTool } from './run.js';
import { escapeLabel, metricsExport } from './metrics.js';

const dirs: string[] = [];
function freshKernloop(): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-metrics-'));
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

describe('metricsExport', () => {
  it('emits Prometheus runs/verdicts/chain metrics derived from real events', async () => {
    const kern = freshKernloop();
    await runTool(
      kern,
      {
        goal: 'metric a gate',
        capability: 'gate.quality',
        workspaceDir: kern.paths.repoRoot,
        id: 'task-m-1',
      },
      { checks: [passingCheck] },
    );
    const text = metricsExport(kern);

    // Run outcome by capability+status (a passing quality gate run succeeded).
    expect(text).toContain('# TYPE kernloop_runs_total counter');
    expect(text).toContain('kernloop_runs_total{capability="gate.quality",status="success"} 1');
    // Gate verdict by gate+result.
    expect(text).toContain('kernloop_gate_verdicts_total{gate="quality",result="pass"} 1');
    // Chain health.
    expect(text).toContain('kernloop_audit_chain_verified 1');
    expect(text).toMatch(/kernloop_audit_chain_length \d+/);
    // Cost totals are present (counters), even at zero.
    expect(text).toContain('# TYPE kernloop_cost_usd_total counter');
    expect(text).toContain('# TYPE kernloop_cost_tokens_total counter');
    // The exposition ends in exactly one trailing newline.
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    kern.close();
  });

  it('every metric family carries a HELP and TYPE header (discoverable even when empty)', () => {
    const kern = freshKernloop();
    const text = metricsExport(kern); // empty overlay — no runs yet
    for (const name of [
      'kernloop_runs_total',
      'kernloop_gate_verdicts_total',
      'kernloop_cost_usd_total',
      'kernloop_running_precision',
      'kernloop_cost_per_governed_decision_usd',
    ]) {
      expect(text).toContain(`# HELP ${name} `);
      expect(text).toContain(`# TYPE ${name} `);
    }
    kern.close();
  });

  it('escapeLabel escapes backslash, quote, and newline for a safe exposition', () => {
    expect(escapeLabel('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd');
    expect(escapeLabel('plain')).toBe('plain');
  });
});
