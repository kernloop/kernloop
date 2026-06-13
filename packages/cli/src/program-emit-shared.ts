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
