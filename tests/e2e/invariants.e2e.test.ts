/**
 * Scenario E — the invariants capstone (the honesty proof). Drives the REAL
 * `kernloop` binary to demonstrate the hard guarantees the repo exists to keep:
 * the system NEVER auto-mutates at the suggest tier (it scores/suggests/
 * assembles but never acts), the audit chain detects tampering, a dry-run
 * spawns nothing, and only the enforce tier honors `--execute`. The one external
 * boundary (`gh`) is a hermetic stub on PATH; the poison stub PROVES nothing
 * spawned it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './harness/run-cli.js';
import {
  auditText,
  cleanupOverlays,
  freshOverlay,
  withTracker,
  writeAuditText,
  writeSpec,
} from './harness/overlay.js';
import { ghStubEnv, installGhStub } from './harness/gh-stub.js';
import { PROGRAM_GOAL, TWO_NODE_SPEC } from './harness/specs.js';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

afterEach(cleanupOverlays);

const ID = 'prog';

describe('Scenario E — no auto-mutation at the suggest tier', () => {
  it('the full program flow at suggest spawns ZERO gh and files nothing', () => {
    const repo = freshOverlay();
    withTracker(repo, 'suggest');
    const spec = writeSpec(repo, TWO_NODE_SPEC);
    const stub = installGhStub({ mode: 'poison' });
    const env = ghStubEnv(stub);

    // create (no gh), emit without --execute (dry-run), emit WITH --execute at
    // the suggest tier (must refuse, stay dry-run). None may spawn gh.
    runCli(['program', 'create', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID], {
      cwd: repo,
    });

    const dryRun = runCli(['program', 'emit', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID], {
      cwd: repo,
      env,
    });
    expect(dryRun.code).toBe(0);
    expect((dryRun.json() as { mode: string }).mode).toBe('dry-run');

    const refused = runCli(
      ['program', 'emit', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID, '--execute'],
      { cwd: repo, env },
    );
    expect(refused.code).toBe(0);
    const report = refused.json() as { mode: string; refusedExecute: boolean; notice: string };
    expect(report.mode).toBe('dry-run');
    expect(report.refusedExecute).toBe(true);
    expect(report.notice).toContain('refused');

    // The system scored/suggested/assembled but never auto-acted.
    expect(stub.poisoned()).toBe(false);
    expect(stub.calls()).toHaveLength(0);
  });
});

describe('Scenario E — audit-chain integrity', () => {
  it('verify succeeds on an honest chain, then FAILS after a one-char tamper', () => {
    const repo = freshOverlay();
    const spec = writeSpec(repo, TWO_NODE_SPEC);
    runCli(['program', 'create', '--goal', PROGRAM_GOAL, '--spec', spec, '--id', ID], {
      cwd: repo,
    });
    runCli(
      [
        'program',
        'advance',
        '--program',
        ID,
        '--node',
        'prog.1',
        '--state',
        'emitted',
        '--ref',
        'https://github.com/kernloop-e2e/sandbox/issues/1',
      ],
      { cwd: repo },
    );

    const before = runCli(['audit', '--op', 'verify'], { cwd: repo });
    expect(before.code).toBe(0);
    expect((before.json() as { result: { ok: boolean } }).result.ok).toBe(true);

    // Tamper: flip a single hex character of the LAST line's stored `hash`. The
    // recomputed content hash no longer matches the stored one, so verify must
    // report `hash_mismatch` at that seq. Tampering the last line keeps the flip
    // out of any later line's prevHash, so the reason is deterministic.
    const lines = auditText(repo)
      .split('\n')
      .filter((l) => l.trim() !== '');
    const target = lines.length - 1;
    const line = lines[target]!;
    const marker = '"hash":"';
    const flipAt = line.lastIndexOf(marker) + marker.length;
    const ch = line[flipAt]!;
    lines[target] = line.slice(0, flipAt) + (ch === '0' ? '1' : '0') + line.slice(flipAt + 1);
    writeAuditText(repo, lines.join('\n') + '\n');

    // Fails closed (#93): a broken chain is reported in `result.ok` AND the
    // command exits NONZERO, so `audit --op verify && …` can't treat tampering
    // as success.
    const after = runCli(['audit', '--op', 'verify'], { cwd: repo });
    expect(after.code).toBe(1);
    const result = (after.json() as { result: { ok: boolean; reason?: string } }).result;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('hash_mismatch');
  });
});

describe('Scenario E — dry-run and the tier-gate spawn nothing', () => {
  it('tracker create with no --execute is a DRY RUN and spawns zero gh', () => {
    const repo = freshOverlay();
    withTracker(repo, 'suggest');
    const bodyFile = path.join(repo, 'body.md');
    writeFileSync(bodyFile, 'the issue body', 'utf8');
    const stub = installGhStub({ mode: 'poison' });
    const res = runCli(['tracker', 'create', '--title', 'Hello', '--body-file', bodyFile], {
      cwd: repo,
      env: ghStubEnv(stub),
    });
    expect(res.code).toBe(0);
    const report = res.json() as { notice: string; proposal: { argv: string[] } };
    expect(report.notice).toContain('DRY RUN');
    expect(report.proposal.argv).toContain('--title=Hello');
    expect(stub.poisoned()).toBe(false);
  });

  it('tracker create --execute at the suggest tier is REFUSED and spawns zero gh', () => {
    const repo = freshOverlay();
    withTracker(repo, 'suggest');
    const bodyFile = path.join(repo, 'body.md');
    writeFileSync(bodyFile, 'body', 'utf8');
    const stub = installGhStub({ mode: 'poison' });
    const res = runCli(
      ['tracker', 'create', '--title', 'T', '--body-file', bodyFile, '--execute'],
      { cwd: repo, env: ghStubEnv(stub) },
    );
    expect(res.code).toBe(0);
    const report = res.json() as { mode: string; refusedExecute: boolean; notice: string };
    expect(report.mode).toBe('dry-run');
    expect(report.refusedExecute).toBe(true);
    expect(report.notice).toContain('refused');
    // Only the enforce tier mutates — suggest stays a proposal, no spawn.
    expect(stub.poisoned()).toBe(false);
  });

  it('tracker create --execute at the enforce tier DOES spawn the allowlisted gh', () => {
    const repo = freshOverlay();
    withTracker(repo, 'enforce');
    const bodyFile = path.join(repo, 'body.md');
    writeFileSync(bodyFile, 'body', 'utf8');
    const stub = installGhStub({ mode: 'record' });
    const res = runCli(
      ['tracker', 'create', '--title', 'T', '--body-file', bodyFile, '--execute'],
      { cwd: repo, env: ghStubEnv(stub) },
    );
    expect(res.code).toBe(0);
    expect((res.json() as { mode: string }).mode).toBe('execute');
    const calls = stub.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(0, 2)).toEqual(['issue', 'create']);
    // The audit recorded the op without the body verbatim.
    expect(auditText(repo)).toContain('cli.tracker.create');
  });
});
