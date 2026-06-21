/**
 * The `kernloop debt` subcommand [#6, EPIC #407] — a READ-ONLY harvest of the
 * unmitigated parsimony debt on the overlay. It reads `parsimony.receipt` events
 * back off the hash-chained audit log (via the same {@link readEnvelopes} reader
 * the `audit` tool uses — the chain is the record, no copy is made), validates
 * each payload with {@link parseParsimonyReceipt}, and lists ONLY the receipts
 * that carry a `deferred` block: a Control Floor entry that applied and was not
 * satisfied — a shortcut taken with a recorded control risk.
 *
 * It MUTATES NOTHING and appends NO audit event: a harvest is a query. It is also
 * CRASH-PROOF over a real log — a non-parsimony event or a malformed payload is
 * skipped, never thrown, so harvesting cannot be broken by an unrelated event.
 * Its own module so the CLI dispatcher stays under the LOC ceiling (#58).
 *
 * @module cli/debt-commands
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  PARSIMONY_RECEIPT_EVENT,
  parseParsimonyReceipt,
  toOscalAssessmentResults,
  type ParsimonyReceipt,
} from '@kernloop/parsimony';
import { createProductionKernloop, type Kernloop } from './kernel.js';
import { OVERLAY_DIR_NAME } from './overlay.js';
import { readEnvelopes } from './tools/index.js';
import type { CliIo } from './cli.js';

/** One harvested debt row — a deferred parsimony decision and its control risk. */
export interface DebtItem {
  readonly receiptId: string;
  readonly subject: string;
  readonly rung: number;
  readonly outcome: ParsimonyReceipt['outcome'];
  readonly controlRisk: readonly string[];
  readonly owner: string;
  readonly ts: string;
}

/** The structured harvest result (`--json`): the deferred rows plus a count. */
export interface DebtHarvest {
  readonly debts: readonly DebtItem[];
  readonly count: number;
}

/**
 * Read EVERY parsimony receipt back off the overlay's audit log (the same
 * {@link readEnvelopes} reader the `audit` tool uses — no copy). A non-parsimony
 * envelope is filtered by type and a malformed parsimony payload is skipped
 * (validation throws swallowed), so an unrelated or corrupt event can never crash
 * the read. Pure read — no mutation, no append. Feeds both the debt harvest
 * (deferrals only) and the OSCAL projection (all receipts).
 */
export function readParsimonyReceipts(kern: Kernloop): ParsimonyReceipt[] {
  const receipts: ParsimonyReceipt[] = [];
  for (const env of readEnvelopes(kern.paths.audit)) {
    if (env.type !== PARSIMONY_RECEIPT_EVENT) continue;
    try {
      receipts.push(parseParsimonyReceipt(env.payload));
    } catch {
      continue; // malformed parsimony payload — skip, never crash the read
    }
  }
  return receipts;
}

/**
 * Harvest the unmitigated parsimony debt — the {@link readParsimonyReceipts} that
 * carry a `deferred` block (a Control Floor entry that applied and was not
 * satisfied, with a recorded control risk). Pure read; mutates/appends nothing.
 */
export function harvestDebt(kern: Kernloop): DebtHarvest {
  const debts: DebtItem[] = [];
  for (const receipt of readParsimonyReceipts(kern)) {
    if (receipt.deferred === null) continue;
    debts.push({
      receiptId: receipt.receiptId,
      subject: receipt.subject,
      rung: receipt.rung,
      outcome: receipt.outcome,
      controlRisk: receipt.deferred.controlRisk,
      owner: receipt.deferred.owner,
      ts: receipt.ts,
    });
  }
  return { debts, count: debts.length };
}

/** Render the harvest as a human-readable table (the default, non-`--json` view). */
export function renderDebtTable(harvest: DebtHarvest): string {
  if (harvest.count === 0) return 'parsimony debt: none — no unmitigated deferrals on the log.';
  const lines = [`parsimony debt: ${String(harvest.count)} unmitigated deferral(s)`, ''];
  for (const d of harvest.debts) {
    lines.push(
      `  ${d.receiptId}  rung=${String(d.rung)} ${d.outcome}`,
      `    subject:  ${d.subject}`,
      `    risk:     ${d.controlRisk.join(', ')}`,
      `    owner:    ${d.owner}`,
      `    ts:       ${d.ts}`,
      '',
    );
  }
  return lines.join('\n').trimEnd();
}

/**
 * Parse `--dir`/`--json`/`--oscal`, then emit. Default: the deferred-debt harvest
 * (table, or JSON with `--json`). With `--oscal`: project ALL parsimony receipts
 * (not just deferrals) into a schema-valid OSCAL assessment-results document and
 * print it — the real entry point for the OSCAL projection (#430). The document
 * uuid + timestamp are minted per-invocation (the projection stays pure).
 */
export async function debtCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { dir: { type: 'string' }, json: { type: 'boolean' }, oscal: { type: 'boolean' } },
    allowPositionals: false,
  });
  const overlayDir = path.join(path.resolve(io.cwd, values.dir ?? '.'), OVERLAY_DIR_NAME);
  const kern = createProductionKernloop({ overlayDir });
  try {
    if (values.oscal === true) {
      const oscal = toOscalAssessmentResults(readParsimonyReceipts(kern), {
        uuid: randomUUID(),
        lastModified: new Date().toISOString(),
      });
      io.out(JSON.stringify(oscal, null, 2));
      return 0;
    }
    const harvest = harvestDebt(kern);
    io.out(values.json === true ? JSON.stringify(harvest, null, 2) : renderDebtTable(harvest));
    return 0;
  } finally {
    kern.close();
  }
}
