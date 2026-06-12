/**
 * The issue-tracker overlay block (spec §5.5) [CLM-0093], split out of
 * overlay.ts to keep that file within its LOC budget. Declares which provider
 * the `kernloop tracker` surface targets, the repo it is scoped to, and the
 * authority `tier`. `tier` defaults to `suggest` — the SAFE default — which
 * forces dry-run: a tracker op proposes the would-be `gh` invocation and
 * spawns nothing. ONLY an explicit `enforce` tier (a human-ratified promotion)
 * lets `--execute` perform a real mutation; the system never defaults upward
 * (spec §3.2). The repo is `owner/name`, the only source of the `--repo`
 * scope — never issue content.
 */
import { z } from 'zod';

/** Repo `owner/name` shape: each segment a conservative safe charset. */
const TRACKER_REPO_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** The `tracker:` overlay block schema (see module docs). */
export const TrackerSchema = z.strictObject({
  provider: z.literal('github').default('github'),
  repo: z.string().regex(TRACKER_REPO_PATTERN, 'tracker.repo must be "owner/name"'),
  tier: z.enum(['suggest', 'enforce']).default('suggest'),
});

/** Validated tracker config; `tier` gates `--execute` (enforce only). */
export type TrackerConfig = z.infer<typeof TrackerSchema>;

/** Commented `tracker:` lines for the `kernloop init` overlay.yaml template. */
export const TRACKER_TEMPLATE_LINES: readonly string[] = [
  '# tracker:  # issue-tracker for `kernloop tracker` (spec §5.5) — dry-run by default',
  '#   provider: github     # the only provider today; gh ambient auth, no token here',
  '#   repo: owner/name     # the ONLY source of the gh --repo scope (never issue content)',
  '#   tier: suggest        # suggest (default) = dry-run only; enforce = --execute honored (human-ratified)',
];
