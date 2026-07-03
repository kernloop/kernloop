/**
 * Provision the workspace's DECLARED package manager into the sandbox scratch
 * (#548). The ratified offline image ships node + npm + corepack but no
 * pnpm/yarn, and corepack cannot download under `--network none` — so turbo,
 * which re-invokes each package script through the DECLARED PM
 * (`packageManager` in the root package.json), fails environmentally with
 * `Unable to find package manager binary`. Every gate check that goes through
 * turbo (typecheck/lint/test) then fails for a reason the child cannot fix.
 *
 * We PROVISION, never MUTATE: the PM's dist is copied from the HOST corepack
 * cache (version-pinned, fully offline) into `<scratch>/.kernloop-pm/` and a
 * POSIX shim is put on PATH. Rewriting the scratch's `packageManager` field to
 * npm was rejected — it mutates the very workspace semantics the checks test.
 * [CLM-0192]
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { copyDir } from './copy.js';

/** Scratch-relative dir the shim + copied dist live under (bind-mounted at /work). */
export const SCRATCH_PM_DIR = '.kernloop-pm';

/** Where the container sees the provisioned PM (scratch is bind-mounted at /work). */
const CONTAINER_PM_ROOT = `/work/${SCRATCH_PM_DIR}`;

/** A package manager declared by the workspace's `packageManager` field. */
export interface DeclaredPm {
  /** The PM name — only `pnpm`/`yarn` need provisioning (npm ships with node). */
  readonly name: 'pnpm' | 'yarn';
  /** The exact pinned version, e.g. `10.33.0`. */
  readonly version: string;
}

/** The outcome of a provision attempt. */
export interface ProvisionResult {
  /** True when the scratch is ready (provisioned, or a no-op for npm/absent). */
  readonly ok: boolean;
  /** Actionable failure message when `ok` is false; the caller fails closed. */
  readonly error?: string;
}

/**
 * Parse the workspace root `packageManager` field (e.g. `pnpm@10.33.0`).
 * Returns undefined — a legitimate NO-OP — when the field is absent/malformed
 * or names npm (npm ships with node, needs no provisioning). A corepack
 * `+<integrity-hash>` suffix on the version is stripped.
 */
export function parseDeclaredPm(workspaceDir: string): DeclaredPm | undefined {
  let pkg: unknown;
  try {
    pkg = JSON.parse(readFileSync(path.join(workspaceDir, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
  const field = (pkg as { packageManager?: unknown }).packageManager;
  if (typeof field !== 'string') return undefined;
  const at = field.indexOf('@');
  if (at <= 0) return undefined;
  const name = field.slice(0, at);
  const version = (field.slice(at + 1).split('+')[0] ?? '').trim();
  if (version.length === 0) return undefined;
  if (name !== 'pnpm' && name !== 'yarn') return undefined;
  return { name, version };
}

/** Host corepack cache root: `$COREPACK_HOME` ?? `~/.cache/node/corepack`. */
export function corepackCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.COREPACK_HOME;
  if (home !== undefined && home.length > 0) return home;
  return path.join(homedir(), '.cache', 'node', 'corepack');
}

/** The cached dist dir for a declared PM: `<cache>/v1/<name>/<version>`. */
export function cachedDistDir(pm: DeclaredPm, env?: NodeJS.ProcessEnv): string {
  return path.join(corepackCacheRoot(env), 'v1', pm.name, pm.version);
}

/**
 * Resolve the PM's entry file (relative to its dist dir) from the cached dist's
 * OWN package.json `bin` field — NEVER hardcoded. `bin` may be a string or a
 * `{ name: path }` map; the entry for `pmName` is returned. Throws when no
 * entry is declared or the resolved file is absent, so a broken/partial cache
 * fails LOUD rather than writing a dead shim.
 */
export function resolveEntry(distDir: string, pmName: string): string {
  const pkg = JSON.parse(readFileSync(path.join(distDir, 'package.json'), 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const bin = pkg.bin;
  const entry = typeof bin === 'string' ? bin : bin?.[pmName];
  if (entry === undefined || entry.length === 0) {
    throw new Error(`cached ${pmName} dist declares no bin entry for ${pmName}`);
  }
  const abs = path.join(distDir, entry);
  if (!existsSync(abs)) {
    throw new Error(`resolved ${pmName} entry does not exist in cached dist: ${abs}`);
  }
  return entry;
}

/**
 * Write the executable POSIX shim `<pmRoot>/bin/<name>` (mode 0755). The shim
 * execs node against the copied dist's resolved entry AT ITS CONTAINER PATH
 * (`/work/.kernloop-pm/<name>/<entry>`), passing argv through verbatim.
 */
function writeShim(pmRoot: string, name: string, entry: string): void {
  const binDir = path.join(pmRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  const shimPath = path.join(binDir, name);
  const target = `${CONTAINER_PM_ROOT}/${name}/${entry}`;
  writeFileSync(shimPath, `#!/bin/sh\nexec node ${target} "$@"\n`, { mode: 0o755 });
  chmodSync(shimPath, 0o755); // force the exec bit regardless of the host umask
}

/**
 * Provision `scratchDir` with the workspace's declared PM. A NO-OP (ok:true)
 * when the workspace declares npm or no PM. Fails CLOSED (ok:false + an
 * actionable message naming `corepack prepare <name>@<version>`) when the
 * declared version is NOT in the host corepack cache — the caller surfaces that
 * as a spawnError so the gate never runs half-provisioned or silently green.
 */
export function provisionPackageManager(
  workspaceDir: string,
  scratchDir: string,
  env?: NodeJS.ProcessEnv,
): ProvisionResult {
  const pm = parseDeclaredPm(workspaceDir);
  if (pm === undefined) return { ok: true };
  const distDir = cachedDistDir(pm, env);
  if (!existsSync(distDir)) {
    return {
      ok: false,
      error:
        `workspace declares ${pm.name}@${pm.version}; host corepack cache lacks it ` +
        `(${distDir}) — run \`corepack prepare ${pm.name}@${pm.version}\``,
    };
  }
  const entry = resolveEntry(distDir, pm.name); // throws LOUD on a broken cache
  const pmRoot = path.join(scratchDir, SCRATCH_PM_DIR);
  mkdirSync(pmRoot, { recursive: true });
  copyDir(distDir, path.join(pmRoot, pm.name));
  writeShim(pmRoot, pm.name, entry);
  return { ok: true };
}
