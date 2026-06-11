/**
 * Round-trip tests for the portable memory export (CLM-0069): semantic facts
 * and episodic trace summaries export to a JSON document and re-import
 * loss-free into a fresh overlay, so an overlay's memory can travel with the
 * repo (spec §7).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemory, MemoryExportSchema, type Memory } from './index.js';
import type { Outcome } from '@kernloop/contracts';

const dirs: string[] = [];
function memory(clock = () => 1_000): Memory {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-mem-export-'));
  dirs.push(dir);
  return createMemory(path.join(dir, 'memory.sqlite'), { clock });
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function outcome(taskId: string, status: Outcome['status'] = 'success'): Outcome {
  return {
    taskId,
    status,
    signals: [],
    cost: { tokens: 5, usd: 0.01 },
    traceRef: `audit:./x#task=${taskId}`,
    distillCandidates: ['skill-a'],
  };
}

describe('exportMemory / importMemory', () => {
  it('exports a schema-valid, JSON-serializable document', () => {
    const mem = memory();
    mem.rememberFact({ fact: 'epsilon is 0.1', provenance: 'spec §3.2', confidence: 0.9 });
    mem.recordOutcome(outcome('task-1'), 'did the thing');
    const doc = mem.exportMemory();
    // schema-valid and survives a JSON round-trip unchanged
    expect(MemoryExportSchema.parse(doc)).toEqual(doc);
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
    expect(doc.version).toBe('1');
    expect(doc.facts).toHaveLength(1);
    expect(doc.traces).toHaveLength(1);
    mem.close();
  });

  it('round-trips facts and traces loss-free into a fresh overlay', () => {
    const source = memory(() => 42_000);
    source.rememberFact({ fact: 'router explores', provenance: 'spec §3.2', confidence: 0.8 });
    source.rememberFact({ fact: 'gates emit verdicts', provenance: 'spec §5.3' });
    source.recordOutcome(outcome('task-a', 'success'), 'summary a');
    source.recordOutcome(outcome('task-b', 'failure'), 'summary b');
    const exported = source.exportMemory();
    source.close();

    const fresh = memory(() => 99_000); // different clock — import must not restamp
    const counts = fresh.importMemory(exported);
    expect(counts).toEqual({ facts: 2, traces: 2 });
    expect(fresh.exportMemory()).toEqual(exported);
    fresh.close();
  });

  it('preserves the decay clock so recall ranking survives the trip', () => {
    const source = memory(() => 10_000);
    source.rememberFact({ fact: 'fresh fact', provenance: 'p' });
    const exported = source.exportMemory();
    source.close();
    const fresh = memory(() => 5_000_000);
    fresh.importMemory(exported);
    // recall at the original refreshedAt scores ~1; the timestamp travelled.
    const [recalled] = fresh.recallFacts('fresh fact', { now: 10_000 });
    expect(recalled?.refreshedAt).toBe(10_000);
    expect(recalled?.score).toBeGreaterThan(0.99);
    fresh.close();
  });

  it('dedups on re-import by the existing UNIQUE keys (idempotent)', () => {
    const source = memory();
    source.rememberFact({ fact: 'one fact', provenance: 'p' });
    source.recordOutcome(outcome('task-x'), 's');
    const doc = source.exportMemory();
    source.close();
    const fresh = memory();
    fresh.importMemory(doc);
    fresh.importMemory(doc); // second import must not duplicate
    const after = fresh.exportMemory();
    expect(after.facts).toHaveLength(1);
    expect(after.traces).toHaveLength(1);
    fresh.close();
  });

  it('rejects a malformed document at the import boundary', () => {
    const fresh = memory();
    expect(() => fresh.importMemory({ version: '2' } as never)).toThrow();
    fresh.close();
  });

  it('keeps provenance mandatory on import (rejects an empty-provenance fact)', () => {
    const fresh = memory();
    expect(() =>
      fresh.importMemory({
        version: '1',
        facts: [{ fact: 'x', provenance: '', confidence: null, createdAt: 1, refreshedAt: 1 }],
        traces: [],
      } as never),
    ).toThrow();
    fresh.close();
  });
});
