/**
 * @kernloop/faculty-compiler — Layer 2 context compiler (spec §5.1).
 *
 * Deterministic Brief assembly: TaskContract + caller-gathered sources →
 * zod-valid Brief under hard token budgets with priority-ordered drop
 * (CLM-0029, CLM-0030). The compiler is a PURE FUNCTION — no file, network,
 * or process I/O anywhere in the compile path; the composition root gathers
 * memory fragments and repo state and passes them in as typed inputs. This
 * faculty imports only @kernloop/contracts and external dependencies
 * (constitutional rule 5).
 */
export { compileBrief, COMPILER_VERSION } from './compile.js';
export { estimateTokens, CHARS_PER_TOKEN } from './tokens.js';
export { DROP_NOTICE_REF } from './budget.js';
export { compilerManifest } from './manifest.js';
export {
  SECTION_NAMES,
  SECTION_PRIORITY,
  ClaimEntrySchema,
  SemanticFactSchema,
  EpisodicSummarySchema,
  RepoProbeSchema,
  SkillIndexEntrySchema,
  BriefSourcesSchema,
  CompileBudgetSchema,
  CompileBriefInputSchema,
} from './inputs.js';
export type {
  SectionName,
  ClaimEntry,
  SemanticFact,
  EpisodicSummary,
  RepoProbe,
  SkillIndexEntry,
  BriefSources,
  CompileBudget,
  CompileBriefInput,
} from './inputs.js';
