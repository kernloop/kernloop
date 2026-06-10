import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyChain } from '@kernloop/kernel';
import { createKernloop, P1_FACULTY_MANIFESTS } from './kernel.js';
import { readEnvelopes } from './tools/audit.js';

const dirs: string[] = [];
function freshKernloop() {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-kernel-'));
  dirs.push(repo);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createKernloop', () => {
  it('registers the three P1 faculty manifests in the registry', () => {
    const kern = freshKernloop();
    const names = kern.registry.list().map((m) => m.name);
    expect(names).toEqual([
      '@kernloop/faculty-memory',
      '@kernloop/faculty-compiler',
      '@kernloop/faculty-gates',
    ]);
    expect(P1_FACULTY_MANIFESTS).toHaveLength(3);
    kern.close();
  });

  it('seeds ladder tiers mechanically from manifest tiers, audited', () => {
    const kern = freshKernloop();
    const tierChanges = readEnvelopes(kern.paths.audit).filter(
      (e) => e.type === 'kernel.ladder.tier_change',
    );
    // memory enters at suggest, the quality gate at advisory; the compiler
    // declares observe — the ladder floor — so no transition is recorded.
    const seeded = tierChanges.map((e) => {
      const p = e.payload as { manifest: string; to: string; ratifiedBy: string | null };
      return [p.manifest, p.to, p.ratifiedBy];
    });
    expect(seeded).toEqual([
      ['@kernloop/faculty-memory', 'suggest', null],
      ['@kernloop/faculty-gates', 'advisory', null],
    ]);
    kern.close();
  });

  it('wires executors only for capabilities that are wiring-complete', () => {
    const kern = freshKernloop();
    expect([...kern.executors.keys()].sort()).toEqual([
      'brief.compile',
      'gate.quality',
      'memory.episodic.read',
      'memory.semantic.recall',
    ]);
    // write capabilities flow through their real entry points, not run
    expect(kern.executors.has('memory.semantic.write')).toBe(false);
    expect(kern.executors.has('memory.episodic.write')).toBe(false);
    kern.close();
  });

  it('produces a verifiable audit chain from assembly alone', () => {
    const kern = freshKernloop();
    const result = verifyChain(kern.store);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.length).toBeGreaterThan(0);
    kern.close();
  });
});
