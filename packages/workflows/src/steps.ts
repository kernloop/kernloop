/**
 * Step mechanics for the loop engine: what runs next, what it consumes,
 * how the state advances when it completes, and the edge-contract
 * validation that rejects malformed emissions [CLM-0042]. Pure state
 * transitions — no I/O, no executors; the engine owns those.
 */
import { z } from 'zod';
import {
  KNOWN_CONTRACTS,
  TaskContractSchema,
  type Finding,
  type TaskContract,
  type Verdict,
} from '@kernloop/contracts';
import { nodeByName, successor, type LoopGraph, type LoopNode } from './graph.js';
import { WorkflowError, type RunState } from './state.js';
import {
  childBranch,
  escalateChild,
  foldHints,
  gateDrivesIteration,
  reiterateChild,
} from './child-iterate.js';
import { verdictDisposition } from './verdict-disposition.js';

/**
 * Loop-shaping inputs the engine resolves from its config + injected seams and
 * threads into {@link advance}: the vote bound `K`, the child-iterate bound
 * `Kc`, overlay specialists, the review-drives-iteration honesty flag, whether
 * a child re-entry is within budget, and an audit hook fired on each child
 * re-iteration (the engine wires it to the chain; workflows imports no kernel).
 */
export interface AdvanceOptions {
  readonly k: number;
  readonly kc: number;
  readonly specialists: readonly string[];
  readonly reviewDrivesIteration: boolean;
  /** False when a child re-implement would exceed the run budget (Part B). */
  readonly childWithinBudget: boolean;
  /** Fired when a child re-enters implement: {childId, iteration, gate, findingCount}. */
  readonly onIterate?: (event: {
    childId: string;
    iteration: number;
    gate: string;
    findingCount: number;
  }) => void;
}

/** The next unit of work the cursor points at. */
export interface Step {
  readonly node: LoopNode;
  readonly input: unknown;
  /** Set inside the fan-out sub-chain. */
  readonly child?: TaskContract;
  /**
   * The CHILD's accumulated gate findings, inside the fan-out sub-chain — what
   * the re-running coder must fix [CLM-0043]. Distinct from the run-level
   * findings (vote re-entries); the engine hands these to the child's
   * NodeContext so implement reads its own critique, not the run's.
   */
  readonly childFindings?: readonly Finding[];
}

/** Build the initial state for a fresh run. */
export function initialState(task: TaskContract, entry: string): RunState {
  return {
    task,
    status: 'running',
    cursor: { phase: 'main', node: entry },
    iteration: 0,
    values: {},
    findings: [],
    children: [],
    childResults: [],
    trace: [],
    observedMaxNodeSpend: { tokens: 0, usd: 0 },
  };
}

/**
 * Resolve the cursor to the node about to run and its input. Inputs follow
 * the graph's edges: a main-chain node consumes the value its predecessor
 * emitted (for plan re-entries that is still research's Brief — the
 * rejecting Verdict's findings travel via NodeContext.findings); the child
 * sub-chain consumes the child contract, then the implement output.
 */
export function nextStep(graph: LoopGraph, state: RunState): Step {
  const cursor = state.cursor;
  if (cursor.phase === 'done') {
    throw new WorkflowError('executor_failed', 'internal: stepping a finished run');
  }
  if (cursor.phase === 'fanout') {
    const child = state.children[cursor.childIndex];
    const node = graph.childChain[cursor.sub];
    if (child === undefined || node === undefined) {
      throw new WorkflowError('corrupt_checkpoint', 'fan-out cursor points outside the run state');
    }
    const result = state.childResults[cursor.childIndex];
    const input = cursor.sub === 0 ? child : result?.output;
    return { node, input, child, childFindings: result?.findings ?? [] };
  }
  const node = nodeByName(graph, cursor.node);
  if (node === undefined) {
    throw new WorkflowError('corrupt_checkpoint', `cursor names unknown node "${cursor.node}"`);
  }
  return { node, input: mainInput(graph, node, state) };
}

/** The primary input of a main-chain node (see {@link nextStep}). */
function mainInput(graph: LoopGraph, node: LoopNode, state: RunState): unknown {
  if (node.name === graph.entry) return state.task;
  if (node.kind === 'integrate') return state.childResults;
  const incoming =
    graph.edges.find((e) => e.to === node.name && e.when === undefined) ??
    graph.edges.find((e) => e.to === node.name);
  return incoming === undefined ? undefined : state.values[incoming.from];
}

/**
 * Validate a node's emission against its declared contract before it
 * crosses the edge [CLM-0042]. Collection emitters (decompose's children)
 * validate element-wise. Throws a typed error naming node + contract.
 */
export function validateEmission(node: LoopNode, output: unknown): unknown {
  const schema = KNOWN_CONTRACTS[node.emits];
  const checked =
    node.kind === 'decompose' ? z.array(schema).safeParse(output) : schema.safeParse(output);
  if (!checked.success) {
    throw new WorkflowError(
      'edge_contract',
      `node "${node.name}" emitted a malformed ${node.emits}: ${z.prettifyError(checked.error)}`,
      { node: node.name, contract: node.emits },
    );
  }
  return checked.data;
}

/**
 * Synthesize the child contract for an overlay-added specialist (spec §6
 * "add a specialist") [CLM-0045]. The entry adds WORK, not budget: its
 * budget is zero so the decomposed children's budget-sum invariant (PM's
 * job, spec §5.4) survives the addition; a composition root that wants a
 * funded specialist makes its decompose executor slice for it.
 */
export function specialistChild(task: TaskContract, specialist: string): TaskContract {
  return TaskContractSchema.parse({
    id: `${task.id}.${specialist}`,
    parent: task.id,
    goal: `specialist ${specialist}: ${task.goal}`,
    constraints: task.constraints,
    budget: { tokens: 0, usd: 0, wallClockMin: 0 },
    evidence: [],
    definitionOfDone: [],
    authorityCeiling: task.authorityCeiling,
    overlay: task.overlay,
  });
}

/** Move the cursor into the fan-out, or past it when there are no children. */
function enterFanout(graph: LoopGraph, state: RunState, from: string): void {
  const next = successor(graph, from);
  if (state.children.length > 0) {
    state.cursor = { phase: 'fanout', childIndex: 0, sub: 0 };
  } else if (next !== undefined) {
    state.cursor = { phase: 'main', node: successor(graph, next.to)?.to ?? next.to };
  }
}

/** Apply a completed VOTE: branch on the Verdict, bounded by K [CLM-0043]. */
function advanceVote(graph: LoopGraph, state: RunState, node: LoopNode, k: number): void {
  const verdict = state.values[node.name] as Verdict;
  const disposition = verdictDisposition(verdict.result);
  if (disposition === 'advance') {
    const edge = successor(graph, node.name, 'approved');
    if (edge !== undefined) state.cursor = { phase: 'main', node: edge.to };
    return;
  }
  state.findings.push(...verdict.findings);
  if (disposition === 'escalate') {
    // The gate ruled "a human must decide" (#192): HALT as escalated IMMEDIATELY,
    // regardless of K — not a re-iterate. A distinct haltReason lets an operator
    // tell a deadlock from K-exhaustion. Cursor parks on the rejected edge so a
    // resume after the human rules continues from plan [CLM-0043].
    const edge = successor(graph, node.name, 'rejected');
    if (edge !== undefined) state.cursor = { phase: 'main', node: edge.to };
    state.status = 'escalated';
    state.haltReason = 'vote-escalation';
    return;
  }
  if (state.iteration >= k) {
    // K re-entries exhausted: HALT as escalated, cursor parked at plan so a
    // resume after the human edits continues from there [CLM-0043].
    const edge = successor(graph, node.name, 'rejected');
    if (edge !== undefined) state.cursor = { phase: 'main', node: edge.to };
    state.status = 'escalated';
    state.haltReason = 'vote';
    return;
  }
  state.iteration += 1;
  const edge = successor(graph, node.name, 'rejected');
  if (edge !== undefined) state.cursor = { phase: 'main', node: edge.to };
}

/**
 * Advance the fan-out cursor after one child sub-node completed — branch-aware,
 * MIRRORING {@link advanceVote}. A driving gate (quality always; review only
 * when promoted to enforce, the honesty guard) that rejects re-runs implement
 * within Kc and budget [CLM-0043], or escalates the child at the bound; a
 * passing gate (and any non-driving gate, whose findings fold in as hints)
 * advances the sub-chain, then to the next child.
 */
function advanceChild(
  graph: LoopGraph,
  state: RunState,
  output: unknown,
  opts: AdvanceOptions,
): void {
  if (state.cursor.phase !== 'fanout') return;
  const { childIndex, sub } = state.cursor;
  const result = state.childResults[childIndex];
  if (result === undefined) return;
  // Route the sub-node's output to the right slot by its role, not its index,
  // so the chain can grow (quality → review) without positional assumptions.
  const subNode = graph.childChain[sub];
  if (subNode?.gate === 'review') {
    result.reviewVerdict = output as Verdict;
  } else if (subNode?.kind === 'gate') {
    result.verdict = output as Verdict;
  } else {
    result.output = output;
  }
  if (
    subNode?.kind === 'gate' &&
    advanceChildGate(graph, state, subNode, output as Verdict, opts)
  ) {
    return; // the gate branched (re-iterate or escalate); cursor already moved.
  }
  if (sub + 1 < graph.childChain.length) {
    state.cursor = { phase: 'fanout', childIndex, sub: sub + 1 };
  } else {
    advanceToNextChild(graph, state, childIndex);
  }
}

/**
 * Apply a completed child gate: drive the iteration back-edge (quality, or
 * review at enforce), or fold a non-driving gate's findings as hints. Returns
 * true when the cursor branched (re-iterate or escalate at the bound) so the
 * caller does not also advance the sub-chain — exactly as advanceVote owns the
 * cursor on the rejected edge.
 */
function advanceChildGate(
  graph: LoopGraph,
  state: RunState,
  gateNode: LoopNode,
  verdict: Verdict,
  opts: AdvanceOptions,
): boolean {
  if (state.cursor.phase !== 'fanout') return false;
  const result = state.childResults[state.cursor.childIndex];
  if (result === undefined) return false;
  if (!gateDrivesIteration(gateNode, opts.reviewDrivesIteration)) {
    foldHints(result, verdict.findings);
    return false;
  }
  const branch = childBranch(verdict, result, opts.kc, opts.childWithinBudget);
  if (branch === 'pass') return false;
  if (branch === 'escalate') {
    escalateChild(result, verdict.findings);
    advanceToNextChild(graph, state, state.cursor.childIndex);
    return true;
  }
  reiterateChild(state, result, verdict.findings);
  opts.onIterate?.({
    childId: result.child.id,
    iteration: result.iteration,
    gate: gateNode.gate ?? gateNode.name,
    findingCount: result.findings.length,
  });
  return true;
}

/** Step to the next fan-out child, or back to the main chain after the last. */
export function advanceToNextChild(graph: LoopGraph, state: RunState, childIndex: number): void {
  if (childIndex + 1 < state.children.length) {
    state.cursor = { phase: 'fanout', childIndex: childIndex + 1, sub: 0 };
  } else {
    const fanout = graph.nodes.find((n) => n.kind === 'fanout');
    const edge = fanout === undefined ? undefined : successor(graph, fanout.name);
    // Integrate's input is the honest per-child aggregate (childResults):
    // verdicts element-wise validated at the quality edge, failures carried
    // alongside as error records — see mainInput's integrate special case.
    state.cursor = edge === undefined ? { phase: 'done' } : { phase: 'main', node: edge.to };
  }
}

/**
 * Apply one validated emission to the state and move the cursor. Mutates
 * `state` (the engine snapshots per checkpoint). {@link AdvanceOptions} carries
 * the vote bound K, the child-iterate bound Kc, overlay specialists, the
 * review-drives-iteration honesty flag, the budget verdict, and the audit hook.
 */
export function advance(
  graph: LoopGraph,
  state: RunState,
  node: LoopNode,
  output: unknown,
  opts: AdvanceOptions,
): void {
  if (state.cursor.phase === 'fanout') {
    advanceChild(graph, state, output, opts);
    return;
  }
  state.values[node.name] = output;
  if (node.kind === 'gate') {
    advanceVote(graph, state, node, opts.k);
    return;
  }
  if (node.kind === 'decompose') {
    const children = output as TaskContract[];
    state.children = [...children, ...opts.specialists.map((s) => specialistChild(state.task, s))];
    state.childResults = state.children.map((child) => ({ child, iteration: 0, findings: [] }));
    enterFanout(graph, state, node.name);
    return;
  }
  if (node.kind === 'retrospect') {
    state.cursor = { phase: 'done' };
    state.status = 'completed';
    return;
  }
  const edge = successor(graph, node.name);
  state.cursor = edge === undefined ? { phase: 'done' } : { phase: 'main', node: edge.to };
}
