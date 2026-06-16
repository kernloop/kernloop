/**
 * Typed errors for the kernel Docker-sandbox primitive (#234, spec §5.6).
 * Callers discriminate on `name` or `instanceof` — never on message text.
 * These moved here from faculty-toolsmith so BOTH the toolsmith (workshop
 * tools) and faculty-gates (the quality gate, #227 item 2) can share one
 * sandbox primitive without a faculty→faculty import (rule 5); toolsmith
 * re-exports them for back-compat.
 *
 * @module kernel/sandbox/errors
 */

/**
 * Thrown when the docker binary is missing or the daemon is unreachable.
 * A sandboxed caller NEVER runs the contained command unsandboxed — docker
 * absent means refuse, not degrade (CLM-0052). The policy for what a caller
 * does with this refusal (fail-closed vs. a scoped fallback) is the caller's,
 * not the primitive's.
 */
export class SandboxUnavailableError extends Error {
  constructor(detail: string) {
    super(`sandbox unavailable: ${detail} — refusing to run unsandboxed (spec §5.6)`);
    this.name = 'SandboxUnavailableError';
  }
}

/**
 * Thrown when an active sandbox profile's canonical-JSON sha256 differs from a
 * ratified profile hash. A sandbox profile is human-ratified as data (P3
 * design note, open question 4); running under any other profile refuses.
 */
export class SandboxProfileMismatchError extends Error {
  readonly expectedHash: string;
  readonly actualHash: string;

  constructor(expectedHash: string, actualHash: string) {
    super(
      `sandbox profile hash ${actualHash} does not match the ratified profile hash ${expectedHash} — ` +
        'refusing under an unratified profile',
    );
    this.name = 'SandboxProfileMismatchError';
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

/**
 * Thrown when a declared sandbox mount has an unsafe source or target — a path
 * that could inject extra fields into the docker `-v` spec. Guards the
 * otherwise-latent `-v` option-injection surface (a path with a colon).
 */
export class SandboxMountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxMountError';
  }
}
