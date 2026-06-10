/**
 * `recall` — memory read, provenance-tagged (spec §3.4): query → ranked
 * fact fragments. A thin boundary over the memory faculty's semantic recall
 * (relevance × provenance × recency, spec §5.2); every returned fact carries
 * the provenance it was written with.
 */
import { z } from 'zod';
import type { RecalledFact } from '@kernloop/faculty-memory';
import type { Kernloop } from '../kernel.js';

/** Input to the `recall` tool. */
export const RecallInputSchema = z.strictObject({
  query: z.string().min(1),
  limit: z.number().int().positive().optional(),
});
export type RecallInput = z.input<typeof RecallInputSchema>;

/** What `recall` returns. */
export interface RecallResult {
  query: string;
  facts: RecalledFact[];
}

/** The `recall` tool. See module docs. */
export function recallTool(kern: Kernloop, input: RecallInput): RecallResult {
  const parsed = RecallInputSchema.parse(input);
  const facts = kern.memory.recallFacts(
    parsed.query,
    parsed.limit === undefined ? {} : { limit: parsed.limit },
  );
  return { query: parsed.query, facts };
}
