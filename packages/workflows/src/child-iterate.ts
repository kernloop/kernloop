/**
 * The review-driven child iteration back-edge [CLM-0043] — the actor-critic
 * inner loop. It MIRRORS the proven vote→plan machinery (steps.ts
 * `advanceVote`): the branching lives in `advanceChild`, NOT in the graph,
 * which stays frozen and acyclic. When a child's quality gate rejects and the
 * child is still within its Kc bound (and the run is within budget), the
 * cursor resets to the child's `implement` sub-node, the gate's findings fold
 * into `child.findings` (read by the coder's next attempt), and the child's
 * `iteration` increments — the same shape as a rejected vote re-entering plan.
 *
 * At the bound (Kc exhausted OR budget exceeded) the child is marked
 * `escalated` with its findings recorded, and the fan-out advances to the next
 * child: one stuck child must not sink the sprint. On a passing quality gate
 * the chain advances through review to the next child (today's behavior).
 *
 * HONESTY GUARD: the review gate is advisory (CLM-0064) and does NOT drive
 * iteration by default. Quality drives the loop; review findings ride along as
 * non-gating hints folded into the next attempt. Review-driven iteration is
 * gated behind `reviewDrivesIteration` (default off) — enabled only when the
 * review gate is promoted to enforce; we never claim review enforces.
 */
import type { Finding, Verdict } from '@kernloop/contracts';
import type { LoopNode } from './graph.js';
import type { ChildResult, RunState } from './state.js';
import { verdictDisposition } from './verdict-disposition.js';

/** How a child sub-gate's verdict steers the fan-out cursor. */
export type ChildBranch = 'pass' | 'reiterate' | 'escalate';

/** An audit event fired on each child re-iteration (the CLI wires it to the chain). */
export interface ChildIterateEvent {
  readonly childId: string;
  readonly iteration: number;
  readonly gate: string;
  readonly findingCount: number;
}

/** Which gates drive child iteration this run — flags the engine resolves from
 * config (review at enforce; parsimony at intensity full/ultra). */
export interface IterationDrivers {
  readonly reviewDrives: boolean;
  readonly parsimonyDrives: boolean;
}

/**
 * Whether THIS gate sub-node drives child iteration. Quality always drives.
 * Review drives only when `reviewDrives` is on (the review gate is at enforce)
 * — the honesty guard. Parsimony drives only when `parsimonyDrives` is on (the
 * overlay's `gates.parsimony.intensity` is full/ultra, #9/#415) — at lite/off it
 * is advisory/disabled. Non-driving gates never trigger a re-implement; their
 * findings still fold in as hints (see {@link foldHints}).
 */
export function gateDrivesIteration(node: LoopNode, drivers: IterationDrivers): boolean {
  if (node.gate === 'quality') return true;
  if (node.gate === 'review') return drivers.reviewDrives;
  if (node.gate === 'parsimony') return drivers.parsimonyDrives;
  return false;
}

/**
 * Decide the branch after a driving gate ran for a child. `pass` advances the
 * sub-chain; `reiterate` re-runs implement (within Kc and budget); `escalate`
 * stops the child at the bound. `withinBudget` is false when a re-entry would
 * exceed the run budget (Part B) — that forces `escalate` before Kc.
 *
 * An `escalate` VERDICT (#192) — the gate ruling "a human must decide" — forces
 * `escalate` IMMEDIATELY, regardless of Kc or budget: a human ruling is not a
 * re-attempt. Routing goes through {@link verdictDisposition} so a future
 * `VerdictResult` value is a compile error here, never a silent mis-branch.
 */
export function childBranch(
  verdict: Verdict,
  result: ChildResult,
  kc: number,
  withinBudget: boolean,
): ChildBranch {
  const disposition = verdictDisposition(verdict.result);
  if (disposition === 'advance') return 'pass';
  if (disposition === 'escalate') return 'escalate';
  if (result.iteration >= kc || !withinBudget) return 'escalate';
  return 'reiterate';
}

/** Stable identity of a Finding — every field of the (strict) contract shape:
 * severity + message + optional path. Two findings with the same key are the
 * same finding re-emitted by a later gate run, not new information. */
function findingKey(finding: Finding): string {
  return `${finding.severity}\u0000${finding.message}\u0000${finding.path ?? ''}`;
}

/** Append `findings` to the child's accumulated set, DROPPING duplicates of
 * findings already recorded (#535, CLM-0190). A rejecting gate re-emits the
 * still-unfixed findings on every iteration; without dedup the identical set
 * stacks (113→221→329 on June 13) — pure noise to the coder and a false
 * "regressing" signal to the audited findingCount. Genuinely new findings
 * still accumulate (the accumulated-hints design, see state.ts `findings`). */
function appendDistinctFindings(result: ChildResult, findings: readonly Finding[]): void {
  const seen = new Set(result.findings.map(findingKey));
  for (const finding of findings) {
    const key = findingKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    result.findings.push(finding);
  }
}

/** Fold a non-driving gate's findings into the child as hints (review → next
 * attempt); duplicates of already-recorded findings are dropped (#535, CLM-0190). */
export function foldHints(result: ChildResult, findings: readonly Finding[]): void {
  appendDistinctFindings(result, findings);
}

/**
 * Re-enter the child's implement sub-node: fold the driving gate's findings
 * (deduplicated — #535, CLM-0190), bump the child iteration, reset the
 * sub-cursor to 0 (implement). Mirrors a rejected vote pushing findings and
 * re-entering plan.
 */
export function reiterateChild(
  state: RunState,
  result: ChildResult,
  findings: readonly Finding[],
): void {
  if (state.cursor.phase !== 'fanout') return;
  appendDistinctFindings(result, findings);
  result.iteration += 1;
  state.cursor = { phase: 'fanout', childIndex: state.cursor.childIndex, sub: 0 };
}

/** Mark a child escalated at the bound: record the findings (deduplicated —
 * #535, CLM-0190), never re-attempt. */
export function escalateChild(result: ChildResult, findings: readonly Finding[]): void {
  appendDistinctFindings(result, findings);
  result.escalated = true;
}
