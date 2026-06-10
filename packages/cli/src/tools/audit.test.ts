/**
 * Unit tests for the `audit` tool [CLM-0035]: chain verification on demand
 * and event queries by sequence range and type.
 */
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent } from '@kernloop/kernel';
import { createKernloop, type Kernloop } from '../kernel.js';
import { auditTool } from './audit.js';

const dirs: string[] = [];
function freshKernloop(): Kernloop {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-audit-'));
  dirs.push(repo);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop') });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('auditTool', () => {
  it('verifies the chain on demand', () => {
    const kern = freshKernloop();
    const result = auditTool(kern, { op: 'verify' });
    expect(result.op).toBe('verify');
    if (result.op !== 'verify') throw new Error('expected verify');
    expect(result.result.ok).toBe(true);
    kern.close();
  });

  it('detects tampering when the log is modified', () => {
    const kern = freshKernloop();
    appendFileSync(kern.paths.audit, '{"not":"an envelope"}\n');
    const result = auditTool(kern, { op: 'verify' });
    if (result.op !== 'verify') throw new Error('expected verify');
    expect(result.result.ok).toBe(false);
    kern.close();
  });

  it('queries events filtered by type', () => {
    const kern = freshKernloop();
    appendEvent(kern.store, { type: 'cli.test.marker', payload: { n: 1 } });
    appendEvent(kern.store, { type: 'cli.test.marker', payload: { n: 2 } });
    const result = auditTool(kern, { op: 'query', type: 'cli.test.marker' });
    if (result.op !== 'query') throw new Error('expected query');
    expect(result.events).toHaveLength(2);
    expect(result.events.every((e) => e.type === 'cli.test.marker')).toBe(true);
    expect(result.total).toBeGreaterThan(2); // assembly events exist too
    kern.close();
  });

  it('queries events filtered by sequence range', () => {
    const kern = freshKernloop();
    const result = auditTool(kern, { op: 'query', fromSeq: 2, toSeq: 3 });
    if (result.op !== 'query') throw new Error('expected query');
    expect(result.events.map((e) => e.seq)).toEqual([2, 3]);
    kern.close();
  });

  it('returns an empty query result for an overlay with no audit log yet', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-audit-empty-'));
    dirs.push(repo);
    // build paths without assembling (assembly itself writes audit events)
    const kern = createKernloop({ overlayDir: path.join(repo, '.kernloop') });
    rmSync(kern.paths.audit);
    const result = auditTool(kern, { op: 'query' });
    if (result.op !== 'query') throw new Error('expected query');
    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
    kern.close();
  });
});
