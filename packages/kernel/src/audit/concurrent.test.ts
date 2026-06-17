/**
 * Cross-process audit-append concurrency suite (CLM-0127, #244). The
 * regression: `appendEvent` once sourced `seq` from an in-memory counter
 * recovered once per process, so two OS processes on ONE overlay (the MCP
 * `serve` + a CLI verb, dogfood mode) each held a stale tip and assigned
 * COLLIDING seqs — a broken hash chain `verifyChain` rejected though nobody
 * tampered.
 *
 * The proof spawns N REAL OS child processes (execFile of a tiny node script —
 * not worker threads, not in-process async, which would share the same
 * in-memory tip and so could NOT reproduce #244). Each child appends K events
 * to the same JSONL. After they all exit, the chain must verify with a
 * gap-free, strictly-monotonic seq 1..N*K and every prevHash linking — proof
 * the better-sqlite3 BEGIN IMMEDIATE lock serialized the appenders.
 */

import { execFile } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildEnvelope, type AuditEnvelope } from './envelope.js';
import { appendEvent, createAuditStore } from './store.js';
import { verifyChain } from './verify.js';

const execFileAsync = promisify(execFile);

let dir: string;
let file: string;
let workerPath: string;

const here = dirname(fileURLToPath(import.meta.url));
/** The store module the child imports — the SOURCE under test, run via tsx. */
const storeModule = join(here, 'store.ts');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kernloop-audit-concurrent-'));
  file = join(dir, 'audit.jsonl');
  workerPath = join(dir, 'worker.mjs');
  // A standalone worker: import the real appendEvent and hammer one log.
  // Each event payload carries the worker id + local index so a dropped or
  // duplicated append would be visible, not just a seq collision.
  writeFileSync(
    workerPath,
    `import { createAuditStore, appendEvent } from ${JSON.stringify(storeModule)};
const [, , filePath, workerId, count] = process.argv;
const store = createAuditStore(filePath);
for (let i = 0; i < Number(count); i++) {
  appendEvent(store, { type: 'concurrent.event', payload: { worker: Number(workerId), i } });
}
`,
    'utf8',
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('concurrent cross-process appends (CLM-0127, #244)', () => {
  it('N real OS processes appending to one overlay produce a gap-free, strictly-monotonic, verifiable chain', async () => {
    const N = 6;
    const K = 25;
    // tsx runs the TypeScript source module directly, so the child exercises
    // the exact appendEvent under test (not a stale build artifact).
    const tsxBin = join(here, '..', '..', '..', '..', 'node_modules', '.bin', 'tsx');
    const children = Array.from({ length: N }, (_, w) =>
      execFileAsync(tsxBin, [workerPath, file, String(w), String(K)]),
    );
    const results = await Promise.all(children);
    // Every child must have exited 0 — a thrown append (e.g. SQLITE_BUSY past
    // the busy_timeout, or a rollback) would surface here, not be swallowed.
    for (const r of results) expect(r.stderr).toBe('');

    const store = createAuditStore(file);
    const result = verifyChain(store, { expectedLength: N * K });
    expect(result).toEqual({ ok: true, length: N * K });

    // Independently assert gap-free strict monotonicity 1..N*K and that the
    // payloads form exactly the N*K (worker, i) pairs — no drop, no dup.
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(N * K);
    const seqs = lines.map((l) => (JSON.parse(l) as AuditEnvelope).seq);
    expect(seqs).toEqual(Array.from({ length: N * K }, (_, i) => i + 1));

    const pairs = new Set(
      lines.map((l) => {
        const env = JSON.parse(l) as AuditEnvelope;
        const p = env.payload as { worker: number; i: number };
        return `${p.worker}:${p.i}`;
      }),
    );
    expect(pairs.size).toBe(N * K);
  });

  it('self-heals a crash orphan: a valid line written to the JSONL ahead of the sidecar is adopted, not duplicated', () => {
    // Simulate a crash mid-append: the JSONL got the line, the sidecar tip never
    // committed. The next append must see the size divergence, reconcile from the
    // JSONL (canonical), and continue from the orphan — no duplicate seq.
    const store = createAuditStore(file);
    const e1 = appendEvent(store, { type: 't', payload: { n: 1 } });
    const e2 = appendEvent(store, { type: 't', payload: { n: 2 } });
    // An ORPHAN: a valid seq-3 envelope appended straight to the JSONL, bypassing
    // the sidecar (the byteLen the sidecar recorded is now stale).
    const orphan = buildEnvelope({
      seq: e2.seq + 1,
      ts: new Date(0).toISOString(),
      type: 't',
      payload: { n: 3 },
      prevHash: e2.hash,
    });
    appendFileSync(file, JSON.stringify(orphan) + '\n', 'utf8');
    // The next append reconciles (size mismatch) and extends from the orphan.
    const e4 = appendEvent(store, { type: 't', payload: { n: 4 } });
    expect([e1.seq, e2.seq, orphan.seq, e4.seq]).toEqual([1, 2, 3, 4]); // gap-free, no dup
    expect(e4.prevHash).toBe(orphan.hash); // linked onto the adopted orphan
    expect(verifyChain(store, { expectedLength: 4 })).toEqual({ ok: true, length: 4 });
  });
});
