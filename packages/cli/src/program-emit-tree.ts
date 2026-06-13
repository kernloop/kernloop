/**
 * The TREE-LINKING helpers for `program emit` (spec §5.4; #84). The ledger
 * stores a program as a tree (each node's `parentId`, null for the root
 * umbrella). To turn that into a real GitHub epic with linked sub-issues WITHOUT
 * a new GraphQL surface, emit files PARENTS-FIRST and body-ref-links:
 *
 *  1. Order the planned nodes so every parent is filed before its children
 *     ({@link orderParentsFirst}).
 *  2. File a parent, capture its issue NUMBER, and inject a `Parent: #N` line
 *     into each child's body before filing it ({@link withParentRef}).
 *  3. Once a parent's children are filed, REPLACE the parent's body with one
 *     carrying a `- [ ] #child` task-list ({@link epicBodyWithTaskList}) via the
 *     `editBody` tracker op — GitHub renders that list as tracked sub-issues.
 *
 * Everything here is pure string/graph work over the stored rows; the gh calls
 * live in program-emit-ledger.ts. A filed ref whose issue NUMBER cannot be
 * resolved ({@link issueNumberFromRef} → null) degrades: that edge is skipped
 * and reported, never faked and never a thrown error.
 */
import type { ProgramNodeRow } from './program-store.js';

/** A `github.com` issue URL or a bare `#N`/`N` ref → its trailing issue number. */
const ISSUE_NUMBER = /(?:^#?|\/)(\d+)$/;

/**
 * Extract the bare issue NUMBER from a filed ref (the URL gh printed, or a
 * `#N`/`N` ref), or `null` when the ref carries no resolvable number — in which
 * case the caller skips that link rather than fabricating one.
 */
export function issueNumberFromRef(ref: string | null | undefined): string | null {
  if (ref === null || ref === undefined) return null;
  const m = ISSUE_NUMBER.exec(ref.trim());
  return m ? m[1]! : null;
}

/**
 * Order nodes PARENTS-FIRST [CLM-0106]: a node appears only after its in-set
 * parent. Nodes whose parent is null or not in the set (e.g. an already-emitted
 * ancestor) are roots of the ordering. Deterministic (stable by the input order,
 * which is `nodeId` ASC from the ledger). A cycle is impossible for a real tree,
 * but any nodes left unplaced are appended so none are silently dropped.
 */
export function orderParentsFirst(nodes: readonly ProgramNodeRow[]): ProgramNodeRow[] {
  const inSet = new Set(nodes.map((n) => n.nodeId));
  const placed = new Set<string>();
  const out: ProgramNodeRow[] = [];
  let progress = true;
  while (out.length < nodes.length && progress) {
    progress = false;
    for (const node of nodes) {
      if (placed.has(node.nodeId)) continue;
      const parentReady =
        node.parentId === null || !inSet.has(node.parentId) || placed.has(node.parentId);
      if (parentReady) {
        out.push(node);
        placed.add(node.nodeId);
        progress = true;
      }
    }
  }
  for (const node of nodes) if (!placed.has(node.nodeId)) out.push(node);
  return out;
}

/** Prepend a `Parent: #N` reference line to a child issue body (the back-link). */
export function withParentRef(body: string, parentNumber: string): string {
  return `Parent: #${parentNumber}\n\n${body}`;
}

/** The heading under which a parent issue lists its tracked sub-issues. */
const SUBISSUE_HEADING = '## Sub-issues';

/**
 * Build a parent epic's replacement body [CLM-0106]: its original body plus a
 * `- [ ] #N` task-list of its filed children, which GitHub renders as tracked
 * sub-issues. Returns `null` when there are no child numbers to list (nothing
 * to edit).
 */
export function epicBodyWithTaskList(
  originalBody: string,
  childNumbers: readonly string[],
): string | null {
  if (childNumbers.length === 0) return null;
  const list = childNumbers.map((n) => `- [ ] #${n}`).join('\n');
  return `${originalBody}\n\n${SUBISSUE_HEADING}\n${list}`;
}
