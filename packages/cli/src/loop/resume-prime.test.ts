/**
 * Unit tests for the resume-time priming seam (#543, CLM-0199):
 * `primeWrittenByChild` rebuilds the CLI's in-memory written-files stash from
 * a checkpoint's per-child `writtenPaths`, reading each path's content back
 * from the workspace (never checkpointed); `primeFromCheckpoint` wires it
 * alongside the pre-existing main-chain ref priming.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { RunState } from '@kernloop/workflows';
import { InMemoryCheckpointStore } from '@kernloop/workflows';
import { task } from './executors.testkit.js';
import type { LoopRefs } from './executors.js';
import { LoopResumeError } from './invoke.js';
import { primeFromCheckpoint, primeWrittenByChild } from './resume-prime.js';

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
