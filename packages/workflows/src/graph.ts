/**
 * The canonical loop as DATA (spec §6): one blessed graph, declared here and
 * never duplicated. Overlays change behavior through engine config (gate
 * swaps, added specialists, K) against this SAME object [CLM-0045]; the
 * graph itself is frozen.
 *
 *   Frame → Research → Plan → VOTE —approved→ Decompose
 *     → FanOut(children: each implement → quality gate) → Integrate
 *     → Retrospect
 *   VOTE —rejected+findings→ Plan   (at most K re-entries, then escalate)
 *
 * EVERY edge declares the contract that crosses it [CLM-0042]; the engine
 * zod-validates each node's emission against its declared contract before
 * the value crosses the edge. Gate nodes always emit a Verdict.
 */
import type { ContractRef } from '@kernloop/contracts';

/** Node kinds in the canonical loop (spec §6). */
export type LoopNodeKind = 'task' | 'gate' | 'decompose' | 'fanout' | 'integrate' | 'retrospect';

/** The gates the loop invokes (review joins in P3 — absent, not stubbed). */
export type LoopGateName = 'vote' | 'quality';

/**
 * One node of the loop. `consumes` is the contract of the node's primary
 * input (`null` for the entry node, whose input is the run's TaskContract);
 * `emits` is the contract the node's output must satisfy — the engine
 * validates it at the outgoing edge. Nodes whose output is a collection
 * (decompose → children, fanout → child verdicts) validate element-wise.
 */
export interface LoopNode {
  readonly name: string;
  readonly kind: LoopNodeKind;
  readonly consumes: ContractRef | null;
  readonly emits: ContractRef;
  /** For gate nodes: which gate executor to call (overlay may swap it). */
  readonly gate?: LoopGateName;
}

/**
 * One edge of the loop. `contract` names which of the frozen five crosses
 * it [CLM-0042]. Gate nodes branch: `when` selects the edge taken for an
 * approving vs. rejecting Verdict.
 */
export interface LoopEdge {
  readonly from: string;
  readonly to: string;
  readonly contract: ContractRef;
  readonly when?: 'approved' | 'rejected';
}

/** The canonical loop: main chain, branch edges, and the fan-out sub-chain. */
export interface LoopGraph {
  /** Name of the entry node. */
  readonly entry: string;
  readonly nodes: readonly LoopNode[];
  readonly edges: readonly LoopEdge[];
  /**
   * The per-child sub-chain run inside the fan-out node, in order. Each
   * decomposed child TaskContract flows through these nodes sequentially.
   */
  readonly childChain: readonly LoopNode[];
}

/** Deep-freeze a graph so the canonical loop is immutable data. */
function freezeGraph(graph: LoopGraph): LoopGraph {
  for (const node of [...graph.nodes, ...graph.childChain]) Object.freeze(node);
  for (const edge of graph.edges) Object.freeze(edge);
  Object.freeze(graph.nodes);
  Object.freeze(graph.edges);
  Object.freeze(graph.childChain);
  return Object.freeze(graph);
}

/**
 * THE canonical loop (spec §6) [CLM-0042]. Edge contracts, honestly:
 *
 * - frame emits the framed TaskContract (refined goal/constraints);
 * - research compiles context into a Brief;
 * - plan emits the plan as a Brief (a reproducible, provenance-tagged
 *   artifact — spec §4);
 * - vote judges the plan Brief and emits a Verdict; the approved edge
 *   carries that Verdict into decompose, the rejected edge carries it back
 *   to plan (the engine feeds its findings to the plan executor and bounds
 *   the cycle at K re-entries [CLM-0043]);
 * - decompose emits child TaskContracts (element-wise validated);
 * - fanout runs each child through implement → quality and emits the
 *   per-child Verdicts (element-wise validated); child failures travel
 *   alongside as structured error records — see the engine's ChildResult;
 * - integrate merges child results into an Outcome;
 * - retrospect closes the run with the final Outcome (memory writes and
 *   Observer feeds are the injected executor's job, not the engine's).
 */
export const CANONICAL_LOOP: LoopGraph = freezeGraph({
  entry: 'frame',
  nodes: [
    { name: 'frame', kind: 'task', consumes: null, emits: 'TaskContract' },
    { name: 'research', kind: 'task', consumes: 'TaskContract', emits: 'Brief' },
    { name: 'plan', kind: 'task', consumes: 'Brief', emits: 'Brief' },
    { name: 'vote', kind: 'gate', consumes: 'Brief', emits: 'Verdict', gate: 'vote' },
    { name: 'decompose', kind: 'decompose', consumes: 'Verdict', emits: 'TaskContract' },
    { name: 'fanout', kind: 'fanout', consumes: 'TaskContract', emits: 'Verdict' },
    { name: 'integrate', kind: 'integrate', consumes: 'Verdict', emits: 'Outcome' },
    { name: 'retrospect', kind: 'retrospect', consumes: 'Outcome', emits: 'Outcome' },
  ],
  edges: [
    { from: 'frame', to: 'research', contract: 'TaskContract' },
    { from: 'research', to: 'plan', contract: 'Brief' },
    { from: 'plan', to: 'vote', contract: 'Brief' },
    { from: 'vote', to: 'decompose', contract: 'Verdict', when: 'approved' },
    { from: 'vote', to: 'plan', contract: 'Verdict', when: 'rejected' },
    { from: 'decompose', to: 'fanout', contract: 'TaskContract' },
    { from: 'fanout', to: 'integrate', contract: 'Verdict' },
    { from: 'integrate', to: 'retrospect', contract: 'Outcome' },
  ],
  childChain: [
    { name: 'implement', kind: 'task', consumes: 'TaskContract', emits: 'Outcome' },
    { name: 'quality', kind: 'gate', consumes: 'Outcome', emits: 'Verdict', gate: 'quality' },
  ],
});

/** Look up a node by name in the main chain or the child sub-chain. */
export function nodeByName(graph: LoopGraph, name: string): LoopNode | undefined {
  return graph.nodes.find((n) => n.name === name) ?? graph.childChain.find((n) => n.name === name);
}

/**
 * The successor of a node along the main chain. For gate nodes pass the
 * branch taken (`approved`/`rejected`); plain nodes have exactly one
 * outgoing edge. Returns undefined for the terminal node.
 */
export function successor(
  graph: LoopGraph,
  from: string,
  branch?: 'approved' | 'rejected',
): LoopEdge | undefined {
  return graph.edges.find((e) => e.from === from && (e.when === undefined || e.when === branch));
}
