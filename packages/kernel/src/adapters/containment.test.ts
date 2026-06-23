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
  carveOutMaskedGitTree,
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
    // as a boundary of the git-tree heuristic, not a general secret guard (#332).
    expect(isNonThrowawayGitTree(scratch(true))).toBe(false);
  });

  it('fails closed when the temp root is unresolvable (null tmpRoot ⇒ no carve-out)', () => {
    // A null tmpRoot (e.g. a $TMPDIR pointing nowhere) disables the carve-out, so
    // a real git tree is still refused rather than throwing an untyped ENOENT.
    expect(isNonThrowawayGitTree(scratch(true), null)).toBe(true);
  });
});

describe('carveOutMaskedGitTree (#332 observability)', () => {
  it('is TRUE when the tmp carve-out hid a real git tree (the KNOWN GAP, now observable)', () => {
    // The exact case isNonThrowawayGitTree silently ALLOWS: a .git under the temp root.
    expect(carveOutMaskedGitTree(scratch(true))).toBe(true);
  });
  it('is TRUE walking UP: a subdir under tmp whose .git is a parent (also under tmp)', () => {
    const repo = scratch(true);
    const sub = path.join(repo, 'pkg', 'src');
    mkdirSync(sub, { recursive: true });
    expect(carveOutMaskedGitTree(sub)).toBe(true);
  });
  it('is FALSE for an ordinary throwaway scratch dir with no .git (the common case — no noise)', () => {
    expect(carveOutMaskedGitTree(scratch(false))).toBe(false);
  });
  it('is FALSE when the path is NOT under the temp root (the refusal path owns that case)', () => {
    // A real git tree outside the carve-out is refused, not allowed — nothing to observe here.
    expect(carveOutMaskedGitTree(scratch(true), '/nonexistent-tmproot')).toBe(false);
  });
  it('is FALSE when no carve-out applies (null tmpRoot ⇒ nothing was masked)', () => {
    expect(carveOutMaskedGitTree(scratch(true), null)).toBe(false);
  });
  it('detects the $TMPDIR footgun: a .git ABOVE the injected tmpRoot (unbounded upward walk)', () => {
    // A launcher points $TMPDIR at a dir INSIDE a real working tree: the .git sits ABOVE
    // tmpRoot, so a bounded-at-tmpRoot walk would miss it. The unbounded walk surfaces it.
    const repo = scratch(true); // the real working tree (.git at its root)
    const fakeTmp = path.join(repo, 'fake-tmp');
    const ws = path.join(fakeTmp, 'ws');
    mkdirSync(ws, { recursive: true });
    expect(carveOutMaskedGitTree(ws, fakeTmp)).toBe(true);
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
