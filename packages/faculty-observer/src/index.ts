/**
 * @kernloop/faculty-observer — Layer 2 observer faculty (spec §5.5).
 *
 * P3 surface: the tool/skill/template fitness ledger, per-voter precision
 * series, cost-per-governed-decision, drift signals (CLM-0055), and the
 * self-issue path at `suggest` tier (CLM-0056). Bus subscription happens at
 * the composition root — this package exposes ingest functions; auditing of
 * observer activity likewise happens kernel-side at the bus boundary. The
 * faculty imports only @kernloop/contracts and external dependencies
 * (constitutional rule 5), and contains no executor/engine coupling: a
 * self-filed issue's task-shaped payload re-enters through the ordinary
 * `run` entry point, never a privileged path.
 */
import type { Outcome, Verdict } from '@kernloop/contracts';
import { DEFAULT_LOG_RETENTION_MS, openStore, pruneLogs } from './store.js';
import {
  driftSignals,
  fitness,
  fitnessLedger,
  ingestOutcome,
  type DriftOptions,
  type DriftSignal,
  type FitnessRecord,
} from './ledger.js';
import {
  costPerGovernedDecision,
  ingestVerdict,
  recordVoterOutcome,
  runningPrecision,
  voterSeries,
  type GateDecisionCost,
  type RunningPrecision,
  type VoterSeriesEntry,
} from './voters.js';
import {
  getIssue,
  listIssues,
  markIssueFiled,
  proposeIssue,
  type IssueProposal,
  type IssueProposalInput,
} from './issues.js';
import { exportPriors, type PriorsExport } from './priors.js';
import { lifecycleProposals, type LifecycleOptions, type LifecycleProposal } from './lifecycle.js';

export { InvalidOutcomeError, InvalidVerdictError, InvalidIssueProposalError } from './errors.js';
export { SCHEMA_DDL } from './store.js';
export { DEFAULT_DRIFT_WINDOW_N, DEFAULT_DRIFT_MIN_DROP } from './ledger.js';
export type { DriftOptions, DriftSignal, FitnessCost, FitnessRecord } from './ledger.js';
export { DEFAULT_PRECISION_WINDOW_N } from './voters.js';
export type { GateDecisionCost, RunningPrecision, VoterSeriesEntry } from './voters.js';
export { issueBody } from './issues.js';
export type { IssueProposal, IssueProposalInput } from './issues.js';
export { PriorsExportSchema, RoutingPriorSchema } from './priors.js';
export type { PriorsExport, RoutingPrior } from './priors.js';
export {
  HIGH_FITNESS_BAR,
  HIGH_FITNESS_MIN_INVOCATIONS,
  LOW_FITNESS_FLOOR,
  LOW_FITNESS_MIN_INVOCATIONS,
  LifecycleProposalSchema,
} from './lifecycle.js';
export type { LifecycleOptions, LifecycleProposal, LifecycleProposalKind } from './lifecycle.js';
export { observerManifest } from './manifest.js';

/** Options for {@link createObserver}. */
export interface CreateObserverOptions {
  /**
   * Write-time clock returning epoch ms; defaults to `Date.now`. Injectable
   * so recency/series behavior is deterministic under test.
   */
  clock?: () => number;
  /**
   * Append-only-log retention in ms; defaults to {@link DEFAULT_LOG_RETENTION_MS}
   * (90 days). On open, log rows older than this are pruned (#159) — bounding
   * growth without touching the ingest hot path or any subject's recent window.
   */
  retentionMs?: number;
}

/** The observer faculty's API over one overlay database (spec §5.5). */
export interface Observer {
  /** Ledger write — zod-validated Outcome attributed to a subject (CLM-0055). */
  ingestOutcome(outcome: Outcome, attribution: { subject: string }): FitnessRecord;
  /** Ledger read — one subject's invocations/successRate/cost/lastUsedAt. */
  fitness(subject: string): FitnessRecord | undefined;
  /** Ledger read — every fitness row, most recently used first. */
  fitnessLedger(): FitnessRecord[];
  /** Series write — zod-validated Verdict; one row per VoterRecord (CLM-0055). */
  ingestVerdict(verdict: Verdict): number;
  /** Series read — one voter's votes, oldest first. */
  voterSeries(voter: string): VoterSeriesEntry[];
  /** Label write — ground truth for one voter's vote on one task. */
  recordVoterOutcome(voter: string, taskId: string, correct: boolean): void;
  /** Sliding-window precision over the last N labeled votes (spec §3.2). */
  runningPrecision(voter: string, options?: { windowN?: number }): RunningPrecision;
  /** Mean verdict cost per gate — spec §8 item 7. */
  costPerGovernedDecision(gate: string): GateDecisionCost | undefined;
  /** Subjects whose recent window underperforms lifetime (spec §5.5). */
  driftSignals(options?: DriftOptions): DriftSignal[];
  /**
   * Suggest-tier deprecation + distill proposals from fitness/drift, NEVER
   * auto-acted (CLM-0092). Pure read — files/demotes/distills nothing.
   */
  lifecycleProposals(options?: LifecycleOptions): LifecycleProposal[];
  /** Export learned routing priors from the fitness ledger (CLM-0070). */
  exportPriors(): PriorsExport;
  /** Persist a self-issue proposal at suggest tier (CLM-0056). */
  proposeIssue(input: IssueProposalInput): IssueProposal;
  /** One proposal by id. */
  getIssue(id: number): IssueProposal | undefined;
  /** All proposals, newest first. */
  listIssues(): IssueProposal[];
  /**
   * Mark a proposal `filed` with its tracker `url` — a PURE DB write the gated
   * `kernloop observer file` CLI calls AFTER the tracker confirms the issue
   * (CLM-0056). The faculty never spawns or reaches a tracker itself.
   */
  markIssueFiled(id: number, url: string): IssueProposal;
  /** Close the underlying database handle. */
  close(): void;
}

/**
 * Open (creating and migrating if absent) the observer's tables in the
 * overlay database at `dbPath` (spec §3.3: one DB per overlay — the
 * composition root points every faculty at the same file; the `observer_*`
 * table prefix is the ownership boundary, see store.ts).
 */
export function createObserver(dbPath: string, options: CreateObserverOptions = {}): Observer {
  const clock = options.clock ?? Date.now;
  const db = openStore(dbPath);
  // Bound the append-only logs on open (#159) — once, off the ingest hot path,
  // relative to the newest log row (no clock read, so deterministic clocks are
  // undisturbed).
  pruneLogs(db, options.retentionMs ?? DEFAULT_LOG_RETENTION_MS);
  return {
    ingestOutcome: (outcome, attribution) =>
      ingestOutcome(db, clock(), outcome, attribution.subject),
    fitness: (subject) => fitness(db, subject),
    fitnessLedger: () => fitnessLedger(db),
    ingestVerdict: (verdict) => ingestVerdict(db, clock(), verdict),
    voterSeries: (voter) => voterSeries(db, voter),
    recordVoterOutcome: (voter, taskId, correct) =>
      recordVoterOutcome(db, clock(), voter, taskId, correct),
    runningPrecision: (voter, opts) => runningPrecision(db, voter, opts),
    costPerGovernedDecision: (gate) => costPerGovernedDecision(db, gate),
    driftSignals: (opts) => driftSignals(db, opts),
    lifecycleProposals: (opts) => lifecycleProposals(db, opts),
    exportPriors: () => exportPriors(db),
    proposeIssue: (input) => proposeIssue(db, clock(), input),
    getIssue: (id) => getIssue(db, id),
    listIssues: () => listIssues(db),
    markIssueFiled: (id, url) => markIssueFiled(db, clock(), id, url),
    close: () => db.close(),
  };
}
