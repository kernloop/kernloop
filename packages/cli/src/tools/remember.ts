/**
 * `remember` — memory write, provenance mandatory (spec §3.4, §5.2): typed
 * fact → ack. The faculty enforces the provenance requirement with a typed
 * error; this boundary surfaces it verbatim rather than softening it.
 */
import { z } from 'zod';
import type { FactRecord } from '@kernloop/faculty-memory';
import type { Kernloop } from '../kernel.js';

/** Input to the `remember` tool. Provenance is mandatory (spec §5.2). */
export const RememberInputSchema = z.strictObject({
  fact: z.string().min(1),
  provenance: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});
export type RememberInput = z.input<typeof RememberInputSchema>;

/** What `remember` returns: the stored (or refreshed) fact record. */
export interface RememberResult {
  stored: FactRecord;
}

/** The `remember` tool. See module docs. */
export function rememberTool(kern: Kernloop, input: RememberInput): RememberResult {
  const parsed = RememberInputSchema.parse(input);
  const stored = kern.memory.rememberFact({
    fact: parsed.fact,
    provenance: parsed.provenance,
    ...(parsed.confidence === undefined ? {} : { confidence: parsed.confidence }),
  });
  return { stored };
}
