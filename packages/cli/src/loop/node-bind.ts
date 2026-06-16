/**
 * Per-node model-seam binding [CLM-0078, CLM-0085] — the composition root choice
 * of WHICH adapter (a CLI name or a registered api endpoint id) serves each
 * model-calling loop node, and the metered invoke bound to it.
 *
 * For each node: derive its {@link ModelRequirement} from its single source
 * (template/manifest), apply any overlay per-node tier/effort override, pick the
 * adapter that serves its tier (`overlay.adapters[tier]`, else the run adapter),
 * resolve the served model+effort through the kernel translation seam, and bind a
 * metered invoke carrying that provenance. A registered ENDPOINT id binds the
 * kernel api invoke (the one direct network model call, metered into the run
 * budget); a CLI name binds the subprocess invoke. With NO `adapters` block AND
 * no overrides, every node binds the run adapter at its declared tier alias — the
 * backward-compat guarantee. Seams are cached per node.
 *
 * Enforcement-point note (honesty): this lives at the LOOP composition root, not
 * the Router — see node-model.ts.
 */
import type { AdapterName } from '@kernloop/kernel';
import type { ModelRequirement } from '@kernloop/contracts';
import { adapterInvoke, type LoopInvoke, type RunTotals } from './invoke.js';
import {
  DEFAULT_INVOKE_TIMEOUT_MS,
  invokeTimeoutForNode,
  nodeRequirement,
  type TieredNode,
} from './node-model.js';
import { buildNodeSeam, resolveServed, type NodeSeam } from './node-seam.js';
import { buildApiNodeSeam, resolveServedApi } from './api-seam.js';
import { apiDefinitionFor } from '../endpoints.js';
import { requirementForNode, type Overlay } from '../overlay.js';
import { applyDowngrade, type BudgetDowngrade, type OnDowngrade } from './downgrade.js';

/** The node's requirement from its single source + overlay override (pre-downgrade). */
function baseReq(overlay: Overlay, node: TieredNode): ModelRequirement {
  return requirementForNode(overlay, node, nodeRequirement(node));
}

/** Resolve the budget-downgrade context from the overlay + run budget, or undefined (#194). */
function downgradeFor(
  overlay: Overlay,
  budget: BudgetDowngrade['budget'] | undefined,
): BudgetDowngrade | undefined {
  return overlay.downgrade !== undefined && budget !== undefined
    ? { atSpendFraction: overlay.downgrade.atSpendFraction, budget }
    : undefined;
}

/**
 * Wrap a per-path seam `build(req, node)` with the cache-or-downgrade policy:
 * with NO downgrade configured, seams are cached per node (byte-identical to
 * before); with a downgrade, the requirement is re-resolved against CURRENT
 * spend each call, so a node that runs after the spend threshold binds the lower
 * tier (#194). Cache bypass is necessary — a cached seam would freeze the tier.
 */
function seamFactory(
  build: (req: ModelRequirement, node: TieredNode) => NodeSeam,
  overlay: Overlay,
  totals: RunTotals,
  dg: BudgetDowngrade | undefined,
  onDowngrade: OnDowngrade | undefined,
): (node: TieredNode) => NodeSeam {
  const cache = new Map<TieredNode, NodeSeam>();
  return (node) => {
    if (dg !== undefined) {
      return build(applyDowngrade(node, baseReq(overlay, node), totals, dg, onDowngrade), node);
    }
    let seam = cache.get(node);
    if (seam === undefined) {
      seam = build(baseReq(overlay, node), node);
      cache.set(node, seam);
    }
    return seam;
  };
}

/**
 * Resolve which adapter (CLI name or registered endpoint id) serves a tier: the
 * overlay's per-tier choice, else the run adapter. A string so an endpoint id is
 * carried as faithfully as a CLI name; the caller branches on whether it is a
 * registered endpoint.
 */
function resolveTierAdapterName(
  tier: ModelRequirement['tier'],
  overlay: Overlay,
  runAdapter: AdapterName,
): string {
  return overlay.adapters?.[tier] ?? runAdapter;
}

/**
 * Build the per-node DEFAULT model seam — CLI or api endpoint, both metered.
 * With `budget` + an overlay `downgrade`, nodes past the spend threshold route a
 * tier lower (#194); `onDowngrade` audits each drop.
 */
export function buildInvokeForNode(
  runAdapter: AdapterName,
  overlay: Overlay,
  totals: RunTotals,
  budget?: BudgetDowngrade['budget'],
  onDowngrade?: OnDowngrade,
): (node: TieredNode) => NodeSeam {
  const timeoutBase = overlay.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
  const build = (req: ModelRequirement, node: TieredNode): NodeSeam => {
    const name = resolveTierAdapterName(req.tier, overlay, runAdapter);
    const endpoint = overlay.endpoints[name];
    const timeoutMs = invokeTimeoutForNode(node, timeoutBase);
    return endpoint === undefined
      ? buildNodeSeam(
          resolveServed(req, name as AdapterName),
          adapterInvoke(name as AdapterName),
          totals,
          timeoutMs,
        )
      : buildApiNodeSeam(req, apiDefinitionFor(name, endpoint), totals, undefined, timeoutMs);
  };
  return seamFactory(build, overlay, totals, downgradeFor(overlay, budget), onDowngrade);
}

/**
 * Per-node seams for an INJECTED invoke (tests script the model CLI/API; the MCP
 * sampling run injects {@link samplingInvoke} here, #135). Every node routes
 * through the one injected `base`, but the node's served model + effort are still
 * resolved against whatever serves its tier — a CLI adapter or a registered
 * endpoint — so provenance records what each node requested even though one seam
 * answers them all. The per-node invoke timeout (#127) is bound here too, so a
 * slow host model on the sampling path gets the node's real budget instead of the
 * MCP SDK's 60s request default (#142).
 */
export function injectedSeamFor(
  runAdapter: AdapterName,
  overlay: Overlay,
  base: LoopInvoke,
  totals: RunTotals,
  budget?: BudgetDowngrade['budget'],
  onDowngrade?: OnDowngrade,
): (node: TieredNode) => NodeSeam {
  const timeoutBase = overlay.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
  const build = (req: ModelRequirement, node: TieredNode): NodeSeam => {
    const name = resolveTierAdapterName(req.tier, overlay, runAdapter);
    const endpoint = overlay.endpoints[name];
    const served =
      endpoint === undefined
        ? resolveServed(req, name as AdapterName)
        : resolveServedApi(req, apiDefinitionFor(name, endpoint));
    // Per-node model-call budget (#127/#142): the configured base, capped per
    // node — bound here so MCP sampling honors it, not the SDK's 60s default.
    return buildNodeSeam(served, base, totals, invokeTimeoutForNode(node, timeoutBase));
  };
  return seamFactory(build, overlay, totals, downgradeFor(overlay, budget), onDowngrade);
}
