/**
 * The in-process audit tailer that feeds MCP run-progress (#336 P1, CLM-0148):
 * forwards only THIS run's SIGNIFICANT milestones, rendered, deduped, and never
 * throws on a missing/partial file. Deterministic — the tailer drains
 * immediately at start and on stop, so the tests assert without timing.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startProgressTail } from './progress-tail.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-progress-'));
  file = join(dir, 'audit.jsonl');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeEvents(events: Record<string, unknown>[]): void {
  writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

function collect(runId: string): string[] {
  const msgs: string[] = [];
  startProgressTail({ auditPath: file, runId, onMessage: (m) => msgs.push(m) }).stop();
  return msgs;
}

describe('startProgressTail (#336 P1)', () => {
  it("forwards only this run's SIGNIFICANT milestones, rendered, and drops noise + other runs", () => {
    writeEvents([
      {
        seq: 1,
        ts: '2026-06-19T12:00:00.000Z',
        type: 'kernel.router.route',
        payload: { taskId: 'r1', outcome: 'coder' },
      },
      {
        seq: 2,
        ts: '2026-06-19T12:00:01.000Z',
        type: 'kernel.bus.publish',
        payload: { taskId: 'r1' },
      }, // not significant
      {
        seq: 3,
        ts: '2026-06-19T12:00:02.000Z',
        type: 'loop.spend',
        payload: {
          taskId: 'r1',
          node: 'plan',
          nodeUsd: 0.01,
          nodeTokens: 100,
          cumulativeUsd: 0.01,
        },
      },
      {
        seq: 4,
        ts: '2026-06-19T12:00:03.000Z',
        type: 'cli.run.outcome',
        payload: { taskId: 'r2', status: 'success', capability: 'other', wallClockMs: 5 },
      }, // other run
      {
        seq: 5,
        ts: '2026-06-19T12:00:04.000Z',
        type: 'cli.run.outcome',
        payload: { taskId: 'r1', status: 'success', capability: 'coder', wallClockMs: 9 },
      },
    ]);
    const msgs = collect('r1');
    expect(msgs.some((m) => m.includes('route → coder'))).toBe(true);
    expect(msgs.some((m) => m.includes('spend: plan'))).toBe(true);
    expect(msgs.some((m) => m.includes('outcome: success — coder'))).toBe(true);
    expect(msgs.some((m) => m.includes('bus'))).toBe(false); // noise dropped
    expect(msgs.some((m) => m.includes('other'))).toBe(false); // other run dropped
  });

  it('does not re-forward an event across drains (monotonic dedup)', () => {
    writeEvents([
      {
        seq: 1,
        ts: '2026-06-19T12:00:00.000Z',
        type: 'cli.run.outcome',
        payload: { taskId: 'r1', status: 'success', capability: 'c', wallClockMs: 1 },
      },
    ]);
    // start drains once, stop drains again — the same seq must not double.
    expect(collect('r1').filter((m) => m.includes('outcome: success')).length).toBe(1);
  });

  it('a missing audit file forwards nothing and never throws', () => {
    const msgs: string[] = [];
    const tail = startProgressTail({
      auditPath: join(dir, 'nope.jsonl'),
      runId: 'r1',
      onMessage: (m) => msgs.push(m),
    });
    expect(() => tail.stop()).not.toThrow();
    expect(msgs).toEqual([]);
  });
});
