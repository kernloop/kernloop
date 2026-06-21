/**
 * The parsimony ASSESSOR seam [#426, EPIC #407] — chunk + union over the child's diff.
 * Asserts the security-critical chunking contract: a diff that fits one per-chunk
 * budget is ONE call, byte-identical to the prior single-call behavior; a diff that
 * exceeds the budget is split into consecutive chunks (each its own per-call nonce
 * fence), assessed once per chunk, and UNIONed — floorContext OR'd (a trust boundary
 * buried in a LATER chunk still surfaces — the buried-boundary evasion the fix exists
 * for), satisfied FAIL-CLOSED AND'd (satisfied in chunk 1 but unsatisfied in chunk 2 ⇒
 * not satisfied), ladder signals + rung from the FIRST chunk, per-chunk costs SUMMED.
 * A malformed chunk emission still throws the typed error (#289 hardening per chunk),
 * never a fabricated assessment. Scripted invoke returning canned JSON per call.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assessParsimony,
  chunkDiff,
  unionAssessments,
  DIFF_ASSESS_MAX_CHARS,
  MAX_ASSESS_CHUNKS,
  type AssessSeam,
  type ParsimonyAssessment,
} from './parsimony-assess.js';
import { LoopParseError, type LoopInvoke } from './invoke.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-parsimony-assess-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const COST = { tokens: 7, usd: 0.01, wallClockMs: 1 };

/** A scripted invoke that returns a canned emission per call, in order, and records
 * the prompts it was called with (so we can assert one-call-per-chunk + nonce fences). */
function scriptedInvoke(outputs: readonly string[]): {
  invoke: LoopInvoke;
  prompts: string[];
} {
  const prompts: string[] = [];
  let i = 0;
  const invoke: LoopInvoke = (prompt) => {
    prompts.push(prompt);
    const output = outputs[i] ?? '';
    i += 1;
    return Promise.resolve({ output, cost: COST });
  };
  return { invoke, prompts };
}

function seamWith(invoke: LoopInvoke, nonce?: () => string): AssessSeam {
  return {
    overlayDir: scratch,
    childId: 'unit-1',
    invoke,
    ...(nonce === undefined ? {} : { nonce }),
  };
}

/** A complete assessment object with the given overrides. */
function assessment(overrides: Partial<ParsimonyAssessment> = {}): ParsimonyAssessment {
  return {
    rung: 1,
    signals: { need: true, stdlib: true, native: false, dep: false, oneLine: false },
    floorContext: {
      crossesTrustBoundary: false,
      risksDataLoss: false,
      enforcesAccess: false,
      hasUserInterface: false,
      acts: false,
      wasRequested: true,
    },
    satisfied: { intent: true },
    rationale: 'reuses the stdlib',
    ...overrides,
  };
}

describe('chunkDiff', () => {
  it('returns one chunk for a diff that fits the budget', () => {
    const diff = 'x'.repeat(DIFF_ASSESS_MAX_CHARS);
    expect(chunkDiff(diff)).toEqual([diff]);
  });

  it('splits a diff that exceeds the budget into consecutive budget-sized chunks', () => {
    const diff = 'x'.repeat(DIFF_ASSESS_MAX_CHARS * 2 + 5);
    const chunks = chunkDiff(diff);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(DIFF_ASSESS_MAX_CHARS);
    expect(chunks[1]).toHaveLength(DIFF_ASSESS_MAX_CHARS);
    expect(chunks[2]).toHaveLength(5);
    expect(chunks.join('')).toBe(diff); // lossless reassembly
  });

  it('never cuts mid-surrogate — a surrogate pair stays whole in one chunk', () => {
    // A budget that lands exactly on the lead surrogate of an emoji at the boundary.
    const head = 'a'.repeat(3);
    const emoji = '\u{1F600}'; // two UTF-16 units (a surrogate pair)
    const diff = head + emoji + 'b'.repeat(3);
    const chunks = chunkDiff(diff, head.length + 1); // boundary falls on the lead surrogate
    // Every chunk reassembles losslessly and no chunk ends on a lone high surrogate.
    expect(chunks.join('')).toBe(diff);
    for (const c of chunks) {
      const last = c.charCodeAt(c.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });
});

describe('unionAssessments', () => {
  it('returns the single assessment unchanged for a one-element list', () => {
    const a = assessment({ rationale: 'only' });
    expect(unionAssessments([a])).toEqual(a);
  });

  it('OR’s floorContext — a flag set in only the second chunk appears in the union', () => {
    const a = assessment({ floorContext: { ...assessment().floorContext } });
    const b = assessment({
      floorContext: { ...assessment().floorContext, crossesTrustBoundary: true, acts: true },
    });
    const u = unionAssessments([a, b]);
    expect(u.floorContext.crossesTrustBoundary).toBe(true); // buried-boundary case
    expect(u.floorContext.acts).toBe(true);
    expect(u.floorContext.risksDataLoss).toBe(false);
  });

  it('fail-closed AND’s satisfied — true in chunk 1 but false in chunk 2 ⇒ not satisfied', () => {
    const a = assessment({ satisfied: { intent: true, input_validation: true } });
    const b = assessment({ satisfied: { input_validation: false } });
    const u = unionAssessments([a, b]);
    expect(u.satisfied.intent).toBe(true); // reported true once, never false
    expect(u.satisfied.input_validation).toBe(false); // a false anywhere sinks it
  });

  it('treats an entry reported true by some chunk and absent in others as satisfied', () => {
    const a = assessment({ satisfied: { intent: true } });
    const b = assessment({ satisfied: {} });
    expect(unionAssessments([a, b]).satisfied.intent).toBe(true);
  });

  it('takes ladder signals + rung from the FIRST chunk only', () => {
    const a = assessment({
      rung: 2,
      signals: { need: true, stdlib: false, native: true, dep: false, oneLine: false },
    });
    const b = assessment({
      rung: 5,
      signals: { need: true, stdlib: true, native: false, dep: true, oneLine: true },
    });
    const u = unionAssessments([a, b]);
    expect(u.rung).toBe(2);
    expect(u.signals).toEqual(a.signals);
  });

  it('concatenates the per-chunk rationales deterministically', () => {
    const u = unionAssessments([
      assessment({ rationale: 'one' }),
      assessment({ rationale: 'two' }),
    ]);
    expect(u.rationale).toBe('one\n---\ntwo');
  });
});

describe('assessParsimony — chunk + union [CLM-0175]', () => {
  it('single-chunk diff: ONE invoke call, output identical to a direct single assessment', async () => {
    const a = assessment({ rationale: 'small change' });
    const { invoke, prompts } = scriptedInvoke([JSON.stringify(a)]);
    const { assessment: out, cost } = await assessParsimony(
      seamWith(invoke, () => 'nonce0'),
      'a tiny diff',
    );
    expect(prompts).toHaveLength(1); // exactly one call for a sub-budget diff
    expect(out).toEqual(a); // byte-identical to a single direct assessment
    expect(cost).toEqual({ tokens: COST.tokens, usd: COST.usd });
  });

  it('multi-chunk diff: invoke per chunk; floorContext OR’d, satisfied AND’d, ladder from chunk 1, cost summed', async () => {
    // Chunk 1: clean floor, ladder rung 1. Chunk 2: buries a trust-boundary change and
    // claims input_validation FALSE that chunk 1 had asserted true.
    const chunk1 = assessment({
      rung: 1,
      signals: { need: true, stdlib: true, native: false, dep: false, oneLine: false },
      satisfied: { intent: true, input_validation: true },
      rationale: 'head looks clean',
    });
    const chunk2 = assessment({
      rung: 5,
      signals: { need: true, stdlib: false, native: false, dep: true, oneLine: false },
      floorContext: { ...assessment().floorContext, crossesTrustBoundary: true },
      satisfied: { input_validation: false },
      rationale: 'tail crosses a trust boundary without validation',
    });
    const { invoke, prompts } = scriptedInvoke([JSON.stringify(chunk1), JSON.stringify(chunk2)]);
    let n = 0;
    const nonce = (): string => `nonce${(n += 1)}`;
    const diff = 'x'.repeat(DIFF_ASSESS_MAX_CHARS + 50); // exceeds one budget ⇒ 2 chunks
    const { assessment: out, cost } = await assessParsimony(seamWith(invoke, nonce), diff);

    expect(prompts).toHaveLength(2); // one call per chunk
    // Each chunk got its OWN per-call nonce fence (#289/#288 preserved per chunk).
    expect(prompts[0]).toContain('nonce1');
    expect(prompts[1]).toContain('nonce2');

    expect(out.floorContext.crossesTrustBoundary).toBe(true); // buried boundary surfaces (OR)
    expect(out.satisfied.input_validation).toBe(false); // fail-closed AND (false in chunk 2)
    expect(out.satisfied.intent).toBe(true);
    expect(out.rung).toBe(1); // ladder from chunk 1
    expect(out.signals).toEqual(chunk1.signals);
    expect(cost).toEqual({ tokens: COST.tokens * 2, usd: COST.usd * 2 }); // summed
  });

  it('a diff over the chunk cap: cost is BOUNDED and the floor FAILS CLOSED (no DoS, no clean pass)', async () => {
    // A giant diff would otherwise force one model call per chunk (O(diff size)) — a
    // cost/latency denial. The assessor caps at MAX_ASSESS_CHUNKS calls and fails the
    // floor closed on the unassessed tail (every guard applies, none satisfied).
    const valid = JSON.stringify(assessment({ satisfied: { input_validation: true } }));
    const { invoke, prompts } = scriptedInvoke(
      Array.from({ length: MAX_ASSESS_CHUNKS + 5 }, () => valid),
    );
    const diff = 'x'.repeat(DIFF_ASSESS_MAX_CHARS * (MAX_ASSESS_CHUNKS + 3)); // far over the cap
    const { assessment: out, cost } = await assessParsimony(seamWith(invoke), diff);

    expect(prompts).toHaveLength(MAX_ASSESS_CHUNKS); // BOUNDED — not one call per chunk
    expect(cost.tokens).toBe(COST.tokens * MAX_ASSESS_CHUNKS); // bounded spend
    // fail closed: every boundary applies, nothing is proven satisfied (even the
    // input_validation the assessed chunks claimed) → evaluateFloor defers all.
    expect(out.floorContext.crossesTrustBoundary).toBe(true);
    expect(out.floorContext.acts).toBe(true);
    expect(out.satisfied).toEqual({});
    expect(out.rationale).toContain('too large');
  });

  it('a malformed chunk emission throws the typed error — NO fabricated assessment (#289 per chunk)', async () => {
    // Chunk 1 is valid; chunk 2 is garbage — the whole assessment must throw, not union
    // a partial/fabricated result.
    const { invoke } = scriptedInvoke([
      JSON.stringify(assessment()),
      'I cannot produce JSON for this.',
    ]);
    const diff = 'x'.repeat(DIFF_ASSESS_MAX_CHARS + 50);
    await expect(assessParsimony(seamWith(invoke), diff)).rejects.toBeInstanceOf(LoopParseError);
  });
});
