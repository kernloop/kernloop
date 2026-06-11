/**
 * `memory export` / `memory import` (spec §7: "intuition travels with git
 * clone"; spec §12.4: `memory.sqlite` is gitignored for privacy, so a
 * reviewable JSON export is the portability path) [CLM-0069]. Export writes
 * the faculty's portable document — to a file when `--out` is given, else to
 * stdout. Import loads such a document, upserts it through the faculty's
 * existing insert paths, and audits the mutation (`cli.memory.import` with
 * counts) — it changes durable state, so it is never silent (rule 7).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { appendEvent } from '@kernloop/kernel';
import { MemoryExportSchema, type MemoryExport } from '@kernloop/faculty-memory';
import type { Kernloop } from '../kernel.js';

/** Input to the `memory export` tool. */
export const MemoryExportInputSchema = z.strictObject({
  /** Absolute path to write the export to; omitted → returned for stdout. */
  out: z.string().min(1).optional(),
});
export type MemoryExportInput = z.input<typeof MemoryExportInputSchema>;

/** Input to the `memory import` tool. */
export const MemoryImportInputSchema = z.strictObject({
  /** Absolute path to the export document to import. */
  file: z.string().min(1),
});
export type MemoryImportInput = z.input<typeof MemoryImportInputSchema>;

/** What `memory export` returns. With `--out`, the document is written and a
 * summary returned; without it, the full document is returned for stdout. */
export type MemoryExportResult = MemoryExport | { written: string; facts: number; traces: number };

/** What `memory import` returns: the counts written, after auditing. */
export interface MemoryImportResult {
  imported: string;
  facts: number;
  traces: number;
}

/** Export the overlay's memory (CLM-0069). See module docs. */
export function memoryExportTool(
  kern: Kernloop,
  input: MemoryExportInput = {},
): MemoryExportResult {
  const parsed = MemoryExportInputSchema.parse(input);
  const doc = kern.memory.exportMemory();
  if (parsed.out === undefined) return doc;
  mkdirSync(path.dirname(parsed.out), { recursive: true });
  writeFileSync(parsed.out, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return { written: parsed.out, facts: doc.facts.length, traces: doc.traces.length };
}

/** Import a memory document and audit the mutation (CLM-0069). See module docs. */
export function memoryImportTool(kern: Kernloop, input: MemoryImportInput): MemoryImportResult {
  const parsed = MemoryImportInputSchema.parse(input);
  const raw: unknown = JSON.parse(readFileSync(parsed.file, 'utf8'));
  const doc = MemoryExportSchema.parse(raw);
  const counts = kern.memory.importMemory(doc);
  appendEvent(kern.store, {
    type: 'cli.memory.import',
    payload: { file: parsed.file, facts: counts.facts, traces: counts.traces },
  });
  return { imported: parsed.file, facts: counts.facts, traces: counts.traces };
}
