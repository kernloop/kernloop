/**
 * Agentic-cwd containment on the loop path (#280 pt2, CLM-0145): a REAL adapter
 * run aimed at a non-throwaway git tree is refused AND audited (charter rule 7 —
 * a refusal is an action, not a silent throw). Hermetic: a `.git` fixture under
 * the OS temp dir is made non-throwaway by injecting a fake `tmpRoot`.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgenticRepositoryWorkspaceError } from '@kernloop/kernel';
import { createKernloop, type Kernloop } from '../kernel.js';
import { readEnvelopes } from '../tools/audit.js';
import { guardWorkspaceContainment } from './finalize.js';
import type { LoopRequest } from './index.js';

const FAKE_TMP = '/nonexistent-tmp-root-for-tests';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-finalize-'));
  dirs.push(dir);
  return dir;
}
function freshKern(): Kernloop {
  return createKernloop({ overlayDir: path.join(scratch(), '.kernloop') });
}

describe('guardWorkspaceContainment (#280 pt2, CLM-0145)', () => {
  it('refuses a real agentic run in a git tree and audits cli.adapter.refused (rule 7)', () => {
    const kern = freshKern();
    const repo = scratch();
    mkdirSync(path.join(repo, '.git')); // a (fake-tmp) non-throwaway git tree
    // invoke undefined ⇒ a REAL adapter run; the fake tmpRoot makes the fixture non-throwaway.
    const request = { workspaceDir: repo } as unknown as LoopRequest;
    expect(() => guardWorkspaceContainment(kern, 'claude', request, 'run-x', FAKE_TMP)).toThrow(
      AgenticRepositoryWorkspaceError,
    );
    const refused = readEnvelopes(kern.paths.audit).filter((e) => e.type === 'cli.adapter.refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]!.payload).toMatchObject({
      adapter: 'claude',
      reason: 'agentic-cwd-in-git-tree',
      runId: 'run-x',
    });
    kern.close();
  });

  it('does NOT guard an INJECTED (test) invoke — it gates only real adapter runs', () => {
    const kern = freshKern();
    const repo = scratch();
    mkdirSync(path.join(repo, '.git'));
    const request = {
      workspaceDir: repo,
      invoke: () => Promise.resolve({ output: '', cost: { tokens: 0, usd: 0 } }),
    } as unknown as LoopRequest;
    expect(() => guardWorkspaceContainment(kern, 'claude', request, 'r', FAKE_TMP)).not.toThrow();
    kern.close();
  });

  it('ALLOWS but AUDITS a git tree the tmp carve-out masked — cli.adapter.carveout-git-tree (#332, rule 7)', () => {
    const kern = freshKern();
    const repo = scratch(); // under the REAL tmp dir
    mkdirSync(path.join(repo, '.git')); // a real .git UNDER tmp — the location≠provenance gap
    const request = { workspaceDir: repo } as unknown as LoopRequest;
    // No injected tmpRoot ⇒ the default real-tmp carve-out ALLOWS (no throw), but the
    // allow-into-a-git-tree decision is now observable rather than silent.
    expect(() => guardWorkspaceContainment(kern, 'claude', request, 'run-cv')).not.toThrow();
    const masked = readEnvelopes(kern.paths.audit).filter(
      (e) => e.type === 'cli.adapter.carveout-git-tree',
    );
    expect(masked).toHaveLength(1);
    expect(masked[0]!.payload).toMatchObject({
      adapter: 'claude',
      reason: 'agentic-cwd-allowed-via-tmp-carveout-over-git-tree',
      runId: 'run-cv',
    });
    kern.close();
  });

  it('does NOT audit an ordinary throwaway scratch dir with no .git (no noise)', () => {
    const kern = freshKern();
    const repo = scratch(); // under real tmp, NO .git
    const request = { workspaceDir: repo } as unknown as LoopRequest;
    expect(() => guardWorkspaceContainment(kern, 'claude', request, 'run-clean')).not.toThrow();
    expect(
      readEnvelopes(kern.paths.audit).filter((e) => e.type === 'cli.adapter.carveout-git-tree'),
    ).toHaveLength(0);
    kern.close();
  });

  it('does NOT audit a NON-agentic adapter (ollama) on a masked workspace — no mislabel (#332 review)', () => {
    // ollama has no cwd and is never carved out; the audit must gate on agenticness exactly
    // as the refusal does, so a masked workspace under a non-agentic adapter mints no event.
    const kern = freshKern();
    const repo = scratch();
    mkdirSync(path.join(repo, '.git')); // a .git under tmp — would be "masked" for an agentic run
    const request = { workspaceDir: repo } as unknown as LoopRequest;
    expect(() => guardWorkspaceContainment(kern, 'ollama', request, 'run-ollama')).not.toThrow();
    expect(
      readEnvelopes(kern.paths.audit).filter((e) => e.type === 'cli.adapter.carveout-git-tree'),
    ).toHaveLength(0);
    kern.close();
  });
});
