/**
 * Kernel Router (spec §3.1) — public surface of the router module.
 *
 * @module kernel/router
 */

export {
  Router,
  RouterError,
  EXPLORATION_EPSILON,
  NEUTRAL_FITNESS_PRIOR,
  type RouterErrorCode,
  type RouterDeps,
  type RouteRequest,
  type RoutingDecision,
  type CandidateEvaluation,
  type IneligibilityReason,
} from './router.js';
