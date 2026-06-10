import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryCheckpointStore, JsonlCheckpointStore } from './checkpoints.js';
import type { CheckpointRecord } from './state.js';

function record(runId: string, seq: number, node: string): CheckpointRecord {
  return {
    runId,
    seq,
    node,
    iteration: 0,
    state: {
      task: {
        id: 'task-1',
        goal: 'g',
        constraints: [],
        budget: { tokens: 1, usd: 0, wallClockMin: 1 },
        evidence: [],
        definitionOfDone: [],
        authorityCeiling: 'suggest',
        overlay: 'repo',
      },
      status: 'running',
      cursor: { phase: 'main', node: 'research' },
      iteration: 0,
      values: {},
      findings: [],
      children: [],
      childResults: [],
      trace: [{ seq, node, iteration: 0 }],
    },
    createdAt: '2026-06-10T00:00:00.000Z',
  };
}

describe('InMemoryCheckpointStore', () => {
  it('saves, lists in seq order, and returns the latest per run', async () => {
    const store = new InMemoryCheckpointStore();
    await store.save(record('r1', 1, 'frame'));
    await store.save(record('r1', 2, 'research'));
    await store.save(record('r2', 1, 'frame'));
    expect((await store.list('r1')).map((r) => r.seq)).toEqual([1, 2]);
    expect((await store.latest('r1'))?.node).toBe('research');
    expect((await store.latest('r2'))?.seq).toBe(1);
    expect(await store.latest('r3')).toBeUndefined();
    expect(await store.list('r3')).toEqual([]);
  });
});

describe('JsonlCheckpointStore', () => {
  const file = () =>
    path.join(mkdtempSync(path.join(tmpdir(), 'kernloop-wf-')), 'checkpoints.jsonl');

  it('jsonl store round-trips checkpoints through a real file', async () => {
    const target = file();
    const writer = new JsonlCheckpointStore(target);
    await writer.save(record('r1', 1, 'frame'));
    await writer.save(record('r2', 1, 'frame'));
    await writer.save(record('r1', 2, 'research'));
    // A FRESH instance reads the same file: persistence, not memory.
    const reader = new JsonlCheckpointStore(target);
    const records = await reader.list('r1');
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.seq)).toEqual([1, 2]);
    expect(records[1]).toEqual(record('r1', 2, 'research'));
    expect((await reader.latest('r1'))?.node).toBe('research');
    expect(reader.corruptLines).toBe(0);
  });

  it('returns empty for a file that does not exist yet', async () => {
    const store = new JsonlCheckpointStore(file());
    expect(await store.list('r1')).toEqual([]);
    expect(await store.latest('r1')).toBeUndefined();
  });

  it('jsonl reads skip corrupt lines and resume from the last complete checkpoint', async () => {
    const target = file();
    const store = new JsonlCheckpointStore(target);
    await store.save(record('r1', 1, 'frame'));
    await store.save(record('r1', 2, 'research'));
    const intact = readFileSync(target, 'utf8');
    // A schema-invalid record, free-text garbage, and a torn tail line —
    // exactly what a kill mid-write leaves behind.
    writeFileSync(
      target,
      `${JSON.stringify({ runId: 'r1', seq: 'NaN' })}\nnot json at all\n${intact}{"runId":"r1","seq":3,"nod`,
      'utf8',
    );
    const reader = new JsonlCheckpointStore(target);
    const records = await reader.list('r1');
    expect(records.map((r) => r.seq)).toEqual([1, 2]);
    expect((await reader.latest('r1'))?.node).toBe('research');
    // The damage is counted, never silently repaired.
    expect(reader.corruptLines).toBeGreaterThanOrEqual(3);
  });

  it('creates parent directories on first save', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-wf-'));
    const nested = path.join(dir, 'a', 'b', 'checkpoints.jsonl');
    const store = new JsonlCheckpointStore(nested);
    await store.save(record('r1', 1, 'frame'));
    expect((await store.latest('r1'))?.seq).toBe(1);
  });
});
