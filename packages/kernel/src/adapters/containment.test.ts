/**
 * Agentic-cwd containment (#280 part 2 / #138, CLM-0145). The boundary is
 * GIT-TREE containment: an agentic adapter is refused in a non-throwaway git
 * working tree. `tmpRoot` is injected so the refuse cases are hermetic — real
 * test fixtures live UNDER os.tmpdir() (the throwaway carve-out), so a fake
 * tmpRoot lets the .git-walk branch run on a fixture.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ADAPTER_NAMES } from './definitions.js';
import {
  AGENTIC_ADAPTERS,
  NON_AGENTIC_ADAPTERS,
  checkAgenticContainment,
  isNonThrowawayGitTree,
} from './containment.js';
import { AgenticRepositoryWorkspaceError } from './errors.js';

const FAKE_TMP = '/nonexistent-tmp-root-for-tests'; // so a fixture under real /tmp is NOT throwaway
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function scratch(withGit: boolean): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kernloop-containment-'));
  dirs.push(dir);
  if (withGit) mkdirSync(path.join(dir, '.git'));
  return dir;
}

describe('AGENTIC_ADAPTERS classification', () => {
  it('partitions every adapter into agentic OR non-agentic — no adapter is unclassified', () => {
    // A new cwd-using adapter added to ADAPTER_NAMES but not here fails LOUD.
    expect([...AGENTIC_ADAPTERS, ...NON_AGENTIC_ADAPTERS].sort()).toEqual(
      [...ADAPTER_NAMES].sort(),
    );
    for (const a of AGENTIC_ADAPTERS) expect(NON_AGENTIC_ADAPTERS.has(a)).toBe(false);
  });
});

describe('isNonThrowawayGitTree (#280 pt2)', () => {
  it('is TRUE for a git tree outside the temp root (.git at the path)', () => {
    expect(isNonThrowawayGitTree(scratch(true), FAKE_TMP)).toBe(true);
  });

  it('is TRUE for a git tree found by walking UP (a subdir of a repo)', () => {
    const repo = scratch(true);
    const sub = path.join(repo, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    expect(isNonThrowawayGitTree(sub, FAKE_TMP)).toBe(true);
  });

  it('is FALSE when no .git exists at or above', () => {
    expect(isNonThrowawayGitTree(scratch(false), FAKE_TMP)).toBe(false);
  });

  it('is FALSE under the temp root (the hermetic-scratch carve-out, default tmpRoot)', () => {
    // Same .git tree, but with the REAL tmp root it is throwaway → allowed.
    expect(isNonThrowawayGitTree(scratch(true))).toBe(false);
  });

  it('resolves symlinks: a symlink INTO a real git tree is still non-throwaway', () => {
    const repo = scratch(true);
    const link = path.join(scratch(false), 'link-to-repo');
    symlinkSync(repo, link);
    expect(isNonThrowawayGitTree(link, FAKE_TMP)).toBe(true);
  });

  it('KNOWN GAP (documented): a real repo cloned UNDER the temp root is currently ALLOWED', () => {
    // location ≠ provenance — a .git under tmpdir is treated as throwaway. Tracked
    // as a boundary of the git-tree heuristic, not a general secret guard.
    expect(isNonThrowawayGitTree(scratch(true))).toBe(false);
  });
});

describe('checkAgenticContainment (#280 pt2, CLM-0145)', () => {
  it('REFUSES every agentic adapter in a non-throwaway git tree', () => {
    const repo = scratch(true);
    for (const adapter of AGENTIC_ADAPTERS) {
      expect(() => checkAgenticContainment(adapter, repo, FAKE_TMP)).toThrow(
        AgenticRepositoryWorkspaceError,
      );
    }
  });

  it('the refusal error names the adapter and the realpath workspace', () => {
    const repo = scratch(true);
    try {
      checkAgenticContainment('claude', repo, FAKE_TMP);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(AgenticRepositoryWorkspaceError);
      expect((error as AgenticRepositoryWorkspaceError).adapter).toBe('claude');
      expect((error as AgenticRepositoryWorkspaceError).workspace).toContain(path.basename(repo));
    }
  });

  it('ALLOWS a non-agentic adapter (ollama) in the same real git tree', () => {
    const repo = scratch(true);
    expect(() => checkAgenticContainment('ollama', repo, FAKE_TMP)).not.toThrow();
  });

  it('is a no-op when cwd is undefined, and in a throwaway (tmpdir) workspace', () => {
    expect(() => checkAgenticContainment('claude', undefined, FAKE_TMP)).not.toThrow();
    expect(() => checkAgenticContainment('claude', scratch(true))).not.toThrow(); // default tmpRoot
  });
});
