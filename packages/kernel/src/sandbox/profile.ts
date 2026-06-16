/**
 * The EXECUTION shape of a Docker sandbox profile (#234, spec §5.6) — the
 * generic isolation knobs the {@link buildDockerArgs} primitive reads, and
 * nothing else. A consumer's full, human-ratified profile (e.g. the
 * toolsmith's `RATIFIED_SANDBOX_PROFILE`, which adds governance fields like
 * tool-decay windows and per-overlay live-tool caps) is a STRUCTURAL SUPERSET
 * of this: the exec schema strips the extra fields at the boundary, so the
 * kernel primitive stays oblivious to faculty-specific governance (rule 4 — no
 * faculty concepts leak into the kernel) while still validating every knob it
 * actually uses. `network` is the literal `'none'`: a profile with any other
 * network mode is structurally invalid here, not merely unratified (spec §5.6
 * — no network is the regime, not a knob).
 *
 * @module kernel/sandbox/profile
 */
import { z } from 'zod';

/**
 * The execution knobs every sandboxed run is built from. A non-strict object:
 * a richer caller profile validates against it (extra governance fields are
 * stripped), but every exec field is checked — an invalid `memory`/`cpus`/etc.
 * is rejected at the boundary, never silently passed to `docker run`.
 */
export const SandboxExecProfileSchema = z.object({
  /** Container image to run, e.g. `node:22-alpine`. */
  image: z.string().min(1),
  /** Network mode — the literal `'none'`; no other value is valid. */
  network: z.literal('none'),
  /** Unprivileged container user, e.g. `node`. */
  user: z.string().min(1),
  /** Absolute container workdir the fresh scratch dir is mounted at. */
  workdir: z.string().startsWith('/'),
  /** Memory cap, e.g. `512m` (docker `--memory` syntax). */
  memory: z.string().regex(/^\d+[bkmg]$/),
  /** CPU cap (docker `--cpus`). */
  cpus: z.number().positive(),
  /** Process-count cap (docker `--pids-limit`). */
  pidsLimit: z.number().int().positive(),
  /** Wall-clock kill deadline for the contained run, in ms. */
  timeoutMs: z.number().int().positive(),
});

/** The execution knobs {@link buildDockerArgs}/{@link runInSandbox} consume. */
export type SandboxExecProfile = z.infer<typeof SandboxExecProfileSchema>;
