import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as observerExports from './index.js';

describe('the no-privileged-path property (CLM-0056)', () => {
  it('exposes no privileged observer-to-engine path — the task-shaped payload re-enters via the ordinary run entry', () => {
    // 1. The public runtime surface is EXACTLY this — no executor, no engine,
    //    no run coupling. The Observer proposes; humans and the scheduler feed
    //    the proposal's task-shaped goal to `run` like any other work.
    expect(Object.keys(observerExports).sort()).toEqual([
      'DEFAULT_DRIFT_MIN_DROP',
      'DEFAULT_DRIFT_WINDOW_N',
      'DEFAULT_PRECISION_WINDOW_N',
      'InvalidIssueProposalError',
      'InvalidOutcomeError',
      'InvalidVerdictError',
      'ObserverTrackerUnavailableError',
      'PriorsExportSchema',
      'RoutingPriorSchema',
      'SCHEMA_DDL',
      'createObserver',
      'issueBody',
      'observerManifest',
    ]);

    // 2. The package depends on contracts + storage only — no kernel, no
    //    workflows, no cli, no other faculty (constitutional rule 5).
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@kernloop/contracts',
      'better-sqlite3',
      'zod',
    ]);
  });

  it('exposes the documented observer API surface', () => {
    expect(typeof observerExports.createObserver).toBe('function');
    expect(typeof observerExports.SCHEMA_DDL).toBe('string');
    expect(observerExports.DEFAULT_DRIFT_WINDOW_N).toBe(10);
    expect(observerExports.DEFAULT_DRIFT_MIN_DROP).toBe(0.2);
    expect(observerExports.DEFAULT_PRECISION_WINDOW_N).toBe(20);
  });
});
