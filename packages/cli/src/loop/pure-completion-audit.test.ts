/**
 * Degraded pure-completion coverage audit (#148 hardening, #355). Reasoning nodes
 * request a tool-free run, but only some CLIs enforce that fully; this records a
 * visible `cli.run.pure-completion-degraded` event when the run's adapter has less
 * than `full` coverage, so a degraded posture is never silently confused with
 * policy. A `full`-coverage adapter (claude) emits nothing.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuditStore } from '@kernloop/kernel';
import { readEnvelopes } from '../tools/audit.js';
import { auditPureCompletionCoverage } from './index.js';

describe('auditPureCompletionCoverage (#355)', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const storeIn = () => {
    dir = mkdtempSync(join(tmpdir(), 'kernloop-purecov-'));
    return { store: createAuditStore(join(dir, 'audit.jsonl')), path: join(dir, 'audit.jsonl') };
  };

  it('records a degraded event for a partial-coverage adapter (codex)', () => {
    const { store, path } = storeIn();
    auditPureCompletionCoverage(store, 'codex', 'run-1');
    const events = readEnvelopes(path).filter((e) => e.type === 'cli.run.pure-completion-degraded');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      runId: 'run-1',
      adapter: 'codex',
      coverage: 'partial',
    });
  });

  it('records a degraded event for a no-coverage adapter (opencode)', () => {
    const { store, path } = storeIn();
    auditPureCompletionCoverage(store, 'opencode', 'run-2');
    const events = readEnvelopes(path).filter((e) => e.type === 'cli.run.pure-completion-degraded');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ adapter: 'opencode', coverage: 'none' });
  });

  it('emits NOTHING for a full-coverage adapter (claude) — no audit noise on the common path', () => {
    const { store, path } = storeIn();
    auditPureCompletionCoverage(store, 'claude', 'run-3');
    expect(
      readEnvelopes(path).filter((e) => e.type === 'cli.run.pure-completion-degraded'),
    ).toEqual([]);
  });
});
