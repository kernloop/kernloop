/**
 * The `api`-kind adapter as DATA (spec §8.4: each adapter "declares its
 * tier→model map, effort support, and capabilities as data, so a new harness
 * is a definition, not a code path"). Unlike the five CLI adapters, an api
 * adapter is CONFIGURED, not hardcoded — the user registers endpoints in the
 * overlay and the composition root builds an {@link ApiAdapterDefinition} from
 * that config. The definition NEVER holds a key: only the NAME of the env var
 * the key is read from at call time (spec §3.1 secret hygiene).
 *
 * The tier→model resolution and effort resolution reuse the kernel's pure
 * translation seam (`resolveTierModel` / `resolveEffort`), exactly like a CLI
 * adapter — the api kind differs only in `effort.via: 'body'` (a
 * `reasoning_effort` body field) versus a CLI arg.
 *
 * @module kernel/adapters/api-config
 */
import type { Effort, ModelCapability, ModelTier } from '@kernloop/contracts';
import type { AdapterEffortProfile } from './definitions.js';

/** The effort body field every OpenAI-compatible endpoint uses (spec §8.4). */
export const API_EFFORT_PARAM = 'reasoning_effort';

/**
 * One OpenAI-compatible HTTP endpoint, declared as data. `apiKeyEnv` is the
 * NAME of an environment variable — the key VALUE is read from the env at call
 * time and is NEVER stored here, logged, or surfaced. `tierBinding` maps a
 * {@link ModelTier} to a CONCRETE model id the endpoint serves; `effort`
 * carries a `via: 'body'` profile (the `reasoning_effort` field). `maxUsdPerCall`
 * is an optional fail-closed per-call spend cap (spec §3.1 spend ceiling).
 */
export interface ApiAdapterDefinition {
  /** Endpoint id (the key in the overlay's `endpoints` block). */
  readonly name: string;
  /** Always `'api'` — the kind discriminator (spec §8.4). */
  readonly kind: 'api';
  /** Endpoint origin; the fixed `/chat/completions` path is appended by invoke. */
  readonly baseUrl: string;
  /** The NAME of the env var the bearer key is read from at call time. */
  readonly apiKeyEnv: string;
  /** Extra static headers (e.g. an OpenRouter `HTTP-Referer`); never a secret. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Tier → CONCRETE model id this endpoint serves (spec §8.4). */
  readonly tierBinding: Partial<Record<ModelTier, string>>;
  /** Effort profile (`reasoning_effort` body field), or omitted to drop effort. */
  readonly effort?: AdapterEffortProfile;
  /** Model capabilities this endpoint advertises (spec §8.4). */
  readonly capabilities: readonly ModelCapability[];
  /** True when the endpoint reports per-call USD cost (OpenRouter `usage.cost`). */
  readonly metersUsd: boolean;
  /** Optional fail-closed per-call USD cap (spec §3.1 spend ceiling). */
  readonly maxUsdPerCall?: number;
}

/** The default effort levels for an OpenAI-compatible endpoint (identity map). */
export const API_EFFORT_LEVELS: Partial<Record<Effort, string>> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
};

/** The default `reasoning_effort` body profile (spec §8.4 `via: 'body'`). */
export const API_EFFORT_PROFILE: AdapterEffortProfile = {
  param: API_EFFORT_PARAM,
  via: 'body',
  levels: API_EFFORT_LEVELS,
};
