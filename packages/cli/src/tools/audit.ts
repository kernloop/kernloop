/**
 * `audit` — query + chain verification on demand (spec §3.4) [CLM-0035].
 * `verify` re-walks the JSONL chain via the kernel verifier; `query` reads
 * envelopes back out of the log filtered by sequence range and event type.
 * Reading is done directly off the overlay's audit file — the chain is the
 * record, no copy exists.
 */
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  AuditEnvelopeSchema,
  verifyChain,
  type AuditEnvelope,
  type VerifyResult,
} from '@kernloop/kernel';
import type { Kernloop } from '../kernel.js';

/** Input to the `audit` tool — a discriminated op. */
export const AuditInputSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('verify'),
    expectedLength: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    op: z.literal('query'),
    fromSeq: z.number().int().positive().optional(),
    toSeq: z.number().int().positive().optional(),
    type: z.string().min(1).optional(),
  }),
]);
export type AuditInput = z.input<typeof AuditInputSchema>;

/** What `audit` returns, per op. */
export type AuditResult =
  | { op: 'verify'; result: VerifyResult }
  | { op: 'query'; events: AuditEnvelope[]; total: number };

/** Parse every line of the audit log into envelopes (schema-validated). */
export function readEnvelopes(auditPath: string): AuditEnvelope[] {
  if (!existsSync(auditPath)) return [];
  const text = readFileSync(auditPath, 'utf8');
  const envelopes: AuditEnvelope[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    envelopes.push(AuditEnvelopeSchema.parse(JSON.parse(line)));
  }
  return envelopes;
}

/** The `audit` tool. See module docs. */
export function auditTool(kern: Kernloop, input: AuditInput): AuditResult {
  const parsed = AuditInputSchema.parse(input);
  if (parsed.op === 'verify') {
    const result = verifyChain(
      kern.store,
      parsed.expectedLength === undefined ? undefined : { expectedLength: parsed.expectedLength },
    );
    return { op: 'verify', result };
  }
  const all = readEnvelopes(kern.paths.audit);
  const events = all.filter(
    (e) =>
      (parsed.fromSeq === undefined || e.seq >= parsed.fromSeq) &&
      (parsed.toSeq === undefined || e.seq <= parsed.toSeq) &&
      (parsed.type === undefined || e.type === parsed.type),
  );
  return { op: 'query', events, total: all.length };
}
