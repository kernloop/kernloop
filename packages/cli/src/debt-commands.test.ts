/**
 * Tests for `kernloop debt` [#6]: a read-only harvest of unmitigated parsimony
 * deferrals from the hash-chained audit log. Seeds a temp overlay with a deferred
 * receipt, a clean receipt, and an unrelated/malformed event, then asserts the
 * harvest lists ONLY the deferred one (with its control risk) and never crashes.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent, type JsonValue } from '@kernloop/kernel';
import {
  PARSIMONY_RECEIPT_EVENT,
  buildParsimonyReceipt,
  type ParsimonyDecision,
} from '@kernloop/parsimony';
import { createKernloop, type Kernloop } from './kernel.js';
import { harvestDebt, renderDebtTable, debtCommand } from './debt-commands.js';
import { runCli, type CliIo } from './cli.js';

const dirs: string[] = [];
function freshKernloop(): { kern: Kernloop; repo: string } {
  const repo = mkdtempSync(path.join(tmpdir(), 'kernloop-cli-debt-'));
  dirs.push(repo);
  return { kern: createKernloop({ overlayDir: path.join(repo, '.kernloop') }), repo };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A deferred decision: input_validation applied and was NOT satisfied. */
function deferredDecision(receiptId: string): ParsimonyDecision {
  return {
    receiptId,
    ts: '2026-06-21T00:00:00.000Z',
    loopIter: 1,
    overlay: 'test',
    subject: 'packages/x/src/a.ts:1-9',
    ladder: { rung: 5, name: 'minimal', outcome: 'minimal_impl' },
    floorChecks: [
      {
        name: 'input_validation',
        catalog: 'nist-800-53r5',
        controlIds: ['SI-10'],
        status: 'deferred',
      },
    ],
    rationaleDigest: 'sha256:def',
    verifier: 'v1',
    owner: 'william',
  };
}

/** A clean decision: input_validation applied and PASSED — no deferred block. */
function cleanDecision(receiptId: string): ParsimonyDecision {
  return {
    ...deferredDecision(receiptId),
    subject: 'packages/x/src/b.ts:1-9',
    floorChecks: [
      { name: 'input_validation', catalog: 'nist-800-53r5', controlIds: ['SI-10'], status: 'pass' },
    ],
  };
}

/** Seed the overlay log with one deferred receipt, one clean, an unrelated event,
 * and a malformed parsimony event — the realistic mix a harvest must survive. */
function seed(kern: Kernloop): void {
  const deferred = buildParsimonyReceipt(deferredDecision('01J9DEBT00000000000000000'));
  const clean = buildParsimonyReceipt(cleanDecision('01J9CLEAN0000000000000000'));
  appendEvent(kern.store, {
    type: PARSIMONY_RECEIPT_EVENT,
    payload: deferred as unknown as JsonValue,
  });
  appendEvent(kern.store, {
    type: PARSIMONY_RECEIPT_EVENT,
    payload: clean as unknown as JsonValue,
  });
  appendEvent(kern.store, { type: 'cli.unrelated', payload: { n: 1 } });
  // a parsimony.receipt whose payload is NOT a valid receipt — must be skipped
  appendEvent(kern.store, { type: PARSIMONY_RECEIPT_EVENT, payload: { bogus: true } });
}

describe('harvestDebt', () => {
  it('lists ONLY the deferred receipt, with its control risk', () => {
    const { kern } = freshKernloop();
    seed(kern);
    const harvest = harvestDebt(kern);
    expect(harvest.count).toBe(1);
    const [debt] = harvest.debts;
    expect(debt.receiptId).toBe('01J9DEBT00000000000000000');
    expect(debt.subject).toBe('packages/x/src/a.ts:1-9');
    expect(debt.rung).toBe(5);
    expect(debt.outcome).toBe('minimal_impl');
    expect(debt.controlRisk).toEqual(['SI-10']);
    expect(debt.owner).toBe('william');
    expect(debt.ts).toBe('2026-06-21T00:00:00.000Z');
    kern.close();
  });

  it('does not crash on an unrelated or malformed event', () => {
    const { kern } = freshKernloop();
    // only an unrelated + malformed event, no real deferral
    appendEvent(kern.store, { type: 'cli.unrelated', payload: { n: 1 } });
    appendEvent(kern.store, { type: PARSIMONY_RECEIPT_EVENT, payload: { bogus: true } });
    expect(() => harvestDebt(kern)).not.toThrow();
    expect(harvestDebt(kern).count).toBe(0);
    kern.close();
  });

  it('returns an empty harvest on a fresh log', () => {
    const { kern } = freshKernloop();
    expect(harvestDebt(kern)).toEqual({ debts: [], count: 0 });
    kern.close();
  });
});

describe('renderDebtTable', () => {
  it('renders a none line when there is no debt', () => {
    expect(renderDebtTable({ debts: [], count: 0 })).toContain('none');
  });

  it('renders the receipt id, risk, and owner for a debt', () => {
    const table = renderDebtTable(
      harvestDebt(
        (() => {
          const { kern } = freshKernloop();
          seed(kern);
          return kern;
        })(),
      ),
    );
    expect(table).toContain('01J9DEBT00000000000000000');
    expect(table).toContain('SI-10');
    expect(table).toContain('william');
    expect(table).toContain('1 unmitigated deferral');
  });
});

describe('debtCommand (--json shape + dispatch)', () => {
  function capture(cwd: string): { io: CliIo; out: () => string } {
    const sink: string[] = [];
    return { io: { out: (t) => sink.push(t), err: () => {}, cwd }, out: () => sink.join('\n') };
  }

  it('emits structured JSON under --json with the deferred row only', async () => {
    const { kern, repo } = freshKernloop();
    seed(kern);
    kern.close();
    const cap = capture(repo);
    expect(await debtCommand(['--json'], cap.io)).toBe(0);
    const json = JSON.parse(cap.out()) as {
      count: number;
      debts: { receiptId: string; controlRisk: string[] }[];
    };
    expect(json.count).toBe(1);
    expect(json.debts).toHaveLength(1);
    expect(json.debts[0].receiptId).toBe('01J9DEBT00000000000000000');
    expect(json.debts[0].controlRisk).toEqual(['SI-10']);
  });

  it('is dispatched as the `debt` verb and prints the human table by default', async () => {
    const { kern, repo } = freshKernloop();
    seed(kern);
    kern.close();
    const cap = capture(repo);
    expect(await runCli(['debt'], cap.io)).toBe(0);
    expect(cap.out()).toContain('01J9DEBT00000000000000000');
    expect(cap.out()).toContain('unmitigated deferral');
  });

  it('--oscal projects ALL parsimony receipts into an OSCAL assessment-results document (#430)', async () => {
    const { kern, repo } = freshKernloop();
    seed(kern); // 1 deferred + 1 clean + 1 unrelated + 1 malformed (the realistic mix)
    kern.close();
    const cap = capture(repo);
    expect(await debtCommand(['--oscal'], cap.io)).toBe(0);
    const doc = JSON.parse(cap.out()) as { 'assessment-results': { results: unknown[] } };
    // the OSCAL root + the projection ran over BOTH receipts (not just deferrals),
    // surviving the unrelated/malformed events; the deferred receipt's control risk
    // (SI-10) rides into a finding, so the document is non-empty and wired.
    expect(doc['assessment-results']).toBeDefined();
    expect(doc['assessment-results'].results.length).toBeGreaterThan(0);
    expect(cap.out()).toContain('SI-10');
  });
});
