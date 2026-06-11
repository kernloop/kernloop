/**
 * Routing-prior export from the fitness ledger (spec §7: "learned routing
 * priors, exported, reviewable"). The Observer's fitness ledger holds the
 * routing-fitness signal — per-subject success rate — which today lives only
 * inside the overlay's SQLite. This reads the routing-prior-relevant columns
 * into a portable, JSON/YAML-serializable document (CLM-0070). Seeding the
 * Router FROM these priors is out of scope here: this is export/reviewability
 * only. Faculty isolation holds — only zod and the faculty's own ledger.
 */
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { fitnessLedger } from './ledger.js';

/** One exported routing prior — the fitness signal for one routing subject. */
export const RoutingPriorSchema = z.strictObject({
  /** The manifest/template/tool name the prior is attributed to. */
  subject: z.string().min(1),
  invocations: z.number().int().nonnegative(),
  /** successes / invocations — the routing fitness signal (spec §5.5). */
  successRate: z.number().min(0).max(1),
  /** Epoch ms of the most recent ingested Outcome for this subject. */
  lastUsedAt: z.number().int().nonnegative(),
});
export type RoutingPrior = z.infer<typeof RoutingPriorSchema>;

/** The portable routing-priors document (spec §7 priors.yaml). Versioned. */
export const PriorsExportSchema = z.strictObject({
  version: z.literal('1'),
  priors: z.array(RoutingPriorSchema),
});
export type PriorsExport = z.infer<typeof PriorsExportSchema>;

/**
 * Export the routing-prior-relevant fields of the fitness ledger (CLM-0070),
 * most recently used subject first (the ledger's own ordering). An empty
 * ledger exports an empty `priors` array — never an invented row.
 */
export function exportPriors(db: Database.Database): PriorsExport {
  const priors: RoutingPrior[] = fitnessLedger(db).map((row) => ({
    subject: row.subject,
    invocations: row.invocations,
    successRate: row.successRate,
    lastUsedAt: row.lastUsedAt,
  }));
  return { version: '1', priors };
}
