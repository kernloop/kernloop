/**
 * Shared `program emit` plumbing (spec §5.4; CLM-0098) used by BOTH emit modes —
 * the ad-hoc `--goal/--spec` path (program-emit.ts) and the ledger-driven
 * `--program` path (program-emit-ledger.ts). Extracted so the issue-spam guard
 * is ONE definition the two modes cannot diverge on.
 */
import { ProgramInputError } from './program-shared.js';

/** Emitting more than this many issues needs an explicit `--confirm-count N`. */
export const SPAM_LIMIT = 20;

/**
 * Enforce the issue-spam guard (a #52 vote condition): a node count over
 * {@link SPAM_LIMIT} needs an explicit `--confirm-count` matching it EXACTLY as
 * a string (no numeric coercion). Throws a typed {@link ProgramInputError}
 * (clean nonzero exit) BEFORE any provider is built or proposal made.
 */
export function checkSpamGuard(count: number, confirmCount: string | undefined): void {
  if (count <= SPAM_LIMIT) return;
  if (confirmCount !== String(count)) {
    throw new ProgramInputError(
      `emitting ${String(count)} issues exceeds the spam guard (${String(SPAM_LIMIT)}); pass --confirm-count ${String(count)} to proceed`,
    );
  }
}

/** The placeholder repo a no-tracker DRY-RUN preview renders against (#94). */
export const PREVIEW_REPO = 'OWNER/REPO';

/** The notice for an unconfigured dry-run preview — honest that filing needs config. */
export const PREVIEW_NOTICE =
  'DRY RUN — no tracker configured (preview only; add a tracker block to overlay.yaml to --execute)';

/**
 * Resolve the tracker config for an emit, ALLOWING a pure dry-run preview with NO
 * tracker block (#94): an unconfigured dry-run renders the would-be proposals
 * against {@link PREVIEW_REPO} and spawns nothing (a tracker is only built, never
 * invoked, in dry-run). Only `--execute` requires a real tracker — without one it
 * is a clean input error. Returns the effective repo+tier and whether this is the
 * unconfigured preview, so the caller can note it honestly. Shared by BOTH emit
 * modes so the two cannot diverge.
 */
export function emitTrackerConfig(
  cfg: { repo: string; tier: 'suggest' | 'enforce' } | undefined,
  executeFlag: boolean,
): { repo: string; tier: 'suggest' | 'enforce'; previewOnly: boolean } {
  if (cfg !== undefined) return { repo: cfg.repo, tier: cfg.tier, previewOnly: false };
  if (executeFlag) {
    throw new ProgramInputError(
      'no tracker configured — add tracker: { provider: github, repo: owner/name } to overlay.yaml to --execute',
    );
  }
  return { repo: PREVIEW_REPO, tier: 'suggest', previewOnly: true };
}
