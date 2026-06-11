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
  type TaskContract,
  type Verdict,
} from '@kernloop/contracts';
import { nodeByName, successor, type LoopGraph, type LoopNode } from './graph.js';
import { WorkflowError, type RunState } from './state.js';

/** The next unit of work the cursor points at. */
export interface Step {
  readonly node: LoopNode;
  readonly input: unknown;
  /** Set inside the fan-out sub-chain. */
  readonly child?: TaskContract;
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
    const input = cursor.sub === 0 ? child : state.childResults[cursor.childIndex]?.output;
    return { node, input, child };
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
  if (verdict.result === 'approve') {
    const edge = successor(graph, node.name, 'approved');
    if (edge !== undefined) state.cursor = { phase: 'main', node: edge.to };
    return;
  }
  state.findings.push(...verdict.findings);
  if (state.iteration >= k) {
    // K re-entries exhausted: HALT as escalated, cursor parked at plan so a
    // resume after the human edits continues from there [CLM-0043].
    const edge = successor(graph, node.name, 'rejected');
    if (edge !== undefined) state.cursor = { phase: 'main', node: edge.to };
    state.status = 'escalated';
    return;
  }
  state.iteration += 1;
  const edge = successor(graph, node.name, 'rejected');
  if (edge !== undefined) state.cursor = { phase: 'main', node: edge.to };
}

/** Advance the fan-out cursor after one child sub-node completed. */
function advanceChild(graph: LoopGraph, state: RunState, output: unknown): void {
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
  if (sub + 1 < graph.childChain.length) {
    state.cursor = { phase: 'fanout', childIndex, sub: sub + 1 };
  } else {
    advanceToNextChild(graph, state, childIndex);
  }
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
 * `state` (the engine snapshots per checkpoint). `specialists` are the
 * overlay-added fan-out entries resolved by the engine from its config.
 */
export function advance(
  graph: LoopGraph,
  state: RunState,
  node: LoopNode,
  output: unknown,
  k: number,
  specialists: readonly string[],
): void {
  if (state.cursor.phase === 'fanout') {
    advanceChild(graph, state, output);
    return;
  }
  state.values[node.name] = output;
  if (node.kind === 'gate') {
    advanceVote(graph, state, node, k);
    return;
  }
  if (node.kind === 'decompose') {
    const children = output as TaskContract[];
    state.children = [...children, ...specialists.map((s) => specialistChild(state.task, s))];
    state.childResults = state.children.map((child) => ({ child }));
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
