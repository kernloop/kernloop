/**
 * Agentic-cwd containment (#280 part 2 / #138, CLM-0145) — refuse an AGENTIC
 * adapter (a CLI that executes generated code and reads/writes its cwd) when its
 * workspace is a NON-throwaway git working tree. Generated code in your real repo
 * could poison `.git/hooks` (runs on every git op), rewrite `.git/config`, or read
 * tracked secrets. A pure-API adapter (ollama, no cwd) is not a threat.
 *
 * The boundary is GIT-TREE containment, NOT general secret protection: a non-git
 * directory holding a `.env` is NOT covered here (that is a separate, larger
 * scope). The contained adapter has no runtime opt-out it can reach (a security
 * boundary, not a tuning knob); the audited overlay opt-out is deferred (#320).
 *
 * TRUST ASSUMPTION (#332): the throwaway carve-out is the OS temp dir, and
 * `os.tmpdir()` honors `$TMPDIR`/`$TMP`/`$TEMP`. The contained model cannot set
 * kernloop's launch env (this guard runs in the parent BEFORE the child spawns),
 * but a LAUNCHER that points `$TMPDIR` at/above a working tree makes that tree
 * resolve "under tmpRoot" and disables the carve-out's refusal for it. Deriving
 * the carve-out from a kernloop-OWNED root instead of ambient `$TMPDIR` is the
 * hardening tracked in #332 (which also closes the cloned-under-tmpdir gap).
 * Pure path logic — the kernel stays model-free.
 *
 * @module kernel/adapters/containment
 */
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type AdapterName } from './definitions.js';
import { AgenticRepositoryWorkspaceError } from './errors.js';

/**
 * Realpath of the OS temp dir, or null when it cannot be resolved (e.g. a
 * `$TMPDIR` pointing nowhere). Null ⇒ NO throwaway carve-out applies, so a real
 * git tree is still refused — fail closed rather than throw an untyped ENOENT.
 */
function resolveTmpRoot(): string | null {
  try {
    return realpathSync(tmpdir());
  } catch {
    return null;
  }
}

/**
 * Adapters that EXECUTE generated code and read/write their cwd. The complement
 * is the pure-API, no-cwd set ({@link NON_AGENTIC_ADAPTERS}); a registry-match
 * test asserts every {@link AdapterName} is classified into exactly one, so a new
 * cwd-using adapter cannot silently bypass containment.
 */
export const AGENTIC_ADAPTERS: ReadonlySet<AdapterName> = new Set([
  'claude',
  'codex',
  'opencode',
  'agy',
]);

/** Adapters that take no cwd (read stdin, return text) — not a filesystem threat. */
export const NON_AGENTIC_ADAPTERS: ReadonlySet<AdapterName> = new Set(['ollama']);

/** Realpath of `dir` (symlink-resistant), or null when it cannot be resolved. */
function resolveReal(dir: string): string | null {
  try {
    return realpathSync(path.resolve(dir));
  } catch {
    return null;
  }
}

/** Whether `real` is at or under a `.git` working tree — the upward walk to the
 * filesystem root, shared by both containment predicates so their git-detection
 * semantics can never desync (#332 review). */
function gitTreeAtOrAbove(real: string): boolean {
  for (let cur = real; ;) {
    if (existsSync(path.join(cur, '.git'))) return true;
    const parent = path.dirname(cur);
    if (parent === cur) return false; // hit the filesystem root, no .git
    cur = parent;
  }
}

/** Whether `real` resolves at or under `tmpRoot` (the throwaway carve-out region). */
function underTmp(real: string, tmpRoot: string | null): boolean {
  return tmpRoot !== null && (real === tmpRoot || real.startsWith(tmpRoot + path.sep));
}

/**
 * Whether `dir`'s realpath is a NON-throwaway git working tree. THROWAWAY (false)
 * when it resolves under the realpath'd temp dir (the hermetic-test / scratch
 * pattern) OR when no `.git` exists at or above it. NON-throwaway (true) when a
 * `.git` exists at/above it outside the temp dir. Symlink-resistant (realpath),
 * mirroring the writeWorkspaceFiles escape guard. KNOWN GAP: a real repo cloned
 * UNDER the temp dir is treated as throwaway (location ≠ provenance, #332).
 * `tmpRoot` is injectable for tests; it defaults to the realpath'd OS temp dir
 * (macOS /tmp → /private/tmp), so the prefix compare is symlink-correct. A null
 * `tmpRoot` (temp dir unresolvable) disables the carve-out — fail closed.
 */
export function isNonThrowawayGitTree(
  dir: string,
  tmpRoot: string | null = resolveTmpRoot(),
): boolean {
  const real = resolveReal(dir);
  if (real === null) return false; // a path we cannot resolve is not a tree we can corrupt
  if (underTmp(real, tmpRoot)) return false; // throwaway scratch
  return gitTreeAtOrAbove(real); // a real working tree iff a .git is at/above it
}

/**
 * Whether the throwaway carve-out MASKED a real git tree (#332 observability). True
 * when `dir` resolves UNDER `tmpRoot` — so {@link isNonThrowawayGitTree} treats it as
 * throwaway and ALLOWS an agentic adapter — YET a `.git` exists at or above it: a real
 * repo cloned/located under the temp dir, or a `$TMPDIR` a launcher pointed at/above a
 * working tree. The allow is correct under the LOCATION-based carve-out, but the
 * decision is otherwise SILENT; the loop path audits this case (rule 7) so an operator
 * can SEE that an agentic adapter was let into a git tree on the strength of its
 * location alone (the location ≠ provenance gap, #332). Pure; shares the realpath +
 * git-walk helpers with {@link isNonThrowawayGitTree} so the two cannot desync. A null
 * `tmpRoot` (no carve-out) or an unresolvable / non-under-tmp `dir` ⇒ nothing was masked.
 */
export function carveOutMaskedGitTree(
  dir: string,
  tmpRoot: string | null = resolveTmpRoot(),
): boolean {
  if (tmpRoot === null) return false; // no carve-out applied → nothing was masked
  const real = resolveReal(dir);
  if (real === null) return false;
  if (!underTmp(real, tmpRoot)) return false; // not under tmp → the refusal path owns it
  return gitTreeAtOrAbove(real); // carve-out is hiding a real tree iff a .git is at/above
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
