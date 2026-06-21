/**
 * Control Floor evaluator [#410, CLM-0170] — proves the floor is multi-catalog,
 * `applies_when` gates each entry to a relevant trust-boundary, an applicable
 * unsatisfied entry is `deferred` (fail-closed, never silently dropped) and forces
 * the control-risk surface, and the policy data is overlay-loadable.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTROL_FLOOR,
  evaluateFloor,
  floorControlRisk,
  floorHasDeferral,
  type FloorContext,
  type FloorEntry,
} from './floor.js';

/** A context with NOTHING applicable (every floor entry → na) unless overridden. */
function ctx(over: Partial<FloorContext> = {}): FloorContext {
  return {
    crossesTrustBoundary: false,
    risksDataLoss: false,
    enforcesAccess: false,
    hasUserInterface: false,
    acts: false,
    wasRequested: false,
    ...over,
  };
}

function byName(checks: ReturnType<typeof evaluateFloor>, name: string) {
  return checks.find((c) => c.name === name);
}

describe('Control Floor (#410, CLM-0170)', () => {
  it('is MULTI-CATALOG — NIST 800-53r5, Section 508, and intent all present', () => {
    const catalogs = new Set(CONTROL_FLOOR.map((e) => e.catalog));
    expect(catalogs.has('nist-800-53r5')).toBe(true);
    expect(catalogs.has('section-508')).toBe(true);
    expect(catalogs.has('intent')).toBe(true);
  });

  it('the non-NIST entries (accessibility, intent) carry NO control id', () => {
    expect(CONTROL_FLOOR.find((e) => e.name === 'accessibility')?.controlIds).toEqual([]);
    expect(CONTROL_FLOOR.find((e) => e.name === 'intent')?.controlIds).toEqual([]);
  });

  it('applies_when gates each entry — an irrelevant diff makes every entry `na`', () => {
    const checks = evaluateFloor(ctx(), {});
    expect(checks.every((c) => c.status === 'na')).toBe(true);
  });

  it('an applicable + SATISFIED entry is `pass` (with its evidence ref)', () => {
    const checks = evaluateFloor(
      ctx({ crossesTrustBoundary: true }),
      { input_validation: true },
      { input_validation: 'test://si10' },
    );
    const c = byName(checks, 'input_validation');
    expect(c?.status).toBe('pass');
    expect(c?.evidenceRef).toBe('test://si10');
    expect(c?.controlIds).toEqual(['SI-10']);
  });

  it('an applicable + UNSATISFIED entry is `deferred` — fail-closed on a missing entry', () => {
    // enforcesAccess applies AC-3 but `satisfied` omits it → deferred, not pass.
    const checks = evaluateFloor(ctx({ enforcesAccess: true }), {});
    expect(byName(checks, 'access_enforcement')?.status).toBe('deferred');
  });

  it('floorControlRisk aggregates the DISTINCT control ids of deferred checks', () => {
    const checks = evaluateFloor(ctx({ crossesTrustBoundary: true, enforcesAccess: true }), {
      input_validation: false,
    });
    expect(floorControlRisk(checks).sort()).toEqual(['AC-3', 'IA-2', 'SC-8', 'SI-10']);
    expect(floorHasDeferral(checks)).toBe(true);
  });

  it('a 508 accessibility miss defers WITHOUT a control id — empty risk ≠ no deferral', () => {
    const checks = evaluateFloor(ctx({ hasUserInterface: true }), {});
    expect(byName(checks, 'accessibility')?.status).toBe('deferred');
    expect(floorControlRisk(checks)).toEqual([]); // 508 has no 800-53 control id...
    expect(floorHasDeferral(checks)).toBe(true); // ...but a deferral DID happen
  });

  it('floorHasDeferral is false when every applicable entry passed', () => {
    const checks = evaluateFloor(ctx({ acts: true }), { audit_logging: true });
    expect(floorHasDeferral(checks)).toBe(false);
  });

  it('accepts an overlay-supplied floor (policy data, not code)', () => {
    const custom: FloorEntry[] = [
      { name: 'custom', catalog: 'wcag', controlIds: [], appliesWhen: 'hasUserInterface' },
    ];
    const checks = evaluateFloor(ctx({ hasUserInterface: true }), {}, {}, custom);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe('deferred');
  });
});
