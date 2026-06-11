/**
 * Portable memory export/import (spec §7: "intuition travels with git clone";
 * spec §12.4: the database is gitignored for privacy, so a reviewable JSON
 * export is the portability path). The exported document is plain
 * JSON-serializable data — semantic facts plus episodic trace summaries — and
 * re-imports loss-free over the existing insert paths (provenance still
 * mandatory; dedup by the existing UNIQUE keys). Faculty isolation holds: this
 * module imports only zod and the faculty's own stores (CLM-0069).
 */
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { rememberFact, type FactRecord } from './semantic.js';
import { recordOutcome } from './episodic.js';
import { OutcomeStatusSchema, type OutcomeStatus } from '@kernloop/contracts';

/** One exported semantic fact — the durable fields, timestamps included. */
export const SemanticFactExportSchema = z.strictObject({
  fact: z.string().min(1),
  provenance: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: z.number().int().nonnegative(),
  refreshedAt: z.number().int().nonnegative(),
});
export type SemanticFactExport = z.infer<typeof SemanticFactExportSchema>;

/** One exported episodic trace summary — never the full transcript (spec §8). */
export const TraceSummaryExportSchema = z.strictObject({
  taskId: z.string().min(1),
  summary: z.string(),
  traceRef: z.string().min(1),
  status: OutcomeStatusSchema,
  distillCandidates: z.array(z.string()),
  createdAt: z.number().int().nonnegative(),
});
export type TraceSummaryExport = z.infer<typeof TraceSummaryExportSchema>;

/** The portable memory document (spec §7). Versioned for forward migration. */
export const MemoryExportSchema = z.strictObject({
  version: z.literal('1'),
  facts: z.array(SemanticFactExportSchema),
  traces: z.array(TraceSummaryExportSchema),
});
export type MemoryExport = z.infer<typeof MemoryExportSchema>;

interface FactExportRow {
  fact: string;
  provenance: string;
  confidence: number | null;
  createdAt: number;
  refreshedAt: number;
}

interface TraceExportRow {
  taskId: string;
  summary: string;
  traceRef: string;
  status: string;
  distillCandidates: string;
  createdAt: number;
}

/**
 * Export every semantic fact and episodic trace summary as a portable,
 * JSON-serializable document (CLM-0069). Facts carry their timestamps so a
 * round-trip preserves the decay clock; traces carry their pointer and status
 * but never the transcript behind `traceRef`.
 */
export function exportMemory(db: Database.Database): MemoryExport {
  const factRows = db
    .prepare(
      'SELECT fact, provenance, confidence, createdAt, refreshedAt FROM facts ORDER BY id ASC',
    )
    .all() as FactExportRow[];
  const facts: SemanticFactExport[] = factRows.map((row) => ({
    fact: row.fact,
    provenance: row.provenance,
    confidence: row.confidence,
    createdAt: row.createdAt,
    refreshedAt: row.refreshedAt,
  }));
  // Insertion order (rowid ASC) — stable through a round-trip so re-export of
  // an imported document is byte-identical (the newest-first read order of
  // listSummaries is for display, not for portability).
  const traceRows = db
    .prepare(
      `SELECT taskId, summary, traceRef, status, distillCandidates, createdAt
       FROM traces ORDER BY rowid ASC`,
    )
    .all() as TraceExportRow[];
  const traces: TraceSummaryExport[] = traceRows.map((row) => ({
    taskId: row.taskId,
    summary: row.summary,
    traceRef: row.traceRef,
    status: row.status as OutcomeStatus,
    distillCandidates: JSON.parse(row.distillCandidates) as string[],
    createdAt: row.createdAt,
  }));
  return { version: '1', facts, traces };
}

/** Upsert one exported fact, preserving its original timestamps. */
function importFact(db: Database.Database, fact: SemanticFactExport): FactRecord {
  const record = rememberFact(db, fact.refreshedAt, {
    fact: fact.fact,
    provenance: fact.provenance,
    ...(fact.confidence === null ? {} : { confidence: fact.confidence }),
  });
  // rememberFact stamps both clocks to `now`; restore the exported createdAt
  // so a round-trip is loss-free on a fresh row (UNIQUE(fact) dedup otherwise).
  db.prepare('UPDATE facts SET createdAt = ? WHERE id = ?').run(fact.createdAt, record.id);
  return { ...record, createdAt: fact.createdAt };
}

/**
 * Import a memory document, upserting through the existing insert paths
 * (CLM-0069). Provenance stays mandatory and dedup uses the existing UNIQUE
 * keys (`facts.fact`, `traces.taskId`). Returns the counts written so the
 * caller can audit the mutation. zod-validates the document at the boundary.
 */
export function importMemory(
  db: Database.Database,
  data: MemoryExport,
): { facts: number; traces: number } {
  const parsed = MemoryExportSchema.parse(data);
  return db.transaction(() => {
    for (const fact of parsed.facts) importFact(db, fact);
    for (const t of parsed.traces) {
      recordOutcome(
        db,
        t.createdAt,
        {
          taskId: t.taskId,
          status: t.status,
          signals: [],
          traceRef: t.traceRef,
          distillCandidates: t.distillCandidates,
          cost: { tokens: 0, usd: 0 },
        },
        t.summary,
      );
    }
    return { facts: parsed.facts.length, traces: parsed.traces.length };
  })();
}
