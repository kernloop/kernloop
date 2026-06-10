/**
 * The ratified sandbox profile — THE named human-ratification point of the
 * toolsmith (spec §5.6; P3 design notes, open question 4). The profile below
 * was approved 6-1 (supermajority) by kernloop's own 7-voter vote gate and
 * recorded in the overlay audit chain as `governance.ratification.vote`. It
 * is embedded VERBATIM as a frozen constant; `forge` refuses with a typed
 * SandboxProfileMismatchError whenever the active profile's canonical-JSON
 * sha256 differs from RATIFIED_PROFILE_HASH.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * Shape of a sandbox profile. `network` is the literal `'none'` — a profile
 * with any other network mode is structurally invalid, not merely
 * unratified (spec §5.6: no network by default is the regime, not a knob).
 */
export const SandboxProfileSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  image: z.string().min(1),
  network: z.literal('none'),
  user: z.string().min(1),
  workdir: z.string().startsWith('/'),
  /** Human-readable mount policy; actual mounts are per-run declared inputs. */
  mounts: z.string().min(1),
  memory: z.string().regex(/^\d+[bkmg]$/),
  cpus: z.number().positive(),
  pidsLimit: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  decayWindowDays: z.number().int().positive(),
  liveToolCapPerOverlay: z.number().int().positive(),
});
export type SandboxProfile = z.infer<typeof SandboxProfileSchema>;

/**
 * The ratified profile, verbatim from the governance.ratification.vote
 * record (6-1 supermajority, 7-voter panel). Do not edit without a new vote.
 */
export const RATIFIED_SANDBOX_PROFILE: SandboxProfile = Object.freeze(
  SandboxProfileSchema.parse({
    name: 'kernloop-toolsmith-sandbox',
    version: '1.0.0',
    image: 'node:22-alpine',
    network: 'none',
    user: 'node',
    workdir: '/scratch',
    mounts:
      'a single fresh scratch directory read-write; declared input mounts read-only; nothing else',
    memory: '512m',
    cpus: 1,
    pidsLimit: 128,
    timeoutMs: 120000,
    decayWindowDays: 30,
    liveToolCapPerOverlay: 12,
  }),
);

/**
 * Canonical JSON: recursively key-sorted, no whitespace. Hashing canonical
 * JSON makes the ratified-profile check independent of key order.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** sha256 hex digest of a profile's canonical JSON. */
export function profileHash(profile: SandboxProfile): string {
  return createHash('sha256').update(canonicalJson(profile), 'utf8').digest('hex');
}

/** The hash every active forge profile must equal (CLM-0052 refusal gate). */
export const RATIFIED_PROFILE_HASH: string = profileHash(RATIFIED_SANDBOX_PROFILE);
