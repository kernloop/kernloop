/**
 * Checkpoint persistence — an INJECTED interface (p2 design notes, open
 * question 2): the composition root decides where checkpoints live; the
 * engine only knows this contract. Two real implementations ship here, both
 * wiring-complete: an in-memory store (tests, ephemeral runs) and an
 * append-only JSONL file store (a durable one the composition root can bind
 * today). Ported from v1's ICheckpointStore/InMemoryCheckpointStore
 * (nexus-agents orchestration/graph) — see PORT-NOTES.md for the deltas.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CheckpointRecordSchema, type CheckpointRecord } from './state.js';

/**
 * What the engine needs from storage [CLM-0044]. `save` MUST be durable
 * when it resolves — the engine treats a rejected save as a run failure
 * (a checkpoint that silently failed to persist would let `resume` lie).
 */
export interface CheckpointStore {
  /** Append one checkpoint. Records for a run arrive in increasing `seq`. */
  save(record: CheckpointRecord): Promise<void>;
  /** The highest-`seq` checkpoint for a run, or undefined if none. */
  latest(runId: string): Promise<CheckpointRecord | undefined>;
  /** All checkpoints for a run, in increasing `seq`. */
  list(runId: string): Promise<readonly CheckpointRecord[]>;
}

/** In-memory store: honest, bounded to the process lifetime. */
export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly byRun = new Map<string, CheckpointRecord[]>();

  save(record: CheckpointRecord): Promise<void> {
    const records = this.byRun.get(record.runId) ?? [];
    records.push(record);
    this.byRun.set(record.runId, records);
    return Promise.resolve();
  }

  latest(runId: string): Promise<CheckpointRecord | undefined> {
    const records = this.byRun.get(runId);
    return Promise.resolve(records?.[records.length - 1]);
  }

  list(runId: string): Promise<readonly CheckpointRecord[]> {
    return Promise.resolve(this.byRun.get(runId) ?? []);
  }
}

/**
 * Append-only JSONL file store: one checkpoint per line. Reads tolerate
 * corrupt lines (unparseable JSON or schema-invalid records) by skipping
 * them — a torn final line is exactly what a kill mid-write leaves behind,
 * and the last COMPLETE checkpoint is the resume point [CLM-0044]. Skipped
 * lines are counted on the instance so callers can surface the damage; they
 * are never silently repaired.
 */
export class JsonlCheckpointStore implements CheckpointStore {
  private readonly file: string;
  /** Corrupt lines encountered by reads since construction. */
  corruptLines = 0;

  constructor(file: string) {
    this.file = path.resolve(file);
  }

  async save(record: CheckpointRecord): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async latest(runId: string): Promise<CheckpointRecord | undefined> {
    const records = await this.list(runId);
    return records[records.length - 1];
  }

  async list(runId: string): Promise<readonly CheckpointRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const records: CheckpointRecord[] = [];
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      const record = this.parseLine(line);
      if (record === undefined) continue;
      if (record.runId === runId) records.push(record);
    }
    return records.sort((a, b) => a.seq - b.seq);
  }

  private parseLine(line: string): CheckpointRecord | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.corruptLines += 1;
      return undefined;
    }
    const result = CheckpointRecordSchema.safeParse(parsed);
    if (!result.success) {
      this.corruptLines += 1;
      return undefined;
    }
    return result.data;
  }
}
