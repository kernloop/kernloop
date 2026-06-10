/**
 * Unit tests for the memory-facing tools: `recall` (provenance-tagged
 * reads), `remember` (provenance mandatory), and `status` (cross-session
 * task state from SQLite).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProvenanceRequiredError } from '@kernloop/faculty-memory';
import { createKernloop, type Kernloop } from '../kernel.js';
import { recallTool } from './recall.js';
import { rememberTool } from './remember.js';
import { statusTool } from './status.js';
import { runTool } from './run.js';

const dirs: string[] = [];
function repoDir(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-memory-'));
  dirs.push(repo);
  return repo;
}
function freshKernloop(repo = repoDir()): Kernloop {
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('remember + recall', () => {
  it('stores a fact with provenance and recalls it provenance-tagged', () => {
    const kern = freshKernloop();
    const ack = rememberTool(kern, {
      fact: 'the router explores with epsilon 0.1',
      provenance: 'spec §3.2',
      confidence: 0.9,
    });
    expect(ack.stored.provenance).toBe('spec §3.2');
    const result = recallTool(kern, { query: 'router epsilon' });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]?.provenance).toBe('spec §3.2');
    expect(result.facts[0]?.score).toBeGreaterThan(0);
    kern.close();
  });

  it('surfaces the faculty provenance requirement as a typed error', () => {
    const kern = freshKernloop();
    // the tool schema rejects empty provenance before the faculty does
    expect(() => rememberTool(kern, { fact: 'orphan fact', provenance: '' })).toThrow();
    // whitespace-only provenance passes the schema and hits the faculty rule
    expect(() => rememberTool(kern, { fact: 'orphan fact', provenance: '  ' })).toThrow(
      ProvenanceRequiredError,
    );
    kern.close();
  });

  it('respects the recall limit', () => {
    const kern = freshKernloop();
    rememberTool(kern, { fact: 'gate quality alpha', provenance: 'a' });
    rememberTool(kern, { fact: 'gate quality beta', provenance: 'b' });
    const result = recallTool(kern, { query: 'gate quality', limit: 1 });
    expect(result.facts).toHaveLength(1);
    kern.close();
  });
});

describe('status', () => {
  it('reports not-found for tasks memory has never seen', () => {
    const kern = freshKernloop();
    expect(statusTool(kern, { taskId: 'task-never-ran' })).toEqual({
      found: false,
      taskId: 'task-never-ran',
    });
    kern.close();
  });

  it('answers from SQLite across sessions: a second kernloop over the same overlay sees the trace', async () => {
    const repo = repoDir();
    const first = freshKernloop(repo);
    await runTool(first, {
      goal: 'leave a trace behind',
      capability: 'memory.episodic.read',
      id: 'task-cross-session',
    });
    first.close();
    const second = freshKernloop(repo);
    const status = statusTool(second, { taskId: 'task-cross-session' });
    expect(status.found).toBe(true);
    if (status.found) expect(status.trace.status).toBe('success');
    second.close();
  });
});
