/**
 * Suggest-tier lifecycle proposals from the fitness ledger (spec §5.5 — the
 * self-issue loop; spec §3.2 — the authority ladder + exploration floor)
 * [CLM-0092, dogfood EPIC 4]. The Observer reads its OWN fitness ledger and
 * drift signals and turns them into two kinds of `suggest`-tier proposal:
 *
 * - DEPRECATION — a subject that is drifting (recent window below lifetime,
 *   via {@link driftSignals}) OR whose lifetime success rate sits below a
 *   configurable floor over a full window. The proposal SUGGESTS a human
 *   review/deprecation; it does NOT demote, remove, or touch the ladder.
 *   Per spec §3.2, capability removal ALWAYS needs human ratification and the
 *   exploration floor must keep feeding a demoted capability — so this is a
 *   suggestion to a human, never an auto-demotion.
 * - DISTILL — a high-fitness subject with a recent SUCCESSFUL run in the
 *   observer's own outcome log. The proposal SUGGESTS distilling that run's
 *   trace (its task id — the `distill` tool's input) into a skill. The
 *   `distill` tool itself enters at `suggest` and goes live only through a
 *   human-reviewed PR, so this proposes a proposal: nothing ships.
 *
 * THE HARD INVARIANT: this function is a PURE READ. It scores, suggests, and
 * assembles, but NEVER acts on its own authority — it writes nothing, files
 * no issue (no `gh`), demotes nothing, distills nothing, and merges nothing.
 * Every emitted proposal is `tier: 'suggest'` and is ratified by a human. The
 * observer never reads tables outside its own `observer_*` prefix and imports
 * only zod and its own ledger (constitutional rule 5).
 */
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { driftSignals, fitnessLedger, type DriftSignal, type FitnessRecord } from './ledger.js';
import type { IssueProposalInput } from './issues.js';

// Lifecycle thresholds — deliberate, documented heuristics (not principled
// science); every one is injectable per call. The MIN_INVOCATIONS gates keep a
// proposal from firing on sampling noise; LOW_FITNESS_MIN_INVOCATIONS mirrors
// the drift window so a floor breach and a drift signal speak the same n.

/** Lifetime success rate below which (an even coin-flip) a subject is worth a
 * human's deprecation review; at or above it, deprecation is premature. */
export const LOW_FITNESS_FLOOR = 0.5;
/** Minimum invocations before a low-fitness floor breach is assessed. */
export const LOW_FITNESS_MIN_INVOCATIONS = 10;
/** Lifetime success rate at or above which a subject is distill-worthy. */
export const HIGH_FITNESS_BAR = 0.9;
/** Minimum invocations before a subject is considered for distillation. */
export const HIGH_FITNESS_MIN_INVOCATIONS = 3;

/** Discriminates the two lifecycle proposal kinds. */
export type LifecycleProposalKind = 'deprecation' | 'distill';

/**
 * One suggest-tier lifecycle proposal. Shaped as the `proposeIssue` input
 * (`title`, `body`, `taskShaped`) plus the always-`suggest` tier, the kind,
 * and the subject — so a human (never this function) may feed it to
 * `proposeIssue`/`fileIssue`. It is a SUGGESTION, not an action.
 */
export interface LifecycleProposal extends IssueProposalInput {
  readonly kind: LifecycleProposalKind;
  /** The fitness subject (manifest/template/tool name) the proposal concerns. */
  readonly subject: string;
  /** Always `suggest` — the Observer never acts above it (spec §3.2, §5.5). */
  readonly tier: 'suggest';
}

/** Options for {@link lifecycleProposals}; defaults documented on the constants. */
export interface LifecycleOptions {
  /** Lifetime success rate below which a subject is proposed for review. */
  readonly lowFitnessFloor?: number;
  /** Minimum invocations before a floor breach is assessed. */
  readonly lowFitnessMinInvocations?: number;
  /** Lifetime success rate at or above which a subject is distill-worthy. */
  readonly highFitnessBar?: number;
  /** Minimum invocations before a subject is considered for distillation. */
  readonly highFitnessMinInvocations?: number;
  /** Drift-window size handed to {@link driftSignals} (default documented there). */
  readonly windowN?: number;
  /** Minimum window-vs-lifetime drop handed to {@link driftSignals}. */
  readonly minDrop?: number;
}

/** Validated output shape — proves every emitted proposal is suggest tier. */
export const LifecycleProposalSchema = z.strictObject({
  kind: z.enum(['deprecation', 'distill']),
  subject: z.string().min(1),
  tier: z.literal('suggest'),
  title: z.string().min(1),
  body: z.string().min(1),
  taskShaped: z.strictObject({
    goal: z.string().min(1),
    constraints: z.array(z.string().min(1)).optional(),
  }),
});

/** Render a 0–1 rate as an integer-percent string for proposal prose. */
function pct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

/** Build a deprecation proposal for a drifting or below-floor subject. */
function deprecationProposal(record: FitnessRecord, reason: string): LifecycleProposal {
  return {
    kind: 'deprecation',
    subject: record.subject,
    tier: 'suggest',
    title: `deprecate/review ${record.subject}`,
    body:
      `Observer suggests a HUMAN review (spec §5.5, §3.2): ${reason}. ` +
      `Lifetime success ${pct(record.successRate)} over ${String(record.invocations)} ` +
      `invocations. This is a SUGGESTION only — nothing is demoted or removed; ` +
      `capability removal requires human ratification and the exploration floor ` +
      `keeps feeding any demoted capability (spec §3.2).`,
    taskShaped: {
      goal: `Review ${record.subject} for deprecation: ${reason}`,
      constraints: [
        'suggest-tier proposal — human ratifies any deprecation/removal',
        'do not bypass the exploration floor (spec §3.2)',
      ],
    },
  };
}

/** Build a distill proposal for a high-fitness subject with a successful trace. */
function distillProposal(record: FitnessRecord, traceId: string): LifecycleProposal {
  return {
    kind: 'distill',
    subject: record.subject,
    tier: 'suggest',
    title: `distill ${traceId} for ${record.subject} into a skill`,
    body:
      `Observer suggests distilling trace ${traceId} (a successful run of ` +
      `${record.subject}, lifetime success ${pct(record.successRate)} over ` +
      `${String(record.invocations)} invocations) into a skill via the \`distill\` ` +
      `tool. \`distill\` proposes to \`skills/proposed/\` at suggest tier; a ` +
      `human-reviewed PR moves it live. Nothing is distilled or shipped here.`,
    taskShaped: {
      goal: `distill ${traceId} for ${record.subject} into a skill`,
      constraints: ['suggest-tier proposal — distill writes a proposal, human PR moves it live'],
    },
  };
}

/**
 * The most recent SUCCESSFUL run's task id for a subject, or `undefined`. The
 * `success = 1` filter means a trailing FAILED run is skipped — distill always
 * cites a real success, never a failure. Recency is keyed on `id` (the log is
 * append-only AUTOINCREMENT), the monotonic insert order; if that ever changes
 * (reorder/backfill), this recency semantics must move to the `at` clock.
 */
function recentSuccessTrace(db: Database.Database, subject: string): string | undefined {
  const row = db
    .prepare(
      `SELECT taskId FROM observer_outcome_log
       WHERE subject = ? AND success = 1 ORDER BY id DESC LIMIT 1`,
    )
    .get(subject) as { taskId: string } | undefined;
  return row?.taskId;
}

/**
 * Read the fitness ledger + drift signals and emit suggest-tier lifecycle
 * proposals (CLM-0092, dogfood EPIC 4). PURE READ — writes nothing, files
 * nothing, demotes nothing, distills nothing. An empty ledger yields an empty
 * array. A drifting OR below-floor subject yields a deprecation proposal (at
 * most one per subject — drift takes precedence); a high-fitness subject with
 * a recorded successful run yields a distill proposal. See the module docs
 * for the hard no-auto-action invariant (spec §3.2, §5.5).
 */
export function lifecycleProposals(
  db: Database.Database,
  options: LifecycleOptions = {},
): LifecycleProposal[] {
  const lowFloor = options.lowFitnessFloor ?? LOW_FITNESS_FLOOR;
  const lowMin = options.lowFitnessMinInvocations ?? LOW_FITNESS_MIN_INVOCATIONS;
  const highBar = options.highFitnessBar ?? HIGH_FITNESS_BAR;
  const highMin = options.highFitnessMinInvocations ?? HIGH_FITNESS_MIN_INVOCATIONS;
  const driftOpts: { windowN?: number; minDrop?: number } = {};
  if (options.windowN !== undefined) driftOpts.windowN = options.windowN;
  if (options.minDrop !== undefined) driftOpts.minDrop = options.minDrop;
  const driftBy = new Map<string, DriftSignal>();
  for (const signal of driftSignals(db, driftOpts)) {
    driftBy.set(signal.subject, signal);
  }
  const proposals: LifecycleProposal[] = [];
  for (const record of fitnessLedger(db)) {
    const drift = driftBy.get(record.subject);
    if (drift !== undefined) {
      proposals.push(
        deprecationProposal(
          record,
          `recent window success ${pct(drift.windowRate)} dropped ${pct(drift.drop)} ` +
            `below lifetime (drift, spec §5.5)`,
        ),
      );
    } else if (record.invocations >= lowMin && record.successRate < lowFloor) {
      proposals.push(
        deprecationProposal(record, `lifetime success below the ${pct(lowFloor)} floor`),
      );
    } else if (record.invocations >= highMin && record.successRate >= highBar) {
      const traceId = recentSuccessTrace(db, record.subject);
      if (traceId !== undefined) proposals.push(distillProposal(record, traceId));
    }
  }
  return proposals;
}
