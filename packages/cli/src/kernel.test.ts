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
import { REVIEW_CALIBRATION_FILE, reviewEvalSetHash } from './review-calibration.js';
import { readEnvelopes } from './tools/audit.js';

const dirs: string[] = [];
function freshKernloop() {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-kernel-'));
  dirs.push(repo);
  return createKernloop({ overlayDir: path.join(repo, '.kernloop'), rng: () => 0.99 });
}

/**
 * A kernloop assembled over an overlay.yaml written from `yaml` (#328 Inc2). An optional
 * `calibration` artifact is written into the overlay first (#350) so an enforce promotion has
 * verifiable evidence — without it, a declared `ratifiedEnforce` is REFUSED (stays advisory).
 */
function kernloopWithOverlay(yaml: string, calibration?: unknown) {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-kernel-'));
  dirs.push(repo);
  const overlayDir = path.join(repo, '.kernloop');
  mkdirSync(overlayDir, { recursive: true });
  writeFileSync(path.join(overlayDir, 'overlay.yaml'), yaml);
  if (calibration !== undefined) {
    writeFileSync(path.join(overlayDir, REVIEW_CALIBRATION_FILE), JSON.stringify(calibration));
  }
  return createKernloop({ overlayDir, rng: () => 0.99 });
}

/** A passing review-calibration artifact (precision ≥ 0.8, n ≥ 50, current eval-set hash). */
const passingCalibration = () => ({
  metric: 'precision',
  value: 0.9,
  n: 50,
  evalSetHash: reviewEvalSetHash(),
  adapter: 'claude',
  generatedAt: '2026-06-25T00:00:00.000Z',
  source: 'calibrate:claude',
});
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

  it('promotes the review gate to enforce when the ref is recorded AND the calibration evidence verifies (#350)', () => {
    const kern = kernloopWithOverlay(
      'id: x\ngates:\n  review:\n    ratifiedEnforce: "consensus_vote:2026-06-19"\n',
      passingCalibration(),
    );
    // The promotion is applied through the ratification-guarded ladder…
    expect(kern.ladder.tierOf(reviewGateManifest.name)).toBe('enforce');
    // …after the evidence is verified (the #350 marker), audited distinctly…
    const verified = readEnvelopes(kern.paths.audit).find(
      (e) => e.type === 'kernel.ladder.promotion-verified',
    );
    expect(verified?.payload).toMatchObject({ value: 0.9, n: 50, adapter: 'claude' });
    // …and the tier_change carries the ratification ref.
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

  it('REFUSES the promotion (stays advisory) when the ref is recorded but NO calibration evidence exists (#350)', () => {
    const kern = kernloopWithOverlay(
      'id: x\ngates:\n  review:\n    ratifiedEnforce: "consensus_vote:2026-06-19"\n',
    );
    // No artifact → enforce is never granted on an unverified attestation.
    expect(kern.ladder.tierOf(reviewGateManifest.name)).toBe('advisory');
    expect(reviewGateDrivesIteration(kern)).toBe(false);
    // The refusal is observable (rule 7), naming the reason.
    const refused = readEnvelopes(kern.paths.audit).find(
      (e) => e.type === 'kernel.ladder.promotion-refused',
    );
    expect(refused?.payload).toMatchObject({
      gate: reviewGateManifest.name,
      ratifiedBy: 'consensus_vote:2026-06-19',
    });
    expect((refused?.payload as { reason: string }).reason).toContain('no review-calibration.json');
    expect(verifyChain(kern.store).ok).toBe(true);
    kern.close();
  });

  it('REFUSES the promotion when the calibration is below the sample window (n=10 < 50) — the honest state today (#478)', () => {
    const kern = kernloopWithOverlay(
      'id: x\ngates:\n  review:\n    ratifiedEnforce: "consensus_vote:2026-06-19"\n',
      { ...passingCalibration(), n: 10 },
    );
    expect(kern.ladder.tierOf(reviewGateManifest.name)).toBe('advisory');
    const refused = readEnvelopes(kern.paths.audit).find(
      (e) => e.type === 'kernel.ladder.promotion-refused',
    );
    expect((refused?.payload as { reason: string }).reason).toContain('window');
    kern.close();
  });
});
