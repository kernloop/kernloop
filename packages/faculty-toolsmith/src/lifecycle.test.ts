/**
 * Workshop ladder tests (CLM-0054): born suggest, earned advisory after
 * N_CLEAN_RUNS_FOR_ADVISORY consecutive clean runs, enforce only with human
 * ratification, decay one tier per idle window down to removal_proposed.
 * The clock is injected everywhere; nothing here sleeps.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LadderOrderError, RatificationRequiredError, UnknownToolError } from './errors.js';
import {
  N_CLEAN_RUNS_FOR_ADVISORY,
  loadLifecycle,
  promote,
  promoteIfEarned,
  recordRun,
  registerTool,
  sweepDecay,
} from './lifecycle.js';
import { RATIFIED_SANDBOX_PROFILE } from './profile.js';

const DAY = 24 * 60 * 60 * 1000;
const WINDOW = RATIFIED_SANDBOX_PROFILE.decayWindowDays * DAY;

const tmpDirs: string[] = [];
function overlay(name = 'tool'): { overlayDir: string; name: string } {
  const overlayDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolsmith-lifecycle-test-'));
  tmpDirs.push(overlayDir);
  registerTool({ overlayDir, name, at: 0 });
  return { overlayDir, name };
}
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('birth and runs', () => {
  it('registers a tool born at suggest', () => {
    const { overlayDir, name } = overlay();
    const tool = loadLifecycle(overlayDir).tools[name];
    expect(tool).toMatchObject({ tier: 'suggest', cleanRuns: 0, born: 0, status: 'live' });
    expect(loadLifecycle(overlayDir).history).toMatchObject([{ event: 'born', to: 'suggest' }]);
  });

  it('counts consecutive clean runs and resets the streak on an unclean run', () => {
    const { overlayDir, name } = overlay();
    recordRun({ overlayDir, name, clean: true, at: 1 });
    recordRun({ overlayDir, name, clean: true, at: 2 });
    expect(loadLifecycle(overlayDir).tools[name]).toMatchObject({ cleanRuns: 2, lastUsedAt: 2 });
    recordRun({ overlayDir, name, clean: false, at: 3 });
    expect(loadLifecycle(overlayDir).tools[name]).toMatchObject({ cleanRuns: 0, lastUsedAt: 3 });
  });

  it('refuses to record a run for an unknown tool', () => {
    const { overlayDir } = overlay();
    expect(() => recordRun({ overlayDir, name: 'ghost', clean: true, at: 1 })).toThrow(
      UnknownToolError,
    );
  });
});

describe('promotion (CLM-0054)', () => {
  it('promotes to advisory automatically after five consecutive clean runs', () => {
    const { overlayDir, name } = overlay();
    for (let i = 1; i < N_CLEAN_RUNS_FOR_ADVISORY; i++) {
      const tool = recordRun({ overlayDir, name, clean: true, at: i });
      expect(tool.tier).toBe('suggest');
    }
    const tool = recordRun({ overlayDir, name, clean: true, at: 5 });
    expect(tool.tier).toBe('advisory');
    expect(loadLifecycle(overlayDir).history.at(-1)).toMatchObject({
      event: 'promoted',
      from: 'suggest',
      to: 'advisory',
      automatic: true,
    });
  });

  it('an unclean run anywhere in the streak restarts the count to advisory', () => {
    const { overlayDir, name } = overlay();
    for (let i = 1; i <= 4; i++) recordRun({ overlayDir, name, clean: true, at: i });
    recordRun({ overlayDir, name, clean: false, at: 5 });
    for (let i = 6; i <= 9; i++) recordRun({ overlayDir, name, clean: true, at: i });
    expect(loadLifecycle(overlayDir).tools[name]?.tier).toBe('suggest');
  });

  it('promoteIfEarned is a no-op below the threshold', () => {
    const { overlayDir, name } = overlay();
    expect(promoteIfEarned({ overlayDir, name, at: 1 }).tier).toBe('suggest');
  });

  it('promotes to enforce only with human ratification', () => {
    const { overlayDir, name } = overlay();
    for (let i = 1; i <= N_CLEAN_RUNS_FOR_ADVISORY; i++) {
      recordRun({ overlayDir, name, clean: true, at: i });
    }
    expect(() => promote({ overlayDir, name, to: 'enforce', ratifiedBy: '  ' })).toThrow(
      RatificationRequiredError,
    );
    const tool = promote({ overlayDir, name, to: 'enforce', ratifiedBy: 'william', at: 10 });
    expect(tool.tier).toBe('enforce');
    expect(loadLifecycle(overlayDir).history.at(-1)).toMatchObject({
      event: 'promoted',
      to: 'enforce',
      ratifiedBy: 'william',
    });
  });

  it('refuses to promote to enforce from suggest — one rung at a time', () => {
    const { overlayDir, name } = overlay();
    expect(() => promote({ overlayDir, name, to: 'enforce', ratifiedBy: 'william' })).toThrow(
      LadderOrderError,
    );
  });
});

describe('decay (CLM-0054)', () => {
  function enforced(): { overlayDir: string; name: string } {
    const ctx = overlay();
    for (let i = 1; i <= N_CLEAN_RUNS_FOR_ADVISORY; i++) {
      recordRun({ ...ctx, clean: true, at: i });
    }
    promote({ ...ctx, to: 'enforce', ratifiedBy: 'william', at: 10 });
    return ctx;
  }

  it('leaves recently used tools alone', () => {
    const { overlayDir } = overlay();
    expect(sweepDecay({ overlayDir, now: WINDOW - 1 })).toEqual([]);
  });

  it('decays an unused tool one tier per window and proposes removal at suggest', () => {
    const { overlayDir, name } = enforced();
    // One idle window: enforce → advisory, marked, clean streak reset.
    const first = sweepDecay({ overlayDir, now: WINDOW + 11 });
    expect(first).toMatchObject([{ event: 'decayed', from: 'enforce', to: 'advisory' }]);
    expect(loadLifecycle(overlayDir).tools[name]).toMatchObject({
      tier: 'advisory',
      cleanRuns: 0,
      decayedAt: WINDOW + 11,
    });
    // Re-sweeping inside the same window is not a free-fall.
    expect(sweepDecay({ overlayDir, now: WINDOW + 12 })).toEqual([]);
    // Another idle window: advisory → suggest.
    const second = sweepDecay({ overlayDir, now: 2 * WINDOW + 12 });
    expect(second).toMatchObject([{ event: 'decayed', from: 'advisory', to: 'suggest' }]);
    // A third: still unused at suggest → removal proposed (retire() still
    // required for the removal itself — human-ratified).
    const third = sweepDecay({ overlayDir, now: 3 * WINDOW + 13 });
    expect(third).toMatchObject([{ event: 'removal_proposed', automatic: true }]);
    expect(loadLifecycle(overlayDir).tools[name]?.status).toBe('removal_proposed');
    // Idempotent once proposed.
    expect(sweepDecay({ overlayDir, now: 5 * WINDOW })).toEqual([]);
  });

  it('a run inside the window restarts the decay clock', () => {
    const { overlayDir, name } = enforced();
    recordRun({ overlayDir, name, clean: true, at: WINDOW });
    expect(sweepDecay({ overlayDir, now: WINDOW + 11 })).toEqual([]);
    expect(loadLifecycle(overlayDir).tools[name]?.tier).toBe('enforce');
  });
});
