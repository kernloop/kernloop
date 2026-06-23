/**
 * The parsimony BLIND VERIFIER [#413/#7, EPIC #407]. Asserts the second, independent,
 * rationale-blind floor re-check: it CONFIRMS when the verifier confirms; REFUTES (with
 * the failing guard names) when it refutes; UNIONs per-chunk verdicts FAIL-CLOSED (any
 * chunk refuting refutes the whole); REFUTES an over-cap diff outright (it cannot be
 * fully verified); throws a typed error on a malformed verdict; and the prompt is BLIND
 * — it carries the diff + the claimed-pass guard NAMES, never an assessor rationale.
 * Scripted invoke, mirroring the assessor suite.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { FloorCheck } from '@kernloop/parsimony';
import { LoopParseError, type LoopInvoke } from './invoke.js';
import { DIFF_ASSESS_MAX_CHARS, MAX_ASSESS_CHUNKS } from './parsimony-assess.js';
import { verifierPrompt, verifyFloor, type VerifySeam } from './parsimony-verify.js';

const scratch = mkdtempSync(path.join(tmpdir(), 'kernloop-parsimony-verify-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const COST = { tokens: 5, usd: 0.002 };

/** A claimed-pass floor check fixture. */
function passCheck(name: string): FloorCheck {
  return { name, catalog: 'intent', controlIds: [], status: 'pass' };
}
const claimed: FloorCheck[] = [passCheck('input_validation'), passCheck('intent')];

/** A seam over a scripted invoke, with a deterministic nonce so prompts are stable. */
function seamOf(invoke: LoopInvoke, nonce = 'deadbeef'): VerifySeam {
  return { overlayDir: scratch, childId: 'child-1', invoke, nonce: () => nonce };
}

/** An invoke that returns each scripted output in sequence (one per chunk). */
function sequenced(outputs: string[]): { invoke: LoopInvoke; prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  const invoke: LoopInvoke = (prompt) => {
    prompts.push(prompt);
    const output = outputs[Math.min(i, outputs.length - 1)] ?? '';
    i += 1;
    return Promise.resolve({ output, cost: COST });
  };
  return { invoke, prompts };
}

const CONFIRM = JSON.stringify({ status: 'confirmed', refutedChecks: [], reason: 'all hold' });
const REFUTE = JSON.stringify({
  status: 'refuted',
  refutedChecks: ['input_validation'],
  reason: 'no validation present',
});

describe('verifyFloor — blind floor re-check [CLM-0176]', () => {
  it('CONFIRMS when the verifier confirms the claimed-pass guards', async () => {
    const { invoke } = sequenced([CONFIRM]);
    const result = await verifyFloor(seamOf(invoke), 'small diff', claimed);
    expect(result.status).toBe('confirmed');
    expect(result.refutedChecks).toEqual([]);
    expect(result.cost).toEqual(COST); // one chunk, one call
  });

  it('REFUTES (with the failing guard names) when the verifier refutes', async () => {
    const { invoke } = sequenced([REFUTE]);
    const result = await verifyFloor(seamOf(invoke), 'small diff', claimed);
    expect(result.status).toBe('refuted');
    expect(result.refutedChecks).toContain('input_validation');
  });

  it('UNIONs per-chunk verdicts FAIL-CLOSED — any chunk refuting refutes the whole', async () => {
    // A 2-chunk diff: chunk 1 confirms, chunk 2 refutes ⇒ overall refuted.
    const big = 'a'.repeat(DIFF_ASSESS_MAX_CHARS + 10);
    const { invoke, prompts } = sequenced([CONFIRM, REFUTE]);
    const result = await verifyFloor(seamOf(invoke), big, claimed);
    expect(prompts).toHaveLength(2); // verified per chunk
    expect(result.status).toBe('refuted');
    expect(result.refutedChecks).toContain('input_validation');
    expect(result.cost.tokens).toBe(COST.tokens * 2); // per-chunk costs summed
  });

  it('REFUTES an over-cap diff outright at ZERO model spend (fail-closed short-circuit, #434)', async () => {
    // More than MAX_ASSESS_CHUNKS chunks: refuted regardless of (un-run) chunk verdicts.
    const huge = 'a'.repeat(DIFF_ASSESS_MAX_CHARS * (MAX_ASSESS_CHUNKS + 1));
    const { invoke, prompts } = sequenced([CONFIRM]); // every chunk would "confirm"
    const result = await verifyFloor(seamOf(invoke), huge, claimed);
    expect(result.status).toBe('refuted'); // over-cap ⇒ fail-closed refute
    expect(result.refutedChecks).toEqual(expect.arrayContaining(['input_validation', 'intent']));
    // #434: the verdict is refuted regardless of the in-cap chunks, so the verifier
    // short-circuits BEFORE invoking the model — zero calls, zero cost.
    expect(prompts).toHaveLength(0);
    expect(result.cost).toEqual({ tokens: 0, usd: 0 });
  });

  it('throws a typed LoopParseError on a malformed verdict — NO fabricated verdict', async () => {
    const { invoke } = sequenced(['I cannot produce JSON.']);
    await expect(verifyFloor(seamOf(invoke), 'small diff', claimed)).rejects.toBeInstanceOf(
      LoopParseError,
    );
  });
});

describe('verifierPrompt — BLIND to the assessor rationale', () => {
  it('carries the diff and the claimed-pass guard NAMES, never an assessor rationale', () => {
    const prompt = verifierPrompt('the diff body', 'nonce123', ['input_validation', 'intent']);
    expect(prompt).toContain('BLIND PARSIMONY VERIFIER');
    expect(prompt).toContain('the diff body'); // the diff is fenced in
    expect(prompt).toContain('input_validation'); // the claimed-pass guard names
    expect(prompt).toContain('intent');
    // verifierPrompt has NO rationale parameter — the only assessor-derived input is
    // the list of guard names. (The executor test asserts the rationale string never
    // reaches this prompt at runtime.)
  });

  it('neutralizes a fence-nonce collision in the UNTRUSTED diff (#289)', () => {
    const prompt = verifierPrompt('payload nonceX end', 'nonceX', ['intent']);
    expect(prompt).toContain('verify-fence token neutralized');
    // The raw nonce appears only as the structural fence tag, not inside the diff body.
    expect(prompt).not.toContain('payload nonceX end');
  });
});
