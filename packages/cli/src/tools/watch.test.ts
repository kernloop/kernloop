/**
 * Tests for `kernloop watch` (#126): the pure render/filter/snapshot core over a
 * seeded audit JSONL, plus the command's `--once` snapshot, terminal-exit, and
 * timeout paths. Read-only throughout — no kernel, no model.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isTerminal,
  matchesFilter,
  readAuditEvents,
  renderEvent,
  watchSnapshot,
  type WatchEvent,
} from './watch.js';
import { watchCommand } from '../watch-commands.js';

const ev = (seq: number, type: string, payload: Record<string, unknown>): WatchEvent => ({
  seq,
  ts: '2026-06-14T08:34:25.000Z',
  type,
  payload,
});

describe('readAuditEvents', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'watch-read-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns [] for a missing file (degrades, never throws)', () => {
    expect(readAuditEvents(path.join(dir, 'gone.jsonl'))).toEqual([]);
  });

  it('reads valid lines and SKIPS a partial/corrupt trailing line (live append)', () => {
    const file = path.join(dir, 'a.jsonl');
    writeFileSync(
      file,
      [
        JSON.stringify({ seq: 1, ts: 't', type: 'cli.run.outcome', payload: { taskId: 'T' } }),
        '{"seq":2,"type":"cli.gate.ver"' /* a half-written line */,
      ].join('\n'),
    );
    const events = readAuditEvents(file);
    expect(events).toHaveLength(1);
    expect(events[0]?.seq).toBe(1);
  });
});

describe('matchesFilter', () => {
  it('matches by taskId/runId/childId/jobId, including child ids, and all when unfiltered', () => {
    expect(matchesFilter(ev(1, 'x', { taskId: 'T' }), 'T')).toBe(true);
    expect(matchesFilter(ev(1, 'x', { runId: 'R' }), 'R')).toBe(true);
    expect(matchesFilter(ev(1, 'x', { childId: 'T.1' }), 'T')).toBe(true); // child of T
    expect(matchesFilter(ev(1, 'x', { jobId: 'J' }), 'J')).toBe(true);
    expect(matchesFilter(ev(1, 'x', { taskId: 'OTHER' }), 'T')).toBe(false);
    expect(matchesFilter(ev(1, 'x', {}), undefined)).toBe(true);
  });
});

describe('isTerminal + renderEvent', () => {
  it('flags run.outcome and job.finished as terminal', () => {
    expect(isTerminal(ev(1, 'cli.run.outcome', {}))).toBe(true);
    expect(isTerminal(ev(1, 'cli.job.finished', {}))).toBe(true);
    expect(isTerminal(ev(1, 'cli.gate.verdict', {}))).toBe(false);
  });

  it('renders each significant type readably and skips noise', () => {
    expect(renderEvent(ev(3, 'kernel.bus.publish', {}))).toBeUndefined(); // noise
    expect(renderEvent(ev(4, 'kernel.router.route', { outcome: 'routed' }))).toContain(
      'route → routed',
    );
    const verdict = renderEvent(
      ev(5, 'cli.gate.verdict', {
        gate: 'vote',
        result: 'approve',
        findings: 1,
        voters: ['a', 'b'],
      }),
    );
    expect(verdict).toContain('gate vote: approve');
    expect(verdict).toContain('1 finding(s)');
    expect(verdict).toContain('voters: a, b');
    expect(
      renderEvent(ev(6, 'loop.child.iterate', { childId: 'T.1', iteration: 2, gate: 'quality' })),
    ).toContain('re-iterate child T.1 #2 after quality gate');
    const ok = renderEvent(
      ev(7, 'cli.run.outcome', { status: 'success', capability: 'c', wallClockMs: 42 }),
    );
    expect(ok).toContain('✓ outcome: success');
    expect(ok).toContain('(42ms)');
    expect(renderEvent(ev(8, 'cli.run.outcome', { status: 'failure' }))).toContain(
      '✗ outcome: failure',
    );
    // The HH:MM:SS prefix is sliced from the ISO timestamp.
    expect(renderEvent(ev(4, 'loop.document', {}))).toMatch(/^08:34:25 #4 /);
    // In-flight spend (#230): per-node delta + cumulative, with the child tag.
    const spend = renderEvent(
      ev(9, 'loop.spend', {
        node: 'quality',
        childId: 'T.1',
        nodeTokens: 1245,
        nodeUsd: 0.0142,
        cumulativeTokens: 5000,
        cumulativeUsd: 0.21,
      }),
    );
    expect(spend).toContain('spend: quality [T.1] +$0.0142 (1245 tok)');
    expect(spend).toContain('→ $0.2100 cumulative');
  });
});

describe('watchSnapshot', () => {
  it('headers the matching significant events and ends in one newline', () => {
    const events = [
      ev(1, 'kernel.router.route', { outcome: 'routed' }),
      ev(2, 'kernel.bus.publish', {}), // noise, dropped
      ev(3, 'cli.run.outcome', { taskId: 'T', status: 'success', capability: 'c' }),
      ev(4, 'cli.run.outcome', { taskId: 'OTHER', status: 'success' }), // filtered out
    ];
    const snap = watchSnapshot(events, 'T');
    expect(snap).toContain('kernloop watch — 1 event(s) for T');
    expect(snap).toContain('outcome: success');
    expect(snap).not.toContain('OTHER');
    expect(snap.endsWith('\n')).toBe(true);
  });
});

describe('watchSnapshot verbose replay (#336 D, CLM-0150)', () => {
  // A finished run as the loop ACTUALLY persists it (#343): spend/node-lifecycle
  // carry BOTH taskId and the loop's internal runId, so a snapshot filtered by the
  // caller-known taskId catches them even though runId differs.
  const run = [
    ev(1, 'kernel.router.route', { taskId: 'task-X', outcome: 'workflow.canonical' }),
    ev(2, 'loop.node.start', { taskId: 'task-X', runId: 'run-uuid', node: 'plan' }),
    ev(3, 'loop.spend', {
      taskId: 'task-X',
      runId: 'run-uuid',
      node: 'plan',
      nodeUsd: 0.02,
      nodeTokens: 50,
      cumulativeUsd: 0.02,
    }),
    ev(4, 'loop.node.finish', { taskId: 'task-X', runId: 'run-uuid', node: 'plan' }),
    ev(5, 'cli.run.outcome', {
      taskId: 'task-X',
      status: 'success',
      capability: 'workflow.canonical',
    }),
  ];

  it('default snapshot shows milestones but OMITS the per-node lifecycle', () => {
    const snap = watchSnapshot(run, 'task-X');
    expect(snap).toContain('route → workflow.canonical');
    expect(snap).toContain('spend: plan');
    expect(snap).toContain('outcome: success');
    expect(snap).not.toContain('▶ plan'); // node lifecycle suppressed at default
    expect(snap).not.toContain('(verbose)');
  });

  it('--verbose replays the FULL trail — adds the per-node ▶/■ lifecycle (superset of default)', () => {
    const snap = watchSnapshot(run, 'task-X', { verbose: true });
    expect(snap).toContain('(verbose)');
    expect(snap).toContain('▶ plan');
    expect(snap).toContain('■ plan done');
    expect(snap).toContain('spend: plan'); // still includes the default milestones
    expect(snap).toContain('outcome: success');
  });

  it('catches runId-keyed loop events by the caller-known taskId (#343 regression)', () => {
    // The fix: loop.node.* carry taskId, so a task.id filter reaches them.
    expect(watchSnapshot(run, 'task-X', { verbose: true })).toContain('▶ plan');
    // The PRE-fix shape (runId only, no taskId) is MISSED by a task-id filter —
    // exactly the silent gap dogfooding caught (#343).
    const oldShape = [ev(1, 'loop.node.start', { runId: 'run-uuid', node: 'plan' })];
    expect(watchSnapshot(oldShape, 'task-X', { verbose: true })).not.toContain('plan');
  });
});

describe('watchCommand', () => {
  let dir: string;
  let auditDir: string;
  let lines: string[];
  const io = () => ({ out: (s: string) => lines.push(s), err: () => {}, cwd: dir });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'watch-cmd-'));
    auditDir = path.join(dir, '.kernloop');
    mkdirSync(auditDir, { recursive: true });
    lines = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function seed(
    events: Array<{ seq: number; type: string; payload: Record<string, unknown> }>,
  ): void {
    writeFileSync(
      path.join(auditDir, 'audit.jsonl'),
      events.map((e) => JSON.stringify({ ts: '2026-06-14T08:00:00.000Z', ...e })).join('\n') + '\n',
    );
  }

  it('--once prints a snapshot of the matching events and exits', async () => {
    seed([
      { seq: 1, type: 'kernel.router.route', payload: { outcome: 'routed' } },
      {
        seq: 2,
        type: 'cli.run.outcome',
        payload: { taskId: 'T', status: 'success', capability: 'c' },
      },
    ]);
    const code = await watchCommand(['--once'], io());
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('outcome: success');
  });

  it('following with a task filter exits when that run reaches a terminal Outcome', async () => {
    seed([
      { seq: 1, type: 'kernel.router.route', payload: { outcome: 'routed' } },
      {
        seq: 2,
        type: 'cli.gate.verdict',
        payload: { taskId: 'T', gate: 'quality', result: 'pass' },
      },
      {
        seq: 3,
        type: 'cli.run.outcome',
        payload: { taskId: 'T', status: 'success', capability: 'c' },
      },
    ]);
    const code = await watchCommand(['--task-id', 'T'], io());
    expect(code).toBe(0); // terminal in the catch-up → returns without polling
    expect(lines.join('\n')).toContain('gate quality: pass');
    expect(lines.join('\n')).toContain('✓ outcome: success');
  });

  it('following times out when no terminal lands inside the budget', async () => {
    seed([{ seq: 1, type: 'kernel.router.route', payload: { taskId: 'T', outcome: 'routed' } }]);
    const code = await watchCommand(
      ['--task-id', 'T', '--timeout-ms', '30', '--interval-ms', '10'],
      io(),
    );
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('timed out');
  });
});
