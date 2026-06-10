/**
 * @kernloop/faculty-workforce — Layer 2 workforce faculty (spec §5.4).
 *
 * Agents are configuration, not generation: five shipped templates (PM,
 * Coder, Reviewer, Documenter, Researcher) instantiate as agentTemplate
 * Manifests (CLM-0040), and PM plan decomposition is mechanically enforced
 * under the budget-sum invariant (CLM-0041). This package contains no model
 * calls — generative work happens through an invoke function injected by
 * the composition root. It imports only @kernloop/contracts and external
 * dependencies (constitutional rule 5).
 */
export {
  AgentTemplateSchema,
  ModelTierSchema,
  MODEL_TIER_COST,
  SHIPPED_TEMPLATES,
  SHIPPED_TEMPLATE_NAMES,
} from './templates.js';
export type { AgentTemplate, ModelTier, ShippedTemplateName } from './templates.js';
export { instantiateAgent, InstantiateOptionsSchema, WORKFORCE_VERSION } from './instantiate.js';
export type { InstantiateOptions } from './instantiate.js';
export { decomposePlan, SubtaskSpecSchema } from './decompose.js';
export type { SubtaskSpec, DecomposePlanInput } from './decompose.js';
export { BudgetExceededError, InvalidParentError, InvalidSubtaskError } from './errors.js';
export type { BudgetDimension } from './errors.js';
export { workforceManifest } from './manifest.js';
