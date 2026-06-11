import { z } from 'zod';
import {
  CapabilitySchema,
  ClaimRefSchema,
  ContractRefSchema,
  CostProfileSchema,
  EvidenceThresholdSchema,
  MaturitySchema,
  ModelTierSchema,
  TierSchema,
} from './common.js';

/**
 * Manifest kind (spec §4): what category of component is being registered —
 * `faculty | strategy | gate | agentTemplate | skill | workshopTool`.
 */
export const ManifestKindSchema = z.enum([
  'faculty',
  'strategy',
  'gate',
  'agentTemplate',
  'skill',
  'workshopTool',
]);
export type ManifestKind = z.infer<typeof ManifestKindSchema>;

/**
 * Manifest — the registration record for every governed component (spec §4).
 * The ManifestRegistry is the single source of capability truth (spec §3.1);
 * the router matches TaskContracts to manifests by capability, budget,
 * authority tier, and fitness prior.
 *
 * Fields (exactly as specified):
 * - `name` / `version` / `kind` — component identity
 * - `capabilities` — what the component can do (router match keys)
 * - `contracts` — `{ consumes, emits }`: which of the frozen five flow in/out
 * - `cost` — expected tokens/usd/latency (CostProfile)
 * - `tier` — current authority tier (spec §3.2)
 * - `promotion?` — the EvidenceThreshold that earns the next tier
 * - `claims` — backing evidence (ClaimRef[]); empty = experimental
 * - `maturity` — `experimental | stable`
 * - `modelTier?` — the declared model tier (spec §8.4: cheap | frontier); the
 *   SINGLE source of truth for tiered-adapter routing. Omitted by manifests
 *   that make no model call.
 */
export const ManifestSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  kind: ManifestKindSchema,
  capabilities: z.array(CapabilitySchema),
  contracts: z.strictObject({
    consumes: z.array(ContractRefSchema),
    emits: z.array(ContractRefSchema),
  }),
  cost: CostProfileSchema,
  tier: TierSchema,
  promotion: EvidenceThresholdSchema.optional(),
  claims: z.array(ClaimRefSchema),
  maturity: MaturitySchema,
  modelTier: ModelTierSchema.optional(),
});

/** Inferred Manifest type — see {@link ManifestSchema}. */
export type Manifest = z.infer<typeof ManifestSchema>;
