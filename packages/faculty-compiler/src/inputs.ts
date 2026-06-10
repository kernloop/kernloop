/**
 * Typed inputs to the context compiler (spec §5.1). The compiler is a pure
 * function: ALL source material — claims-registry entries, memory fragments,
 * repo-state probes, the skills index — arrives here as data, gathered by
 * the caller (the CLI composition root). The compiler never reads a file,
 * opens a socket, or spawns a process; that purity is what makes briefs
 * reproducible artifacts (CLM-0029). Everything is zod-validated at the
 * boundary (charter: no `any` across boundaries).
 */
import { z } from 'zod';
import { TaskContractSchema } from '@kernloop/contracts';

/**
 * The six brief sections in priority order — index order IS assembly order,
 * and priority 1 (`task`) is dropped last under budget pressure (spec §5.1).
 */
export const SECTION_NAMES = [
  'task',
  'claims',
  'semanticFacts',
  'episodicSummaries',
  'repoProbes',
  'skillsIndex',
] as const;

/** One of the six compiler section names. */
export type SectionName = (typeof SECTION_NAMES)[number];

/** Drop priority per section: 1 is dropped last, 6 is dropped first. */
export const SECTION_PRIORITY: Record<SectionName, number> = {
  task: 1,
  claims: 2,
  semanticFacts: 3,
  episodicSummaries: 4,
  repoProbes: 5,
  skillsIndex: 6,
};

/** An overlay claims-registry entry, as gathered by the caller. */
export const ClaimEntrySchema = z.strictObject({
  id: z.string().min(1),
  statement: z.string().min(1),
  status: z.string().min(1),
});
export type ClaimEntry = z.infer<typeof ClaimEntrySchema>;

/**
 * A semantic-memory fact. Pre-ranked by the memory faculty (spec §5.2:
 * provenance × recency × repo-locality); the compiler preserves caller
 * order and never re-ranks. Provenance is mandatory (it becomes the
 * section's Source ref); `confidence`/`refreshedAt` are carried metadata.
 */
export const SemanticFactSchema = z.strictObject({
  fact: z.string().min(1),
  provenance: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  refreshedAt: z.string().min(1).optional(),
});
export type SemanticFact = z.infer<typeof SemanticFactSchema>;

/** An episodic trace summary (spec §5.2: digests, never full transcripts). */
export const EpisodicSummarySchema = z.strictObject({
  taskId: z.string().min(1),
  summary: z.string().min(1),
  traceRef: z.string().min(1),
});
export type EpisodicSummary = z.infer<typeof EpisodicSummarySchema>;

/** A repo-state probe result (e.g. `git status` output), gathered by the caller. */
export const RepoProbeSchema = z.strictObject({
  name: z.string().min(1),
  content: z.string(),
  source: z.string().min(1),
});
export type RepoProbe = z.infer<typeof RepoProbeSchema>;

/**
 * A skills-index entry: name + one-liner ONLY (spec §5.1, §8 item 2 —
 * capability index costs ~1 line until loaded; bodies load on demand).
 */
export const SkillIndexEntrySchema = z.strictObject({
  name: z.string().min(1),
  oneLiner: z.string().min(1),
});
export type SkillIndexEntry = z.infer<typeof SkillIndexEntrySchema>;

/** The five caller-gathered source groups; the sixth section (`task`) renders from the TaskContract. */
export const BriefSourcesSchema = z.strictObject({
  claims: z.array(ClaimEntrySchema).optional(),
  semanticFacts: z.array(SemanticFactSchema).optional(),
  episodicSummaries: z.array(EpisodicSummarySchema).optional(),
  repoProbes: z.array(RepoProbeSchema).optional(),
  skillsIndex: z.array(SkillIndexEntrySchema).optional(),
});
export type BriefSources = z.infer<typeof BriefSourcesSchema>;

/**
 * Hard token budget (spec §5.1, §8 item 1). `totalTokens` caps the whole
 * brief; `perSection` optionally caps individual sections by name. Both are
 * enforced, never advisory (CLM-0030).
 */
export const CompileBudgetSchema = z.strictObject({
  totalTokens: z.number().int().nonnegative(),
  perSection: z.partialRecord(z.enum(SECTION_NAMES), z.number().int().nonnegative()).optional(),
});
export type CompileBudget = z.infer<typeof CompileBudgetSchema>;

/** Full input to {@link compileBrief}. */
export const CompileBriefInputSchema = z.strictObject({
  task: TaskContractSchema,
  sources: BriefSourcesSchema.optional(),
  budget: CompileBudgetSchema,
  compilerVersion: z.string().min(1).optional(),
});
export type CompileBriefInput = z.infer<typeof CompileBriefInputSchema>;
