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
import { adapterInvoke, type LoopInvoke } from './invoke.js';
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

/** Build the per-node DEFAULT model seam — CLI or api endpoint, both metered. */
export function buildInvokeForNode(
  runAdapter: AdapterName,
  overlay: Overlay,
  totals: { tokens: number; usd: number },
): (node: TieredNode) => NodeSeam {
  const cache = new Map<TieredNode, NodeSeam>();
  return (node) => {
    let seam = cache.get(node);
    if (seam === undefined) {
      const req = requirementForNode(overlay, node, nodeRequirement(node));
      const name = resolveTierAdapterName(req.tier, overlay, runAdapter);
      const endpoint = overlay.endpoints[name];
      // Per-node model-call budget (#127): the configured base, capped per node.
      const base = overlay.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
      const timeoutMs = invokeTimeoutForNode(node, base);
      seam =
        endpoint === undefined
          ? buildNodeSeam(
              resolveServed(req, name as AdapterName),
              adapterInvoke(name as AdapterName),
              totals,
              timeoutMs,
            )
          : buildApiNodeSeam(req, apiDefinitionFor(name, endpoint), totals, undefined, timeoutMs);
      cache.set(node, seam);
    }
    return seam;
  };
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
  totals: { tokens: number; usd: number },
): (node: TieredNode) => NodeSeam {
  const cache = new Map<TieredNode, NodeSeam>();
  return (node) => {
    let seam = cache.get(node);
    if (seam === undefined) {
      const req = requirementForNode(overlay, node, nodeRequirement(node));
      const name = resolveTierAdapterName(req.tier, overlay, runAdapter);
      const endpoint = overlay.endpoints[name];
      const served =
        endpoint === undefined
          ? resolveServed(req, name as AdapterName)
          : resolveServedApi(req, apiDefinitionFor(name, endpoint));
      // Per-node model-call budget (#127/#142): the configured base, capped per
      // node — bound on the injected path so MCP sampling honors it, not the
      // SDK's 60s createMessage default.
      const timeoutMs = invokeTimeoutForNode(
        node,
        overlay.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS,
      );
      seam = buildNodeSeam(served, base, totals, timeoutMs);
      cache.set(node, seam);
    }
    return seam;
  };
}
