/**
 * The Control Floor [#410, EPIC #407] — the non-waivable guards a parsimony
 * decision may NOT skip. Where ponytail's floor is prose, kernloop's is TYPED by
 * CATALOG, because the members are heterogeneous: some are NIST 800-53r5 controls,
 * one is Section 508 (accessibility — NOT an 800-53 control), one is policy intent
 * (no catalog). The mapping is overlay-loadable POLICY DATA; each entry's
 * `appliesWhen` names a {@link FloorContext} key (not a closure) so the floor fires
 * ONLY on a relevant trust-boundary diff, never on every change.
 *
 * Evaluation is pure: an entry that does not apply is `na`; one that applies and is
 * satisfied is `pass`; one that applies and is NOT satisfied is `deferred` — which
 * the loop must turn into a first-class {@link Deferred} finding carrying the
 * control(s) at risk. A `deferred` floor check can never be silently dropped.
 *
 * @module parsimony/floor
 */
import type { FloorCatalog, FloorCheck } from './receipt.js';

/**
 * The trust-boundary surface of the change under evaluation — the predicates the
 * floor's `appliesWhen` keys read. Every flag is supplied by the caller (the loop's
 * diff analysis); the floor makes no judgment about whether a flag is true, only
 * about what each true flag REQUIRES. This is the highest-judgment input in the
 * system (plan §6) — too broad fires on noise, too narrow misses a boundary.
 */
export interface FloorContext {
  /** Input crosses a trust boundary (untrusted data enters) → input validation. */
  readonly crossesTrustBoundary: boolean;
  /** A failure could lose or corrupt data → error handling / recovery. */
  readonly risksDataLoss: boolean;
  /** Access is granted/checked at a boundary → access enforcement. */
  readonly enforcesAccess: boolean;
  /** The change surfaces a user interface → accessibility. */
  readonly hasUserInterface: boolean;
  /** The change performs an action with a side effect → audit logging. */
  readonly acts: boolean;
  /** The behavior was explicitly requested → intent guard. */
  readonly wasRequested: boolean;
}

/** One Control Floor entry as DATA: applies when `FloorContext[appliesWhen]` is
 * true, and (when it applies and is unsatisfied) puts `controlIds` at risk. */
export interface FloorEntry {
  readonly name: string;
  readonly catalog: FloorCatalog;
  readonly controlIds: readonly string[];
  readonly appliesWhen: keyof FloorContext;
}

/**
 * The canonical Control Floor (plan §2.2). MULTI-CATALOG by construction:
 * `accessibility` is Section 508 (no 800-53 control id) and `intent` is policy
 * (no control id), so a consumer — notably the OSCAL projection (#8) — must NOT
 * assume every entry maps to a NIST control.
 */
export const CONTROL_FLOOR: readonly FloorEntry[] = [
  {
    name: 'input_validation',
    catalog: 'nist-800-53r5',
    controlIds: ['SI-10'],
    appliesWhen: 'crossesTrustBoundary',
  },
  {
    name: 'error_recovery',
    catalog: 'nist-800-53r5',
    controlIds: ['SI-11', 'CP-10'],
    appliesWhen: 'risksDataLoss',
  },
  {
    name: 'access_enforcement',
    catalog: 'nist-800-53r5',
    controlIds: ['AC-3', 'IA-2', 'SC-8'],
    appliesWhen: 'enforcesAccess',
  },
  {
    name: 'accessibility',
    catalog: 'section-508',
    controlIds: [],
    appliesWhen: 'hasUserInterface',
  },
  {
    name: 'audit_logging',
    catalog: 'nist-800-53r5',
    controlIds: ['AU-2', 'AU-3', 'AU-10'],
    appliesWhen: 'acts',
  },
  { name: 'intent', catalog: 'intent', controlIds: [], appliesWhen: 'wasRequested' },
];

/**
 * Evaluate the floor against the change `context` and the per-entry `satisfied`
 * map, returning one {@link FloorCheck} per entry: `na` when the entry does not
 * apply, `pass` when it applies and `satisfied[name]` is true, `deferred` when it
 * applies and is NOT satisfied (a missing entry in `satisfied` defaults to NOT
 * satisfied — fail-closed: the floor never assumes an un-evidenced guard held).
 * Pure and deterministic; `evidenceRef[name]` rides onto a `pass`.
 */
export function evaluateFloor(
  context: FloorContext,
  satisfied: Readonly<Record<string, boolean>>,
  evidenceRef: Readonly<Record<string, string>> = {},
  floor: readonly FloorEntry[] = CONTROL_FLOOR,
): FloorCheck[] {
  return floor.map((entry) => {
    const base = { name: entry.name, catalog: entry.catalog, controlIds: [...entry.controlIds] };
    if (!context[entry.appliesWhen]) return { ...base, status: 'na' };
    if (satisfied[entry.name] === true) {
      const ref = evidenceRef[entry.name];
      return ref === undefined
        ? { ...base, status: 'pass' }
        : { ...base, status: 'pass', evidenceRef: ref };
    }
    return { ...base, status: 'deferred' };
  });
}

/**
 * The distinct control IDs put at risk by the `deferred` checks — the
 * `controlRisk` of the forced {@link Deferred} block. Empty when nothing deferred
 * (and the loop then records `deferred: null`). Non-NIST deferred entries (e.g. a
 * 508 accessibility miss) contribute no control id, so an empty result does NOT
 * imply nothing was deferred — use {@link floorHasDeferral} for that.
 */
export function floorControlRisk(checks: readonly FloorCheck[]): string[] {
  const risk = new Set<string>();
  for (const c of checks) {
    if (c.status === 'deferred') for (const id of c.controlIds) risk.add(id);
  }
  return [...risk];
}

/** True when any applicable floor entry was unsatisfied — the loop MUST then emit
 * a {@link Deferred} block (the receipt's deferred invariant), never drop it. */
export function floorHasDeferral(checks: readonly FloorCheck[]): boolean {
  return checks.some((c) => c.status === 'deferred');
}
