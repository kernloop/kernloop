/**
 * @kernloop/contracts — Layer 1, the frozen five (spec §4).
 *
 * TaskContract · Brief · Verdict · Outcome · Manifest, as zod schemas with
 * inferred TypeScript types, zod-validated at every bus boundary. The five
 * are frozen: breaking changes follow the human-ratification path described
 * in MIGRATIONS.md.
 */
import { BriefSchema } from './brief.js';
import { ManifestSchema } from './manifest.js';
import { OutcomeSchema } from './outcome.js';
import { TaskContractSchema } from './task-contract.js';
import { VerdictSchema } from './verdict.js';

export {
  TierSchema,
  MaturitySchema,
  ModelTierSchema,
  CONTRACT_NAMES,
  ContractRefSchema,
  ClaimRefSchema,
  EvidenceRequirementSchema,
  CheckSchema,
  SourceSchema,
  BriefSectionSchema,
  FindingSchema,
  CostSchema,
  SignalSchema,
  CapabilitySchema,
  CostProfileSchema,
  EvidenceThresholdSchema,
} from './common.js';
export type {
  Tier,
  Maturity,
  ModelTier,
  ContractRef,
  ClaimRef,
  EvidenceRequirement,
  Check,
  Source,
  BriefSection,
  Finding,
  Cost,
  Signal,
  Capability,
  CostProfile,
  EvidenceThreshold,
} from './common.js';
export { TaskContractSchema } from './task-contract.js';
export type { TaskContract } from './task-contract.js';
export { BriefSchema } from './brief.js';
export type { Brief } from './brief.js';
export { VerdictSchema, VerdictResultSchema, VoterRecordSchema } from './verdict.js';
export type { Verdict, VerdictResult, VoterRecord } from './verdict.js';
export { OutcomeSchema, OutcomeStatusSchema } from './outcome.js';
export type { Outcome, OutcomeStatus } from './outcome.js';
export { ManifestSchema, ManifestKindSchema } from './manifest.js';
export type { Manifest, ManifestKind } from './manifest.js';
export { contractsVersion } from './version.js';

/**
 * The frozen five by name → schema (spec §4). The complete contract surface;
 * the event bus carries these five and nothing else (spec §3.1).
 */
export const KNOWN_CONTRACTS = {
  TaskContract: TaskContractSchema,
  Brief: BriefSchema,
  Verdict: VerdictSchema,
  Outcome: OutcomeSchema,
  Manifest: ManifestSchema,
} as const;
