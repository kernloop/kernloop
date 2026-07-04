/**
 * Unit tests for the resume-time priming seam (#543, CLM-0199):
 * `primeWrittenByChild` rebuilds the CLI's in-memory written-files stash from
 * a checkpoint's per-child `writtenPaths`, reading each path's content back
 * from the workspace (never checkpointed); `primeFromCheckpoint` wires it
 * alongside the pre-existing main-chain ref priming.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { RunState } from '@kernloop/workflows';
import { InMemoryCheckpointStore } from '@kernloop/workflows';
import { task } from './executors.testkit.js';
import type { LoopRefs } from './executors.js';
import { LoopResumeError } from './invoke.js';
import {
  primeFromCheckpoint,
  primeWrittenByChild,
  type RefusedResumePath,
} from './resume-prime.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-resume-prime-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A minimal, schema-valid RunState carrying one child result. */
function stateWith(writtenPaths: readonly string[] | undefined): RunState {
  return {
    task,
    status: 'running',
    cursor: { phase: 'fanout', childIndex: 0, sub: 1 },
    iteration: 0,
    values: {},
    findings: [],
    children: [task],
    childResults: [
      {
        child: task,
        iteration: 0,
        findings: [],
        ...(writtenPaths === undefined ? {} : { writtenPaths }),
      },
    ],
    trace: [],
    observedMaxNodeSpend: { tokens: 0, usd: 0 },
  };
}

describe('primeWrittenByChild (#543, CLM-0199)', () => {
  it('rebuilds the stash from checkpointed paths, reading content back from the workspace', () => {
    const ws = path.join(scratch, 'ws-content');
    mkdirSync(path.join(ws, 'src'), { recursive: true });
    writeFileSync(path.join(ws, 'src', 'a.ts'), '/** A. */\nexport const a = 1;\n');
    const refs: LoopRefs = {};
    primeWrittenByChild(refs, stateWith([path.join('src', 'a.ts')]), ws);
    expect(refs.writtenByChild?.[task.id]).toEqual([
      { path: path.join('src', 'a.ts'), content: '/** A. */\nexport const a = 1;\n' },
    ]);
  });

  it('degrades an unreadable checkpointed path to empty content rather than aborting the resume', () => {
    const ws = path.join(scratch, 'ws-missing');
    mkdirSync(ws, { recursive: true });
    const refs: LoopRefs = {};
    primeWrittenByChild(refs, stateWith(['gone.ts']), ws);
    expect(refs.writtenByChild?.[task.id]).toEqual([{ path: 'gone.ts', content: '' }]);
  });

  it('leaves a child with NO checkpointed writtenPaths untouched (the pre-#543 degradation still applies)', () => {
    const ws = path.join(scratch, 'ws-absent');
    mkdirSync(ws, { recursive: true });
    const refs: LoopRefs = {};
    primeWrittenByChild(refs, stateWith(undefined), ws);
    expect(refs.writtenByChild).toBeUndefined();
  });

  it('an empty checkpointed writtenPaths set (the child wrote nothing) rebuilds to an empty stash entry', () => {
    const ws = path.join(scratch, 'ws-empty');
    mkdirSync(ws, { recursive: true });
    const refs: LoopRefs = {};
    primeWrittenByChild(refs, stateWith([]), ws);
    expect(refs.writtenByChild?.[task.id]).toEqual([]);
  });

  it('REFUSES a checkpointed writtenPath that escapes the workspace via `..`, still priming the in-workspace ones (#543 security round)', () => {
    // A tampered/corrupt checkpoint carries a `../`-bearing path pointing at a
    // file OUTSIDE the workspace; its content must never enter the gate-visible
    // stash, and the refusal is recorded (not silently dropped).
    const ws = path.join(scratch, 'ws-escape');
    mkdirSync(path.join(ws, 'src'), { recursive: true });
    writeFileSync(path.join(ws, 'src', 'ok.ts'), '/** Ok. */\nexport const ok = 1;\n');
    // The out-of-workspace secret the `..` path would read.
    writeFileSync(path.join(scratch, 'outside.ts'), 'const apiKey = "sk-live-XXXX";\n');
    const refs: LoopRefs = {};
    const refused: RefusedResumePath[] = [];
    primeWrittenByChild(
      refs,
      stateWith([path.join('..', 'outside.ts'), path.join('src', 'ok.ts')]),
      ws,
      (r) => refused.push(r),
    );
    // Only the in-workspace path primed; the escaping one never entered the stash.
    expect(refs.writtenByChild?.[task.id]).toEqual([
      { path: path.join('src', 'ok.ts'), content: '/** Ok. */\nexport const ok = 1;\n' },
    ]);
    expect(refused).toEqual([{ childId: task.id, path: path.join('..', 'outside.ts') }]);
  });

  it('REFUSES a checkpointed path that is a SYMLINK out of the workspace (realpath re-confinement)', () => {
    const ws = path.join(scratch, 'ws-symlink');
    mkdirSync(ws, { recursive: true });
    const secret = path.join(scratch, 'symlink-secret.ts');
    writeFileSync(secret, 'const token = "leak";\n');
    symlinkSync(secret, path.join(ws, 'link.ts')); // an in-name path that resolves OUTSIDE
    const refs: LoopRefs = {};
    const refused: RefusedResumePath[] = [];
    primeWrittenByChild(refs, stateWith(['link.ts']), ws, (r) => refused.push(r));
    // Every path refused ⇒ the child is LEFT UNSET (fail-closed taint), not scoped to nothing.
    expect(refs.writtenByChild).toBeUndefined();
    expect(refused).toEqual([{ childId: task.id, path: 'link.ts' }]);
  });

  it('leaves a child whose EVERY path was refused UNSET so the fail-closed whole-workspace taint applies', () => {
    const ws = path.join(scratch, 'ws-poisoned');
    mkdirSync(ws, { recursive: true });
    const refs: LoopRefs = {};
    const refused: RefusedResumePath[] = [];
    primeWrittenByChild(
      refs,
      stateWith([path.join('..', 'a.ts'), path.join('..', '..', 'b.ts')]),
      ws,
      (r) => refused.push(r),
    );
    expect(refs.writtenByChild).toBeUndefined();
    expect(refused).toHaveLength(2);
  });

  it('a genuine (non-ENOENT) read error on an EXISTING path SURFACES rather than yielding empty content', () => {
    // readFileSync on a DIRECTORY throws EISDIR (not ENOENT): the narrowed catch
    // must let it surface, never vacuously pass the content scans with '' (#543
    // review finding 3 — the security-smell fail-open).
    const ws = path.join(scratch, 'ws-eisdir');
    mkdirSync(path.join(ws, 'adir'), { recursive: true });
    expect(() => primeWrittenByChild({}, stateWith(['adir']), ws)).toThrow();
  });

  it('an ABSENT workspace dir still confines lexically — a `..` path is refused, an in-workspace path yields empty content', () => {
    // realpathSync on a non-existent workspace throws; the fallback resolves the
    // path so lexical `..` confinement still applies (the anomaly is honestly
    // degraded, never fail-open into reading outside a missing root).
    const ws = path.join(scratch, 'ws-does-not-exist');
    const refs: LoopRefs = {};
    const refused: RefusedResumePath[] = [];
    primeWrittenByChild(
      refs,
      stateWith([path.join('..', 'escape.ts'), path.join('src', 'in.ts')]),
      ws,
      (r) => refused.push(r),
    );
    expect(refs.writtenByChild?.[task.id]).toEqual([
      { path: path.join('src', 'in.ts'), content: '' },
    ]);
    expect(refused).toEqual([{ childId: task.id, path: path.join('..', 'escape.ts') }]);
  });
});

describe('primeFromCheckpoint', () => {
  it('throws LoopResumeError when the run has no checkpoint', async () => {
    const checkpoints = new InMemoryCheckpointStore();
    await expect(
      primeFromCheckpoint(checkpoints, 'run-ghost', {}, scratch, '/x/run-ghost.jsonl'),
    ).rejects.toThrow(LoopResumeError);
  });

  it('primes BOTH the main-chain refs and the written-files stash from the latest checkpoint', async () => {
    const ws = path.join(scratch, 'ws-full');
    mkdirSync(path.join(ws, 'src'), { recursive: true });
    writeFileSync(path.join(ws, 'src', 'b.ts'), '/** B. */\nexport const b = 2;\n');
    const checkpoints = new InMemoryCheckpointStore();
    await checkpoints.save({
      runId: 'run-full',
      seq: 1,
      node: 'quality',
      iteration: 0,
      createdAt: new Date().toISOString(),
      state: stateWith([path.join('src', 'b.ts')]),
    });
    const refs: LoopRefs = {};
    await primeFromCheckpoint(checkpoints, 'run-full', refs, ws, '/unused.jsonl');
    expect(refs.writtenByChild?.[task.id]).toEqual([
      { path: path.join('src', 'b.ts'), content: '/** B. */\nexport const b = 2;\n' },
    ]);
  });
});
