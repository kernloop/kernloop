/**
 * The RATIFIED quality-gate sandbox profile (#236, CLM-0129; consensus 7/7).
 * Mirrors the toolsmith profile+hash pattern — the exec primitive is in
 * @kernloop/kernel; the governed image+caps and their content hash live here so
 * an overlay cannot silently swap them. A gate check runs untrusted generated
 * code under `--network none`, non-root, mem/cpu/pids caps, over a workspace
 * copy. Image is a glibc node:22 (so host-built native deps load) DIGEST-pinned.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '@kernloop/kernel';
import { SandboxExecProfileSchema, type SandboxExecProfile } from '@kernloop/kernel';

/** node:22 (glibc) pinned by digest — re-pinning is a deliberate re-ratification. */
export const GATE_IMAGE =
  'node:22@sha256:2d178f2785b96dfbf62a416ca2e40f50e30150b4ff3320d706f0d96e90600eb3';

/** The ratified exec profile every sandboxed gate check runs under. */
export const RATIFIED_GATE_PROFILE: SandboxExecProfile = Object.freeze(
  SandboxExecProfileSchema.parse({
    image: GATE_IMAGE,
    network: 'none',
    user: 'node',
    workdir: '/work',
    memory: '4g',
    cpus: 2,
    pidsLimit: 1024,
    timeoutMs: 600_000,
  }),
);

/** sha256 hex of a profile's canonical JSON — the content gate for overrides. */
export function gateProfileHash(profile: SandboxExecProfile): string {
  return createHash('sha256').update(canonicalJson(profile), 'utf8').digest('hex');
}

/** The hash an overlay-supplied profile must match to be honored (fail-closed). */
export const RATIFIED_GATE_PROFILE_HASH: string = gateProfileHash(RATIFIED_GATE_PROFILE);
