/**
 * Adapter effort-emission injection-safety (#380, from the #379 codex finding).
 *
 * An arg-delivered effort knob emits `[param, value]` into the child argv
 * (definitions.ts `effortArgs`). codex's value is a `-c key=value` config
 * override — so the VALUE must be provably bounded: a fixed literal drawn from
 * the adapter's `levels` enum (itself keyed by the closed `Effort` enum), NEVER
 * anything derived from caller/model/prompt input. Otherwise `-c key=value`
 * could become an arbitrary-config or shell-injection sink. This is the static
 * assertion the #380 issue asked to pin; the live `adapters:smoke` harness is
 * the runtime companion.
 */
import { describe, expect, it } from 'vitest';
import { ADAPTER_NAMES, adapterDefinitions, resolveEffort } from '@kernloop/kernel';

const EFFORTS = ['low', 'medium', 'high', 'xhigh'];

/**
 * A safe effort literal: a bare level word (`high`, `max`) OR a single
 * `key=value` config pair, each side a conservative identifier. Disallows
 * whitespace, quotes, shell/path metacharacters, and any SECOND `=` or flag
 * token that could smuggle an extra config override past the intended one.
 */
const SAFE_LITERAL = /^[A-Za-z][A-Za-z0-9_]*(=[A-Za-z][A-Za-z0-9_]*)?$/;

describe('adapter effort emission is injection-safe (#380, from #379)', () => {
  for (const name of ADAPTER_NAMES) {
    const profile = adapterDefinitions[name].effort;

    if (profile === undefined) {
      it(`${name}: declares no effort profile → effort dropped honestly, nothing emitted`, () => {
        expect(adapterDefinitions[name].effort).toBeUndefined();
      });
      continue;
    }

    it(`${name}: every levels value is a fixed, injection-safe literal`, () => {
      const values = Object.values(profile.levels);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(typeof value).toBe('string');
        expect(value).toMatch(SAFE_LITERAL);
      }
    });

    it(`${name}: resolveEffort only ever emits a value FROM the levels enum (no input passthrough)`, () => {
      const allowed = new Set(Object.values(profile.levels));
      for (const effort of EFFORTS) {
        const { value } = resolveEffort(effort, profile);
        // The resolved value is either undefined (honestly unsupported) or a
        // member of the closed levels enum — never a synthesized/passthrough string.
        if (value !== undefined) expect(allowed.has(value)).toBe(true);
      }
    });
  }

  it('an out-of-enum effort string cannot smuggle a value past resolveEffort', () => {
    const codex = adapterDefinitions.codex.effort;
    const allowed = new Set(Object.values(codex.levels));
    // Even a hostile "effort" never appears verbatim in the emitted value — the
    // map lookup misses and resolveEffort falls back to a bounded enum member.
    const { value } = resolveEffort('--config=evil=1', codex);
    expect(value === undefined || allowed.has(value)).toBe(true);
    expect(value).not.toContain('evil');
  });
});
