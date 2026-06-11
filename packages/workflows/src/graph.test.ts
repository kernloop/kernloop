import { describe, expect, it } from 'vitest';
import { CONTRACT_NAMES } from '@kernloop/contracts';
import { CANONICAL_LOOP, nodeByName, successor } from './graph.js';

describe('CANONICAL_LOOP as data (spec §6) [CLM-0042]', () => {
  it('the canonical loop is frozen data — mutation throws', () => {
    expect(Object.isFrozen(CANONICAL_LOOP)).toBe(true);
    expect(Object.isFrozen(CANONICAL_LOOP.nodes)).toBe(true);
    expect(Object.isFrozen(CANONICAL_LOOP.edges)).toBe(true);
    expect(Object.isFrozen(CANONICAL_LOOP.childChain)).toBe(true);
    expect(() => {
      (CANONICAL_LOOP.nodes as unknown as unknown[]).push({});
    }).toThrow();
    expect(() => {
      (CANONICAL_LOOP.nodes[0] as { name: string }).name = 'hijacked';
    }).toThrow();
  });

  it('every edge declares one of the frozen five as its crossing contract', () => {
    expect(CANONICAL_LOOP.edges.length).toBeGreaterThan(0);
    for (const edge of CANONICAL_LOOP.edges) {
      expect(CONTRACT_NAMES).toContain(edge.contract);
      expect(nodeByName(CANONICAL_LOOP, edge.from)).toBeDefined();
      expect(nodeByName(CANONICAL_LOOP, edge.to)).toBeDefined();
    }
  });

  it('every node emits one of the frozen five; only the entry consumes null', () => {
    for (const node of [...CANONICAL_LOOP.nodes, ...CANONICAL_LOOP.childChain]) {
      expect(CONTRACT_NAMES).toContain(node.emits);
      if (node.consumes === null) {
        expect(node.name).toBe(CANONICAL_LOOP.entry);
      } else {
        expect(CONTRACT_NAMES).toContain(node.consumes);
      }
    }
  });

  it('gate nodes declare their gate and emit a Verdict', () => {
    const gates = [...CANONICAL_LOOP.nodes, ...CANONICAL_LOOP.childChain].filter(
      (n) => n.kind === 'gate',
    );
    expect(gates.map((g) => g.name).sort()).toEqual(['quality', 'review', 'vote']);
    for (const gate of gates) {
      expect(gate.gate).toBeDefined();
      expect(gate.emits).toBe('Verdict');
    }
  });

  it('declares the spec §6 shape: the chain, the vote branch, and the child sub-chain', () => {
    expect(CANONICAL_LOOP.entry).toBe('frame');
    expect(CANONICAL_LOOP.nodes.map((n) => n.name)).toEqual([
      'frame',
      'research',
      'plan',
      'vote',
      'decompose',
      'fanout',
      'integrate',
      'retrospect',
    ]);
    // The vote branches: approved → decompose, rejected (+findings) → plan.
    expect(successor(CANONICAL_LOOP, 'vote', 'approved')?.to).toBe('decompose');
    expect(successor(CANONICAL_LOOP, 'vote', 'rejected')?.to).toBe('plan');
    expect(successor(CANONICAL_LOOP, 'vote', 'rejected')?.contract).toBe('Verdict');
    // Each fan-out child runs implement → quality gate → review gate.
    expect(CANONICAL_LOOP.childChain.map((n) => n.name)).toEqual([
      'implement',
      'quality',
      'review',
    ]);
    // Terminal node has no successor.
    expect(successor(CANONICAL_LOOP, 'retrospect')).toBeUndefined();
  });

  it('nodeByName resolves main-chain and child-chain nodes, undefined otherwise', () => {
    expect(nodeByName(CANONICAL_LOOP, 'plan')?.kind).toBe('task');
    expect(nodeByName(CANONICAL_LOOP, 'implement')?.kind).toBe('task');
    expect(nodeByName(CANONICAL_LOOP, 'nope')).toBeUndefined();
  });
});
