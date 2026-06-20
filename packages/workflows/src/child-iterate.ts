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

/**
 * Whether THIS gate sub-node drives child iteration. Quality always drives.
 * Review drives only when `reviewDrivesIteration` is on (the review gate is at
 * enforce) — the honesty guard. Non-driving gates never trigger a re-implement;
 * their findings still fold in as hints (see {@link foldHints}).
 */
export function gateDrivesIteration(node: LoopNode, reviewDrives: boolean): boolean {
  if (node.gate === 'quality') return true;
  if (node.gate === 'review') return reviewDrives;
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

/** Fold a non-driving gate's findings into the child as hints (review → next attempt). */
export function foldHints(result: ChildResult, findings: readonly Finding[]): void {
  result.findings.push(...findings);
}

/**
 * Re-enter the child's implement sub-node: fold the driving gate's findings,
 * bump the child iteration, reset the sub-cursor to 0 (implement). Mirrors a
 * rejected vote pushing findings and re-entering plan.
 */
export function reiterateChild(
  state: RunState,
  result: ChildResult,
  findings: readonly Finding[],
): void {
  if (state.cursor.phase !== 'fanout') return;
  result.findings.push(...findings);
  result.iteration += 1;
  state.cursor = { phase: 'fanout', childIndex: state.cursor.childIndex, sub: 0 };
}

/** Mark a child escalated at the bound: record the findings, never re-attempt. */
export function escalateChild(result: ChildResult, findings: readonly Finding[]): void {
  result.findings.push(...findings);
  result.escalated = true;
}
