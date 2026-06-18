/**
 * Agentic-cwd containment (#280 part 2 / #138, CLM-0145) — refuse an AGENTIC
 * adapter (a CLI that executes generated code and reads/writes its cwd) when its
 * workspace is a NON-throwaway git working tree. Generated code in your real repo
 * could poison `.git/hooks` (runs on every git op), rewrite `.git/config`, or read
 * tracked secrets. A pure-API adapter (ollama, no cwd) is not a threat.
 *
 * The boundary is GIT-TREE containment, NOT general secret protection: a non-git
 * directory holding a `.env` is NOT covered here (that is a separate, larger
 * scope). Hard refuse, no opt-out flag (a security boundary, not a tuning knob);
 * the audited overlay opt-out is deferred (#320). Pure path logic — the kernel
 * stays model-free.
 *
 * @module kernel/adapters/containment
 */
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type AdapterName } from './definitions.js';
import { AgenticRepositoryWorkspaceError } from './errors.js';

/**
 * Adapters that EXECUTE generated code and read/write their cwd. The complement
 * is the pure-API, no-cwd set ({@link NON_AGENTIC_ADAPTERS}); a registry-match
 * test asserts every {@link AdapterName} is classified into exactly one, so a new
 * cwd-using adapter cannot silently bypass containment.
 */
export const AGENTIC_ADAPTERS: ReadonlySet<AdapterName> = new Set([
  'claude',
  'codex',
  'gemini',
  'opencode',
]);

/** Adapters that take no cwd (read stdin, return text) — not a filesystem threat. */
export const NON_AGENTIC_ADAPTERS: ReadonlySet<AdapterName> = new Set(['ollama']);

/**
 * Whether `dir`'s realpath is a NON-throwaway git working tree. THROWAWAY (false)
 * when it resolves under the realpath'd temp dir (the hermetic-test / scratch
 * pattern) OR when no `.git` exists at or above it. NON-throwaway (true) when a
 * `.git` exists at/above it outside the temp dir. Symlink-resistant (realpath),
 * mirroring the writeWorkspaceFiles escape guard. KNOWN GAP: a real repo cloned
 * UNDER the temp dir is treated as throwaway (location ≠ provenance). `tmpRoot`
 * is injectable for tests; it defaults to the realpath'd OS temp dir (macOS
 * /tmp → /private/tmp), so the prefix compare is symlink-correct.
 */
export function isNonThrowawayGitTree(
  dir: string,
  tmpRoot: string = realpathSync(tmpdir()),
): boolean {
  let real: string;
  try {
    real = realpathSync(path.resolve(dir));
  } catch {
    return false; // a path we cannot resolve is not a tree we can corrupt
  }
  if (real === tmpRoot || real.startsWith(tmpRoot + path.sep)) return false; // throwaway scratch
  for (let cur = real; ; ) {
    if (existsSync(path.join(cur, '.git'))) return true; // a real working tree
    const parent = path.dirname(cur);
    if (parent === cur) return false; // hit the filesystem root, no .git
    cur = parent;
  }
}

/**
 * Refuse an agentic adapter whose cwd is a non-throwaway git tree (#280 pt2,
 * CLM-0145) — throws {@link AgenticRepositoryWorkspaceError} BEFORE the CLI
 * launches. A no-op for a non-agentic adapter or an absent cwd. The single choke
 * point ({@link invokeAdapter}) calls this so no caller can bypass it.
 */
export function checkAgenticContainment(
  adapter: AdapterName,
  cwd: string | undefined,
  tmpRoot?: string,
): void {
  if (cwd === undefined || !AGENTIC_ADAPTERS.has(adapter)) return;
  if (isNonThrowawayGitTree(cwd, tmpRoot)) {
    throw new AgenticRepositoryWorkspaceError(adapter, realpathSync(path.resolve(cwd)));
  }
}
