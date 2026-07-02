/**
 * Endpoint-diverse (per-MODEL) ratification voting (#509) — the composition-root
 * plumbing that, for an ENDPOINT-ONLY run (no CLI adapter to diversify across,
 * #392), convenes a panel-7 across the DISTINCT chat models the endpoint serves
 * (discovered via `/v1/models`, [CLM-0086]) instead of one model role-playing N
 * personas. Each voter is pinned to a distinct discovered model on the SAME
 * endpoint (enabled by #510's per-invocation model pin); the round-robin assignment
 * is SHARED with the cross-adapter panel (vote-diversity.ts), not forked.
 *
 * HONESTY IS LOAD-BEARING (the reason this feature exists). Models behind ONE
 * endpoint share a provider, infrastructure, safety/filter stack, availability, and
 * likely base-model families — their failures are CORRELATED. This is model-NAME
 * diversity WITHIN ONE ORACLE, NOT cross-provider independence: it does NOT close
 * the single-oracle gap [CLM-0164], and it never feeds the #348 parity independence
 * precondition. {@link modelDiverseFindings} MEASURES inter-voter disagreement and
 * surfaces it — plus the correlated-oracle caveat — as VISIBLE Verdict Findings, and
 * states that NEITHER high nor low disagreement establishes independence (the metric
 * is a divergence signal, not an independence measurement). Cross-provider voting
 * (an external panel / a disjoint-family native panel) stays THE real diversity path.
 * @module cli/loop/vote-model-diversity
 */
import type { Finding, ModelIdentity, Verdict } from '@kernloop/contracts';
import { apiDefinitionFor } from '../endpoints.js';
import { requirementForNode, type Overlay } from '../overlay.js';
import type { DiscoveredCache } from '@kernloop/faculty-models';
import { apiInvoke } from './api-seam.js';
import { buildNodeSeam, type NodeSeam, type ServedModel } from './node-seam.js';
import {
  DEFAULT_INVOKE_TIMEOUT_MS,
  invokeTimeoutForNode,
  isReasoningNode,
  nodeRequirement,
} from './node-model.js';
import type { ModelFitnessWiring } from './node-bind.js';
import type { RunTotals } from './invoke.js';

/**
 * Model ids that are NOT chat/completions models — embeddings, moderation, audio
 * (whisper/tts/transcribe), image (dall-e/diffusion), and rerankers. `/v1/models`
 * returns EVERY served model, so a panel seeded from it must reject these before
 * building voters — a non-chat model yields a broken/empty ballot that would
 * pollute the disagreement metric (the security round's HIGH-risk finding). The
 * match is a conservative substring reject-list over the served id; anything not
 * matched (chat + vision-chat) is kept, and every DROP is audited (never silent). A
 * denylist is inherently incomplete — a slipped-through non-chat model becomes a
 * `voter_error:` abstain (excluded from the metric), not false independence; a
 * positive chat-capability signal is the follow-up (#528).
 */
const NON_CHAT_ID_PATTERNS = [
  // embeddings (OpenAI + common OSS/other-provider families)
  'embed',
  'bge-',
  'gte-',
  'e5-',
  'voyage',
  'jina',
  'colbert',
  'nomic',
  // moderation / classification
  'moderation',
  'rerank',
  'reranker',
  // audio (speech-to-text, text-to-speech)
  'whisper',
  'tts',
  'text-to-speech',
  'transcribe',
  'bark',
  'musicgen',
  'kokoro',
  // image / multimodal generation, not chat/completions
  'dall-e',
  'dalle',
  'stable-diffusion',
  'sdxl',
  'clip',
];

/** True when a discovered model id looks like a chat/completions model (not an
 * embedding/moderation/audio/image/rerank model). Conservative: an ambiguous id
 * that matches a non-chat pattern is dropped (a broken voter is worse than a
 * smaller panel). */
export function isChatCapableModel(id: ModelIdentity): boolean {
  const raw = id.raw.toLowerCase();
  return !NON_CHAT_ID_PATTERNS.some((p) => raw.includes(p));
}

/** Partition an endpoint's discovered models into chat-capable (stable-sorted by
 * id, for a deterministic round-robin) and dropped (non-chat, audited). Reads the
 * per-source catalog `models sync` populated for this endpoint id; a missing/unsynced
 * source yields empty. */
export function endpointChatModels(
  discovered: DiscoveredCache,
  endpointId: string,
): { chat: ModelIdentity[]; dropped: ModelIdentity[] } {
  const all = Object.hasOwn(discovered.sources, endpointId)
    ? (discovered.sources[endpointId]?.models ?? [])
    : [];
  const chat: ModelIdentity[] = [];
  const dropped: ModelIdentity[] = [];
  for (const m of all) (isChatCapableModel(m) ? chat : dropped).push(m);
  chat.sort((a, b) => a.raw.localeCompare(b.raw));
  return { chat, dropped };
}

/** The per-model diverse panel for one endpoint-only run: the chat models to
 * round-robin voters across, the dropped non-chat models (audited), and a seam
 * builder that pins a specific model on the endpoint. */
export interface ModelDiversity {
  readonly endpointId: string;
  readonly models: readonly ModelIdentity[];
  readonly dropped: readonly ModelIdentity[];
  readonly seamForModel: (model: ModelIdentity) => NodeSeam;
}

/** Build a vote NodeSeam that PINS `model` on endpoint `def` — a hand-built
 * ServedModel (no tier resolution) whose `.model` reaches `invokeApiAdapter`'s
 * `options.model`, so the voter calls exactly this discovered model. Effort is not
 * pinned per-voter (uniform, out of #509 scope); the vote node is tool-free (#148). */
function buildVoteSeamForModel(
  def: ReturnType<typeof apiDefinitionFor>,
  model: ModelIdentity,
  req: ReturnType<typeof requirementForNode>,
  timeoutMs: number,
  totals: RunTotals,
  hooks: ModelFitnessWiring,
): NodeSeam {
  const served: ServedModel = {
    adapter: def.name,
    model: model.raw,
    requestedTier: req.tier,
    servedTier: req.tier,
    degraded: false,
    requestedEffort: req.effort,
    servedEffort: req.effort,
    effortClamped: false,
    effortArg: undefined,
  };
  return buildNodeSeam(served, apiInvoke(def), totals, timeoutMs, hooks, isReasoningNode('vote'));
}

/**
 * Assemble the {@link ModelDiversity} for an endpoint-only run, or undefined when
 * it does not apply: the run adapter must be a REGISTERED endpoint with ≥2
 * chat-capable discovered models. <2 chat models ⇒ undefined (the caller keeps the
 * honest single-oracle audit).
 */
export function buildModelDiversity(
  overlay: Overlay,
  runAdapter: string,
  discovered: DiscoveredCache,
  totals: RunTotals,
  fitness: ModelFitnessWiring = {},
): ModelDiversity | undefined {
  if (!Object.hasOwn(overlay.endpoints, runAdapter)) return undefined;
  const config = overlay.endpoints[runAdapter];
  if (config === undefined) return undefined;
  const { chat, dropped } = endpointChatModels(discovered, runAdapter);
  if (chat.length < 2) return undefined;
  const def = apiDefinitionFor(runAdapter, config);
  const req = requirementForNode(overlay, 'vote', nodeRequirement('vote'));
  const timeoutMs = invokeTimeoutForNode(
    'vote',
    overlay.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS,
  );
  const hooks: ModelFitnessWiring = {
    ...(fitness.discovered === undefined ? {} : { discovered: fitness.discovered }),
    ...(fitness.onModelCall === undefined ? {} : { onModelCall: fitness.onModelCall }),
  };
  return {
    endpointId: runAdapter,
    models: chat,
    dropped,
    seamForModel: (model) => buildVoteSeamForModel(def, model, req, timeoutMs, totals, hooks),
  };
}

/** Round-robin assignment shared by the cross-adapter (#369) and cross-model (#509)
 * panels (voter i → items[i % n]) — one deterministic assignment, not forked. */
export function assignRoundRobin<T>(names: readonly string[], items: readonly T[]): Map<string, T> {
  return new Map(names.map((name, i) => [name, items[i % items.length] as T]));
}

/**
 * The single endpoint-scoped served CLASS every per-model voter's ballot carries
 * (#509 HIGH-1 honesty fix). `provider`/`family`/`generation`/`tier` are UNIFORM, so
 * the faculty's class key ({@link identityKey}) collapses to ONE — faculty-gates
 * therefore correctly sees a SINGLE ORACLE (its single-oracle finding fires, a
 * single-oracle ratification ESCALATES via the distinct-class quorum, correlation
 * fully discounts), NOT N independent providers. `raw` keeps the DISTINCT model id
 * so the divergence metric still attributes ballots per model. Without this collapse
 * the per-model panel would present distinct classes and be mistaken for cross-
 * provider independence — the exact diversity-theater this feature must prevent.
 */
export function endpointOracleIdentity(endpointId: string, seam: NodeSeam): ModelIdentity {
  return {
    provider: `endpoint:${endpointId}`,
    family: `endpoint:${endpointId}`,
    generation: 'endpoint',
    variant: null,
    tier: seam.served.servedTier,
    raw: seam.served.model,
    resolvedBy: 'unknown',
    contextWindow: null,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
  };
}

/**
 * The active per-model diversity for a vote, or undefined. Applies ONLY to a
 * panel-7 RATIFICATION vote of an endpoint-only run (no CLI adapters to diversify:
 * cross-adapter takes precedence) with ≥2 chat models. One decision point, shared by
 * the invoker (routing) and the executor (findings), so they never disagree.
 */
export function activeModelDiversity(
  modelDiverse: ModelDiversity | undefined,
  adapterCount: number,
  isRatification: boolean,
): ModelDiversity | undefined {
  if (!isRatification || adapterCount > 0) return undefined;
  if (modelDiverse === undefined || modelDiverse.models.length < 2) return undefined;
  return modelDiverse;
}

/** Inter-voter disagreement over the vote enum: 0 = unanimous, →1 = maximal split
 * (1 − plurality share). A divergence signal, NOT an independence measurement. */
export function disagreementOf(votes: readonly string[]): number {
  if (votes.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  return 1 - Math.max(...counts.values()) / votes.length;
}

/**
 * The VISIBLE Verdict Findings for a model-diverse panel (#509): the correlated-
 * oracle CAVEAT (warn) and the measured divergence (info). The caveat states the
 * signal is model-NAME diversity within one oracle — NOT independence, NOT closing
 * [CLM-0164] — and that NEITHER high nor low disagreement establishes independence.
 * The metric counts only voters that ACTUALLY balloted (a `voter_error:` abstain is
 * a non-participant, reflected as a shortfall, never silently counted as agreement).
 */
export function modelDiverseFindings(verdict: Verdict, md: ModelDiversity): Finding[] {
  const voters = verdict.voters ?? [];
  const participated = voters.filter((v) => !v.reasoning.startsWith('voter_error:'));
  const disagreement = disagreementOf(participated.map((v) => v.vote));
  const distinctModels = new Set(
    participated.map((v) => v.served?.raw).filter((r): r is string => r !== undefined),
  ).size;
  const failed = voters.length - participated.length;
  const caveat: Finding = {
    severity: 'warn',
    message:
      `Model-diversity within ONE oracle: the ${String(md.models.length)} models served by endpoint ` +
      `"${md.endpointId}" are reached through ONE operator/endpoint (and typically share a provider, ` +
      `infrastructure, and safety/filter stack), so their failures are CORRELATED — even a multi-provider ` +
      `aggregator endpoint is a single point you cannot independently verify. This is model-NAME ` +
      `diversity, NOT cross-provider independence — it does not close ` +
      `the single-oracle gap [CLM-0164], and it does not count toward the #348 parity independence ` +
      `precondition. Neither high nor low inter-voter disagreement establishes independence (the figure ` +
      `below is a divergence signal, not an independence measurement). Cross-provider voting — an external ` +
      `panel or a disjoint-family native panel — remains the real oracle-diversity path.`,
    path: `endpoints.${md.endpointId}`,
  };
  const metric: Finding = {
    severity: 'info',
    message:
      `Endpoint-panel divergence: inter-voter disagreement ${disagreement.toFixed(2)} across ` +
      `${String(participated.length)} ballot(s) from ${String(distinctModels)} distinct model id(s)` +
      `${failed > 0 ? `, ${String(failed)} voter(s) failed to ballot` : ''}. Descriptive only — see the caveat above.`,
  };
  return [caveat, metric];
}
