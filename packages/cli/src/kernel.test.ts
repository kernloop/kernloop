import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultAuditKeyringPath, verifyChain } from '@kernloop/kernel';
import { reviewGateManifest } from '@kernloop/faculty-gates';
import {
  createKernloop,
  createProductionKernloop,
  P1_FACULTY_MANIFESTS,
  P2_MANIFESTS,
  P3_MANIFESTS,
  SCRUM_MANIFESTS,
} from './kernel.js';
import { reviewGateDrivesIteration } from './loop/engine-build.js';
import { readEnvelopes } from './tools/audit.js';

const dirs: string[] = [];
function freshKernloop() {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-kernel-'));
  dirs.push(repo);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}

/** A kernloop assembled over an overlay.yaml written from `yaml` (#328 Inc2). */
function kernloopWithOverlay(yaml: string) {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-kernel-'));
  dirs.push(repo);
  const overlayDir = path.join(repo, '.kernloop');
  mkdirSync(overlayDir, { recursive: true });
  writeFileSync(path.join(overlayDir, 'overlay.yaml'), yaml);
  return createKernloop({ overlayDir, rng: () => 0.99 });
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createKernloop', () => {
  it('registers the P1 faculties, the P2 vote gate and workflows, and the P3 review gate, observer, and toolsmith', () => {
    const kern = freshKernloop();
    const names = kern.registry.list().map((m) => m.name);
    expect(names).toEqual([
      '@kernloop/faculty-memory',
      '@kernloop/faculty-compiler',
      '@kernloop/faculty-gates',
      '@kernloop/faculty-gates/vote',
      '@kernloop/workflows',
      '@kernloop/faculty-gates/review',
      '@kernloop/faculty-observer',
      '@kernloop/faculty-toolsmith',
      '@kernloop/faculty-scrum',
    ]);
    expect(P1_FACULTY_MANIFESTS).toHaveLength(3);
    expect(P2_MANIFESTS).toHaveLength(2);
    expect(P3_MANIFESTS).toHaveLength(3);
    expect(SCRUM_MANIFESTS).toHaveLength(1);
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
      ['@kernloop/faculty-gates/vote', 'advisory', null],
      ['@kernloop/workflows', 'suggest', null],
      ['@kernloop/faculty-gates/review', 'advisory', null],
      ['@kernloop/faculty-observer', 'suggest', null],
      ['@kernloop/faculty-toolsmith', 'suggest', null],
      ['@kernloop/faculty-scrum', 'suggest', null],
    ]);
    kern.close();
  });

  it('opens the observer over the same overlay database file as memory, coexisting', () => {
    const kern = freshKernloop();
    // both faculties operate on <overlay>/memory.sqlite — write through each
    kern.memory.rememberFact({ fact: 'one db per overlay', provenance: 'spec §3.3' });
    const record = kern.observer.ingestOutcome(
      {
        taskId: 'task-coexist',
        status: 'success',
        signals: [],
        cost: { tokens: 1, usd: 0 },
        traceRef: 'audit:#task=task-coexist',
        distillCandidates: [],
      },
      { subject: 'subject-coexist' },
    );
    expect(record.invocations).toBe(1);
    expect(kern.memory.recallFacts('one db per overlay')).toHaveLength(1);
    expect(kern.observer.fitnessLedger().map((r) => r.subject)).toEqual(['subject-coexist']);
    kern.close();
  });

  it('wires executors only for capabilities that are wiring-complete', () => {
    const kern = freshKernloop();
    expect([...kern.executors.keys()].sort()).toEqual([
      'brief.compile',
      'gate.quality',
      'memory.episodic.read',
      'memory.semantic.recall',
      'workflow.canonical',
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

  it('threads an injected clock into every audit envelope', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-kernel-'));
    dirs.push(repo);
    const frozen = new Date('2026-01-02T03:04:05.000Z');
    const kern = createKernloop({ overlayDir: path.join(repo, '.kernloop'), clock: () => frozen });
    const envelopes = readEnvelopes(kern.paths.audit);
    expect(envelopes.length).toBeGreaterThan(0);
    expect(envelopes.every((e) => e.ts === frozen.toISOString())).toBe(true);
    kern.close();
  });
});

describe('createProductionKernloop (#280 [CLM-0146])', () => {
  it('keys the audit chain end-to-end: registration events carry keyEpoch and verify under the keyring', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-prodkern-'));
    dirs.push(repo);
    const kern = createProductionKernloop({
      overlayDir: path.join(repo, '.kernloop'),
      rng: () => 0.99,
      keyringPath: path.join(repo, 'audit.key'), // explicit temp keyring (hermetic)
    });
    // Faculty registration already appended audit events through the real root.
    const envelopes = readEnvelopes(kern.paths.audit);
    expect(envelopes.length).toBeGreaterThan(0);
    expect(envelopes.every((e) => e.keyEpoch === 1)).toBe(true);
    // The keyed chain verifies only WITH the keyring (proves it is HMAC-keyed).
    expect(verifyChain(kern.store).ok).toBe(true);
    kern.close();
  });

  it('defaults the keyring off the overlay so an overlay-JSONL attacker cannot reach it', () => {
    expect(defaultAuditKeyringPath({ XDG_CONFIG_HOME: '/tmp/cfg' })).toBe(
      '/tmp/cfg/kernloop/audit.key',
    );
  });
});

describe('ratified gate promotion (#328 Inc2, CLM-0153/CLM-0064)', () => {
  it('leaves the review gate advisory when no ratification ref is recorded (fresh overlay)', () => {
    const kern = freshKernloop();
    expect(kern.ladder.tierOf(reviewGateManifest.name)).toBe('advisory');
    expect(reviewGateDrivesIteration(kern)).toBe(false); // honesty guard holds by default
    kern.close();
  });

  it('promotes the review gate to enforce when the overlay records a ratification ref, driving iteration', () => {
    const kern = kernloopWithOverlay(
      'id: x\ngates:\n  review:\n    ratifiedEnforce: "consensus_vote:2026-06-19"\n',
    );
    // The promotion is applied through the ratification-guarded ladder…
    expect(kern.ladder.tierOf(reviewGateManifest.name)).toBe('enforce');
    // …and audited as a tier_change carrying the ratification ref.
    const promotion = readEnvelopes(kern.paths.audit).find(
      (e) =>
        e.type === 'kernel.ladder.tier_change' && (e.payload as { to?: string }).to === 'enforce',
    );
    expect(promotion?.payload).toMatchObject({
      to: 'enforce',
      ratifiedBy: 'consensus_vote:2026-06-19',
      direction: 'promotion',
    });
    // …so the Inc1 wiring now drives child re-iteration.
    expect(reviewGateDrivesIteration(kern)).toBe(true);
    expect(verifyChain(kern.store).ok).toBe(true);
    kern.close();
  });
});
