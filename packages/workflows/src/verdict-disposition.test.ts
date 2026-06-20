/**
 * The verdict routing classifier (#192). Pins each VerdictResult to its loop
 * disposition and documents the `escalate` → human-decision route. The
 * `never`-exhaustiveness guard is a COMPILE-time property (a new enum value
 * breaks `pnpm typecheck` at verdict-disposition.ts), so it is asserted by the
 * build, not here; this file pins the runtime mapping.
 */
import { describe, expect, it } from 'vitest';
import type { VerdictResult } from '@kernloop/contracts';
import { verdictDisposition } from './verdict-disposition.js';

describe('verdictDisposition (#192)', () => {
  it('maps every VerdictResult to its routing disposition', () => {
    const cases: Record<VerdictResult, 'advance' | 'escalate' | 'block'> = {
      approve: 'advance',
      pass: 'advance',
      escalate: 'escalate',
      reject: 'block',
      fail: 'block',
      abstain: 'block',
    };
    for (const [result, disposition] of Object.entries(cases)) {
      expect(verdictDisposition(result as VerdictResult)).toBe(disposition);
    }
  });

  it('classifies escalate distinctly from both clear and block', () => {
    expect(verdictDisposition('escalate')).toBe('escalate');
    expect(verdictDisposition('escalate')).not.toBe('advance');
    expect(verdictDisposition('escalate')).not.toBe('block');
  });
});
