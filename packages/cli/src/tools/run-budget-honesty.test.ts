/**
 * Unit tests for `auditUsdBudgetUnenforceable` [CLM-0077] — the usd-budget metering
 * honesty surface (#462/#469/#470). Split from run.test.ts (the helper has its own
 * module, so its tests do too) to keep each test file under the 400-LOC budget.
 *
 * Most cases call the helper directly (it is the single place the degradation is
 * recorded — one cheap call per case, no routing); the last case drives the full
 * runTool path to prove the `dispatchSelected` capability wiring (#469).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskContract } from '@kernloop/contracts';
import { createKernloop, type Kernloop } from '../kernel.js';
import { readEnvelopes } from './audit.js';
import { runTool } from './run.js';
import { auditUsdBudgetUnenforceable } from './run-budget-honesty.js';

const dirs: string[] = [];
function freshKernloop(): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-budget-'));
  dirs.push(repo);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}

/** A kernloop whose overlay registers two endpoints: one unmetered (default), one metersUsd:true. */
function freshKernloopWithEndpoints(): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-budget-ep-'));
  dirs.push(repo);
  const overlayDir = path.join(repo, '.kernloop');
  mkdirSync(overlayDir, { recursive: true });
  const cfg = [
    'id: run-endpoint-test',
    'endpoints:',
    '  unmetered:', // metersUsd omitted ⇒ defaults to false (the silently-inert-cap case #470)
    '    baseUrl: https://example.test/v1',
    '    apiKeyEnv: RUN_TEST_KEY',
    '    models: { large: served-large }',
    '  metered:',
    '    baseUrl: https://example.test/v1',
    '    apiKeyEnv: RUN_TEST_KEY',
    '    metersUsd: true',
    '    models: { large: served-large }',
    '',
  ].join('\n');
  writeFileSync(path.join(overlayDir, 'overlay.yaml'), cfg);
  return createKernloop({ overlayDir, rng: () => 0.99 });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('usd-budget-unenforceable honesty (#462, gated to workflow.canonical #469, endpoint half #470)', () => {
  const taskWith = (id: string, usd: number): TaskContract =>
    ({ id, budget: { tokens: 100000, usd, wallClockMin: 30 } }) as unknown as TaskContract;
  const LOOP = 'workflow.canonical';
  const usdEvents = (kern: Kernloop) =>
    readEnvelopes(kern.paths.audit).filter((e) => e.type === 'cli.budget.usd-unenforceable');

  it('AUDITS + RETURNS a warn finding when a usd budget runs on a non-metering adapter (codex) — never silently inert (#463)', () => {
    const kern = freshKernloop();
    const finding = auditUsdBudgetUnenforceable(kern, taskWith('task-usd-codex', 1), {
      adapter: 'codex',
      unlimited: false,
      capability: LOOP,
    });
    const events = usdEvents(kern);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      adapter: 'codex',
      usdBudget: 1,
      taskId: 'task-usd-codex',
      metersTokens: true,
    });
    // codex meters tokens, so the reason honestly says the token budget still bounds it.
    expect((events[0]?.payload as { reason: string }).reason).toContain('TOKEN budget');
    // #463: the degradation is also returned as a visible warn finding for the run result.
    expect(finding?.severity).toBe('warn');
    expect(finding?.message).toContain('NOT enforced');
    expect(finding?.message).toContain('codex');
    kern.close();
  });

  it('audits HONESTLY for a fully-unmetered adapter (agy): NEITHER budget applies, not "token budget still applies" (#462)', () => {
    const kern = freshKernloop();
    auditUsdBudgetUnenforceable(kern, taskWith('task-usd-agy', 1), {
      adapter: 'agy',
      unlimited: false,
      capability: LOOP,
    });
    const events = usdEvents(kern);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ adapter: 'agy', metersTokens: false });
    const reason = (events[0]?.payload as { reason: string }).reason;
    // The honesty fix: must NOT claim the token budget bounds a no-usage adapter.
    expect(reason).toContain('wallClock');
    expect(reason).not.toContain('TOKEN budget still bounds');
    kern.close();
  });

  it('does NOT audit for a non-loop capability — it consults NO budget, so the record would mislead (#469)', () => {
    const kern = freshKernloop();
    for (const capability of ['memory.episodic.read', 'gate.quality', 'brief.compile']) {
      auditUsdBudgetUnenforceable(kern, taskWith('task-usd-nonloop', 1), {
        adapter: 'codex',
        unlimited: false,
        capability,
      });
    }
    expect(usdEvents(kern)).toHaveLength(0);
    kern.close();
  });

  it('does NOT audit (and returns no finding) when the adapter meters usd (claude)', () => {
    const kern = freshKernloop();
    const finding = auditUsdBudgetUnenforceable(kern, taskWith('task-usd-claude', 1), {
      adapter: 'claude',
      unlimited: false,
      capability: LOOP,
    });
    expect(usdEvents(kern)).toHaveLength(0);
    expect(finding).toBeNull(); // #463: nothing to surface when the cap IS enforceable
    kern.close();
  });

  it('does NOT audit in unlimited mode (the usd budget is not enforced anyway)', () => {
    const kern = freshKernloop();
    auditUsdBudgetUnenforceable(kern, taskWith('task-usd-unlimited', 1), {
      adapter: 'codex',
      unlimited: true,
      capability: LOOP,
    });
    expect(usdEvents(kern)).toHaveLength(0);
    kern.close();
  });

  it('does NOT audit when there is no usd budget (usd: 0)', () => {
    const kern = freshKernloop();
    auditUsdBudgetUnenforceable(kern, taskWith('task-usd-zero', 0), {
      adapter: 'codex',
      unlimited: false,
      capability: LOOP,
    });
    expect(usdEvents(kern)).toHaveLength(0);
    kern.close();
  });

  it('AUDITS the ENDPOINT half: a metersUsd:false endpoint has the same silently-inert usd cap (#470)', () => {
    const kern = freshKernloopWithEndpoints();
    auditUsdBudgetUnenforceable(kern, taskWith('task-usd-endpoint', 1), {
      adapter: 'unmetered',
      unlimited: false,
      capability: LOOP,
    });
    const events = usdEvents(kern);
    expect(events).toHaveLength(1);
    // Endpoint token metering is runtime-dependent, so the static metersTokens fact is null.
    expect(events[0]?.payload).toMatchObject({ adapter: 'unmetered', metersTokens: null });
    const reason = (events[0]?.payload as { reason: string }).reason;
    expect(reason).toContain('endpoint');
    expect(reason).toContain('endpoint-dependent');
    kern.close();
  });

  it('does NOT audit a metersUsd:true endpoint (its own #393 handling enforces the cap)', () => {
    const kern = freshKernloopWithEndpoints();
    auditUsdBudgetUnenforceable(kern, taskWith('task-usd-endpoint-metered', 1), {
      adapter: 'metered',
      unlimited: false,
      capability: LOOP,
    });
    expect(usdEvents(kern)).toHaveLength(0);
    kern.close();
  });

  it('does NOT audit an UNKNOWN adapter (neither a CLI adapter nor a registered endpoint)', () => {
    const kern = freshKernloopWithEndpoints();
    auditUsdBudgetUnenforceable(kern, taskWith('task-usd-unknown', 1), {
      adapter: 'no-such-adapter',
      unlimited: false,
      capability: LOOP,
    });
    expect(usdEvents(kern)).toHaveLength(0);
    kern.close();
  });

  it('end-to-end: dispatchSelected threads the real parsed.capability so a non-loop run never audits (#469 wiring)', async () => {
    // Drives the full runTool path (not the helper directly) to prove the
    // `capability: parsed.capability` plumb in dispatchSelected reaches the gate —
    // a non-loop capability on codex with a usd budget must emit no degradation record.
    const kern = freshKernloop();
    await runTool(kern, {
      goal: 'a non-loop run with a usd budget on codex',
      capability: 'memory.episodic.read',
      id: 'task-usd-wiring',
      budget: { tokens: 100000, usd: 1, wallClockMin: 30 },
      adapter: 'codex',
    });
    expect(usdEvents(kern)).toHaveLength(0);
    kern.close();
  });
});
