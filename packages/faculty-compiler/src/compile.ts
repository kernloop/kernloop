/**
 * compileBrief — deterministic TaskContract → Brief assembly (spec §5.1).
 *
 * Determinism contract (CLM-0029): identical inputs produce byte-identical
 * Briefs (JSON.stringify equality) under the pinned COMPILER_VERSION. No
 * clock, no randomness, no map-iteration order dependence — section order
 * is fixed by priority, item order by caller-supplied input order, and
 * output key order by literal construction + schema parsing.
 */
import { BriefSchema, type Brief } from '@kernloop/contracts';
import { CompileBriefInputSchema, type CompileBriefInput } from './inputs.js';
import { buildDrafts } from './sections.js';
import { fitToBudget } from './budget.js';

/**
 * Pinned compiler version stamped into every Brief (CLM-0029: briefs are
 * reproducible artifacts; the version pins the assembly algorithm).
 */
export const COMPILER_VERSION = '0.1.0';

/**
 * Compile a Brief from a TaskContract plus caller-gathered sources, under a
 * hard token budget (CLM-0030: per-section + total caps, priority-ordered
 * drop, provenance on every section). Pure function — throws ZodError on
 * malformed input; performs no I/O of any kind.
 */
export function compileBrief(input: CompileBriefInput): Brief {
  const parsed = CompileBriefInputSchema.parse(input);
  const drafts = buildDrafts(parsed.task, parsed.sources ?? {});
  const sections = fitToBudget(drafts, parsed.budget.totalTokens, parsed.budget.perSection ?? {});
  const used = sections.reduce((sum, section) => sum + section.tokens, 0);
  return BriefSchema.parse({
    taskId: parsed.task.id,
    sections,
    budget: { allotted: parsed.budget.totalTokens, used },
    compilerVersion: parsed.compilerVersion ?? COMPILER_VERSION,
  });
}
