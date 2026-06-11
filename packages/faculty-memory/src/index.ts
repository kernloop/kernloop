/**
 * @kernloop/faculty-memory — Layer 2 memory faculty (spec §5.2).
 *
 * P1 surface: the episodic and semantic stores over repo-local SQLite — one
 * database file per overlay (spec §3.3, §7). The procedural store (SKILL.md
 * via the `distill` ratification path) lands in P3; absent here by design,
 * not stubbed (constitutional rule 1). Auditing of memory operations happens
 * kernel-side at the bus boundary; this faculty imports only
 * @kernloop/contracts and external dependencies (constitutional rule 5).
 */
import type { Outcome } from '@kernloop/contracts';
import { openStore } from './store.js';
import {
  rememberFact,
  recallFacts,
  type FactRecord,
  type RecallOptions,
  type RecalledFact,
  type RememberFactInput,
} from './semantic.js';
import { getTraceSummary, listSummaries, recordOutcome, type TraceSummary } from './episodic.js';
import { exportMemory, importMemory, type MemoryExport } from './export.js';

export { ProvenanceRequiredError, InvalidFactError, InvalidOutcomeError } from './errors.js';
export { SCHEMA_DDL } from './store.js';
export { DECAY_HALF_LIFE_MS, DEFAULT_RECALL_LIMIT } from './semantic.js';
export type { FactRecord, RecalledFact, RememberFactInput, RecallOptions } from './semantic.js';
export { DEFAULT_LIST_LIMIT } from './episodic.js';
export type { TraceSummary } from './episodic.js';
export {
  MemoryExportSchema,
  SemanticFactExportSchema,
  TraceSummaryExportSchema,
} from './export.js';
export type { MemoryExport, SemanticFactExport, TraceSummaryExport } from './export.js';
export { memoryManifest } from './manifest.js';

/** Options for {@link createMemory}. */
export interface CreateMemoryOptions {
  /**
   * Write-time clock returning epoch ms; defaults to `Date.now`. Injectable
   * so decay/refresh behavior is deterministic under test.
   */
  clock?: () => number;
}

/** The memory faculty's API over one overlay database. */
export interface Memory {
  /** Semantic write — provenance mandatory (CLM-0022); refresh on re-write. */
  rememberFact(input: RememberFactInput): FactRecord;
  /** Semantic read — ranked by relevance × provenance × recency (CLM-0023). */
  recallFacts(query: string, options?: RecallOptions): RecalledFact[];
  /** Episodic write — zod-validated Outcome → summary + traceRef (CLM-0024). */
  recordOutcome(outcome: Outcome, summary: string): TraceSummary;
  /** Episodic read — one task's summary, or `undefined` when absent. */
  getTraceSummary(taskId: string): TraceSummary | undefined;
  /** Episodic read — summaries newest-first (CLM-0024). */
  listSummaries(options?: { limit?: number }): TraceSummary[];
  /** Portable export — facts + trace summaries as a JSON document (CLM-0069). */
  exportMemory(): MemoryExport;
  /** Loss-free import — upserts the export over the existing insert paths;
   * returns the counts written so the caller can audit it (CLM-0069). */
  importMemory(data: MemoryExport): { facts: number; traces: number };
  /** Close the underlying database handle. */
  close(): void;
}

/**
 * Open (creating and migrating if absent) the overlay memory database at
 * `dbPath` (spec §7: `.kernloop/memory.sqlite`). Deleting the file and
 * calling this again yields a functional, empty store (CLM-0025).
 */
export function createMemory(dbPath: string, options: CreateMemoryOptions = {}): Memory {
  const clock = options.clock ?? Date.now;
  const db = openStore(dbPath);
  return {
    rememberFact: (input) => rememberFact(db, clock(), input),
    recallFacts: (query, opts) => recallFacts(db, query, opts),
    recordOutcome: (outcome, summary) => recordOutcome(db, clock(), outcome, summary),
    getTraceSummary: (taskId) => getTraceSummary(db, taskId),
    listSummaries: (opts) => listSummaries(db, opts),
    exportMemory: () => exportMemory(db),
    importMemory: (data) => importMemory(db, data),
    close: () => db.close(),
  };
}
