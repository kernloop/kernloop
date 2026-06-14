/**
 * The MCP-SAMPLING model seam (#135) — kernloop's production model-access path
 * when it runs as an MCP server (`kernloop serve`, spec §3.3). Instead of
 * spawning a model CLI, the loop asks its HOST to run the completion via the
 * MCP `sampling/createMessage` request: kernloop-as-server sends the prompt
 * UP to the host (e.g. Opencode, fronting an OpenAI-compatible provider), the
 * host chooses + serves a model from its OWN logged-in provider, and returns
 * the text. kernloop holds NO model CLI, key, or model choice — the host owns
 * all three (spec §8.4 "models declared elsewhere"; the supply side is the
 * host's).
 *
 * It is bound as the loop's injected {@link LoopInvoke} ONLY when the connected
 * host declared the `sampling` capability ({@link hostSupportsSampling}); a host
 * without it is honestly unable to serve the loop (no silent fallback to a model
 * we do not have). COST is metered as honest ZERO: MCP `CreateMessageResult`
 * carries no token usage, and per project guidance the binding-time constraint
 * is the host plan's weekly/monthly context limits, not per-run USD — so the
 * run does not budget-halt on a cost we cannot observe (recorded, not faked).
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Cost, ModelTier } from '@kernloop/contracts';
import type { LoopInvoke } from './invoke.js';

/** Max tokens requested per sampling completion — a generous default; the host
 * may serve fewer. Loop nodes emit bounded prose/JSON, well under this. */
export const SAMPLING_MAX_TOKENS = 8192;

/** The three MCP `modelPreferences` priorities (0..1) a node's TIER maps to so
 * the HOST routes high/med/low among ITS own models (#140). MCP has only these
 * cost/speed/intelligence axes — there is no `effort` axis, so effort is NOT
 * expressed here (it rides the CLI/api adapter path); inventing one would imply
 * a control the host cannot honor. The ladder is monotone: frontier asks for
 * maximum intelligence (cost/speed irrelevant), small asks for cheap+fast. */
const TIER_PREFERENCES: Readonly<
  Record<ModelTier, { intelligencePriority: number; speedPriority: number; costPriority: number }>
> = {
  frontier: { intelligencePriority: 1, speedPriority: 0, costPriority: 0 },
  large: { intelligencePriority: 0.8, speedPriority: 0.2, costPriority: 0.2 },
  medium: { intelligencePriority: 0.5, speedPriority: 0.5, costPriority: 0.5 },
  small: { intelligencePriority: 0.2, speedPriority: 0.9, costPriority: 0.9 },
};

/**
 * Build the MCP `modelPreferences` a node's call sends UP to the host (#140):
 * the requested TIER as cost/speed/intelligence priorities (the host routes its
 * own high/med/low from them), plus the resolved model alias as an advisory
 * name `hint` [CLM-0108]. Returns undefined when neither is set, so a bare call
 * sends no preference at all. Exported for the test that asserts the map.
 */
export function samplingPreferences(
  tier: ModelTier | undefined,
  hint: string | undefined,
):
  | {
      hints?: Array<{ name: string }>;
      intelligencePriority?: number;
      speedPriority?: number;
      costPriority?: number;
    }
  | undefined {
  const priorities = tier === undefined ? undefined : TIER_PREFERENCES[tier];
  if (priorities === undefined && hint === undefined) return undefined;
  return {
    ...(priorities ?? {}),
    ...(hint === undefined ? {} : { hints: [{ name: hint }] }),
  };
}

/** The connected MCP host did not declare the `sampling` capability, so the loop
 * cannot obtain completions from it — a typed, honest unavailability (no silent
 * fallback to a model kernloop does not hold). */
export class SamplingUnsupportedError extends Error {
  readonly code = 'sampling_unsupported';
  constructor() {
    super('the connected MCP host did not declare the "sampling" capability');
    this.name = 'SamplingUnsupportedError';
  }
}

/** True when the connected MCP host declared the `sampling` capability [CLM-0108]
 * — only then can the loop obtain completions via {@link samplingInvoke}. */
export function hostSupportsSampling(server: Server): boolean {
  return server.getClientCapabilities()?.sampling !== undefined;
}

/**
 * A {@link LoopInvoke} that obtains each completion via MCP SAMPLING from the
 * connected host (#135) [CLM-0108]. The host serves the model; the response text is the
 * loop's output. The per-node REQUESTED tier (`options.tier`) maps to MCP
 * `modelPreferences` cost/speed/intelligence priorities so the host routes its
 * OWN high/med/low model (#140), and the resolved model alias (`options.model`)
 * rides as an advisory name hint — both advisory; the host picks the actual
 * model. `options.timeoutMs` (#127) bounds the round-trip. Throws a
 * {@link SamplingUnsupportedError} when the host did not declare `sampling` (no
 * silent fallback). Cost is honest zero (the host owns usage).
 */
export function samplingInvoke(server: Server, maxTokens = SAMPLING_MAX_TOKENS): LoopInvoke {
  return async (prompt, options = {}) => {
    if (!hostSupportsSampling(server)) throw new SamplingUnsupportedError();
    const hint = options.model !== undefined && options.model !== '' ? options.model : undefined;
    const modelPreferences = samplingPreferences(options.tier, hint);
    const result = await server.createMessage(
      {
        messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
        maxTokens,
        ...(modelPreferences === undefined ? {} : { modelPreferences }),
      },
      options.timeoutMs === undefined ? undefined : { timeout: options.timeoutMs },
    );
    const output = result.content.type === 'text' ? result.content.text : '';
    const cost: Cost = { tokens: 0, usd: 0 };
    return { output, cost };
  };
}
