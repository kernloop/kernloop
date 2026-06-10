/**
 * `gate` — invoke any gate uniformly (spec §3.4): proposal + gate name →
 * Verdict. P1 ships exactly one gate, `quality` (spec §5.3); `vote` (P2)
 * and `review` (P3) are absent, not stubbed — an unknown gate name is a
 * typed error naming what exists. Every emitted Verdict is published on the
 * bus and therefore appended to the audit chain [CLM-0032].
 */
import { z } from 'zod';
import type { Verdict } from '@kernloop/contracts';
import type { QualityCheck } from '@kernloop/faculty-gates';
import type { Kernloop } from '../kernel.js';
import { executeQualityGate } from '../executors.js';

/** Gates that exist in P1. */
export const P1_GATES = ['quality'] as const;

/** Input to the `gate` tool. */
export const GateInputSchema = z.strictObject({
  gateName: z.string().min(1),
  taskId: z.string().min(1),
  workspaceDir: z.string().min(1),
});
export type GateInput = z.input<typeof GateInputSchema>;

/** Typed rejection for a gate that does not exist in this phase. */
export class UnknownGateError extends Error {
  readonly code = 'unknown_gate';
  constructor(gateName: string) {
    super(
      `unknown gate "${gateName}" — P1 ships ${P1_GATES.join(', ')} only (vote is P2, review is P3)`,
    );
    this.name = 'UnknownGateError';
  }
}

/** The `gate` tool. See module docs. */
export async function gateTool(
  kern: Kernloop,
  input: GateInput,
  options: { checks?: readonly QualityCheck[] } = {},
): Promise<Verdict> {
  const parsed = GateInputSchema.parse(input);
  if (parsed.gateName !== 'quality') {
    throw new UnknownGateError(parsed.gateName);
  }
  return executeQualityGate(kern, {
    taskId: parsed.taskId,
    workspaceDir: parsed.workspaceDir,
    ...(options.checks === undefined ? {} : { checks: options.checks }),
  });
}
