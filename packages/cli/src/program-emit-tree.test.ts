/**
 * Unit tests for the pure tree-linking helpers behind `program emit` (#84):
 * parents-first ordering, issue-number extraction, and the `Parent: #N` /
 * `- [ ] #N` body strings GitHub renders as a tracked sub-issue relationship.
 */
import { describe, expect, it } from 'vitest';
import {
  epicBodyWithTaskList,
  issueNumberFromRef,
  orderParentsFirst,
  withParentRef,
} from './program-emit-tree.js';
import type { ProgramNodeRow } from './program-store.js';

/** A minimal node row (only the fields the tree helpers read). */
function node(nodeId: string, parentId: string | null): ProgramNodeRow {
  return {
    programId: 'p',
    nodeId,
    parentId,
    goal: nodeId,
    labels: [],
    taskJson: '{}',
    state: 'planned',
    issueRef: null,
    updatedAt: 0,
  };
}

describe('issueNumberFromRef', () => {
  it('extracts the trailing number from a github issue URL', () => {
    expect(issueNumberFromRef('https://github.com/o/r/issues/123')).toBe('123');
  });
  it('accepts a bare number and a #N ref', () => {
    expect(issueNumberFromRef('42')).toBe('42');
    expect(issueNumberFromRef('#7')).toBe('7');
  });
  it('returns null for an unresolvable / empty / nullish ref', () => {
    expect(issueNumberFromRef('dry-run://no-mutation')).toBeNull();
    expect(issueNumberFromRef('')).toBeNull();
    expect(issueNumberFromRef(null)).toBeNull();
    expect(issueNumberFromRef(undefined)).toBeNull();
  });
});

describe('orderParentsFirst', () => {
  it('places a parent before its children', () => {
    const ordered = orderParentsFirst([node('p.1', 'p'), node('p.2', 'p'), node('p', null)]);
    expect(ordered.map((n) => n.nodeId)).toEqual(['p', 'p.1', 'p.2']);
  });

  it('handles a deeper chain (grandparent → parent → child)', () => {
    const ordered = orderParentsFirst([node('c', 'b'), node('b', 'a'), node('a', null)]);
    expect(ordered.map((n) => n.nodeId)).toEqual(['a', 'b', 'c']);
  });

  it('treats a node whose parent is NOT in the set as a root (already-emitted ancestor)', () => {
    const ordered = orderParentsFirst([node('p.1', 'p')]);
    expect(ordered.map((n) => n.nodeId)).toEqual(['p.1']);
  });

  it('never drops a node even under an impossible cycle', () => {
    const ordered = orderParentsFirst([node('x', 'y'), node('y', 'x')]);
    expect(ordered.map((n) => n.nodeId).sort()).toEqual(['x', 'y']);
  });
});

describe('withParentRef', () => {
  it('prepends a Parent: #N back-link line to the body', () => {
    expect(withParentRef('Body here.', '12')).toBe('Parent: #12\n\nBody here.');
  });
});

describe('epicBodyWithTaskList', () => {
  it('appends a Sub-issues task-list of child numbers', () => {
    expect(epicBodyWithTaskList('Epic body.', ['8', '9'])).toBe(
      'Epic body.\n\n## Sub-issues\n- [ ] #8\n- [ ] #9',
    );
  });
  it('returns null when there are no children to list', () => {
    expect(epicBodyWithTaskList('Epic body.', [])).toBeNull();
  });
});
