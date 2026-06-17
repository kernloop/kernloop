/**
 * `kernloop models sync` / `models list` [CLM-0086, CLM-0087, CLM-0088] — the
 * CLI surface of model discovery (spec §5.7). These are CLI VERBS, NOT MCP
 * tools: the kernel eleven (spec §3.4) stay frozen; depth ships as a verb, never
 * tool #12.
 *
 * `models sync` enumerates every registered overlay `endpoints` entry (via the
 * kernel `discoverApiModels`, key read env-only at call time) plus a local
 * ollama daemon if it answers (`discoverOllamaModels`, no secret) plus each
 * agent-CLI adapter's DECLARED tier-bindings (`cli:<name>`, a pure static read —
 * no network, no subprocess, #171) plus a LIVE model-list probe for a
 * list-exposing CLI (opencode) via a bounded subprocess (`cli-live:<adapter>`,
 * `discoverCliModels`, #131/CLM-0131), normalizes the served ids through
 * `@kernloop/faculty-models` (`mergeDiscovered`), and REPLACES each source's set
 * in the machine-local discovered cache. It audits a `cli.models.sync` event
 * carrying source ids + counts — NEVER the key.
 *
 * HONESTY (prime directive):
 *  - per-source FAILURE ISOLATION: a source that fails (no key, unreachable,
 *    malformed) is reported as failed for THAT source with a reason; the others
 *    proceed. A failed source's PRIOR discovered set is left untouched, never
 *    wiped to look "empty" and never fabricated.
 *  - REPLACE-on-resync: a successful sync replaces the source's set, so a model
 *    that vanished from the endpoint does not persist as available.
 *  - the key never reaches the audit, the result, or stdout (the kernel adapter
 *    scrubs every surfaced string; this layer never reads the key at all).
 *
 * `models list` prints the MERGED catalog (vendored + discovered) with each
 * row's id, family/generation/tier, and `resolvedBy`, and states the discovered
 * cache's freshness per source honestly (when each was last synced).
 *
 * @module cli/tools/models
 */
import { writeFileSync } from 'node:fs';
import {
  appendEvent,
  adapterDefinitions,
  discoverApiModels,
  discoverOllamaModels,
  discoverCliModels,
  CLI_DISCOVERY_ADAPTERS,
  DEFAULT_OLLAMA_HOST,
  type SubprocessResult,
  type SubprocessSpec,
} from '@kernloop/kernel';
import {
  catalog,
  loadDiscoveredCache,
  mergeDiscovered,
  upsertSource,
  type DiscoveredCache,
  type ModelIdentity,
} from '@kernloop/faculty-models';
import { apiDefinitionFor } from '../endpoints.js';
import type { Kernloop } from '../kernel.js';

/**
 * The agent-CLI adapters whose DECLARED tier-bindings `models sync` records as a
 * `cli:<name>` source (spec §8.4): a harness-routed adapter (`claude`/`gemini`)
 * maps each tier to a served alias, so the catalog learns what the harness will
 * route to with NO network and NO subprocess — the adapter's own declared
 * routing, recorded verbatim. `ollama` is excluded (it has its own live daemon
 * probe); a concrete-id adapter with no bindings (`codex`) honestly contributes
 * an empty set. These are NOT a live model-list enumeration (an opencode-style
 * `/v1/models`-equivalent probe is a separate, subprocess-gated transport).
 */
const CLI_AGENT_ADAPTERS = ['claude', 'codex', 'gemini', 'opencode'] as const;

/** One source's sync outcome — honest about whether it succeeded and why not. */
export interface SourceSyncResult {
  /** Source id (an endpoint id, `ollama`, `cli:<adapter>`, or `cli-live:<adapter>`). */
  readonly source: string;
  /** `'api'`, `'ollama'`, `'cli'` (declared binding), or `'cli-live'` (probed list, #131). */
  readonly kind: 'api' | 'ollama' | 'cli' | 'cli-live';
  /** True when the source answered and its set was replaced in the cache. */
  readonly ok: boolean;
  /** Models the source returned (only meaningful when `ok`). */
  readonly discovered: number;
  /** Of `discovered`, how many normalized by the vendored catalog (resolvedBy table). */
  readonly catalogued: number;
  /** Why the source failed (typed error name + message), key-free; null when ok. */
  readonly error: string | null;
}

/** The whole `models sync` outcome. */
export interface ModelsSyncResult {
  /** Absolute path of the discovered cache that was written. */
  readonly cache: string;
  /** ISO timestamp the cache was stamped with (the CLI clock). */
  readonly syncedAt: string;
  /** Per-source outcomes, in the order they were attempted. */
  readonly sources: readonly SourceSyncResult[];
}

/** Options for {@link modelsSyncTool} — the ollama host is injectable for tests. */
export interface ModelsSyncOptions {
  /** Override the ollama host (tests point it at a mock; default the local daemon). */
  readonly ollamaHost?: string;
  /** Skip the ollama probe entirely (e.g. when the operator runs no local daemon). */
  readonly skipOllama?: boolean;
  /** Skip the agent-CLI tier-binding sources (claude/codex/gemini/opencode). */
  readonly skipCliAdapters?: boolean;
  /** Skip the LIVE agent-CLI model-list probe (opencode); spawns a subprocess (#131). */
  readonly skipCliLive?: boolean;
  /** Injectable subprocess runner for the live CLI probe (tests script the CLI). */
  readonly cliRun?: (spec: SubprocessSpec) => Promise<SubprocessResult>;
}

/** The error's typed name + message, with no chance of a key (the adapter scrubs). */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Count how many normalized identities resolved by the vendored catalog (table). */
function countCatalogued(models: readonly ModelIdentity[]): number {
  return models.filter((m) => m.resolvedBy === 'table').length;
}

/** Discover one api endpoint, normalize, and replace its set; failure is isolated. */
async function syncApiSource(
  kern: Kernloop,
  cache: DiscoveredCache,
  id: string,
  syncedAt: string,
): Promise<{ cache: DiscoveredCache; result: SourceSyncResult }> {
  const endpoint = kern.config.endpoints[id];
  // endpoint is always defined (we iterate the parsed map), but stay total.
  if (endpoint === undefined) {
    return { cache, result: failure(id, 'api', 'Error: endpoint not registered') };
  }
  try {
    const ids = await discoverApiModels(apiDefinitionFor(id, endpoint));
    const models = mergeDiscovered(catalog, ids);
    return {
      cache: upsertSource(cache, id, models, syncedAt),
      result: {
        source: id,
        kind: 'api',
        ok: true,
        discovered: models.length,
        catalogued: countCatalogued(models),
        error: null,
      },
    };
  } catch (error) {
    return { cache, result: failure(id, 'api', describeError(error)) };
  }
}

/** Discover the local ollama daemon, normalize, and replace its set; failure isolated. */
async function syncOllamaSource(
  cache: DiscoveredCache,
  host: string,
  syncedAt: string,
): Promise<{ cache: DiscoveredCache; result: SourceSyncResult }> {
  try {
    const ids = await discoverOllamaModels(host);
    const models = mergeDiscovered(catalog, ids);
    return {
      cache: upsertSource(cache, 'ollama', models, syncedAt),
      result: {
        source: 'ollama',
        kind: 'ollama',
        ok: true,
        discovered: models.length,
        catalogued: countCatalogued(models),
        error: null,
      },
    };
  } catch (error) {
    return { cache, result: failure('ollama', 'ollama', describeError(error)) };
  }
}

/**
 * Live-probe one agent-CLI adapter's enumerable model list (#131) via the
 * bounded kernel {@link discoverCliModels} (fixed `<adapter> models` argv, no
 * shell, capture-capped, timeout-bounded), normalize through the vendored
 * catalog, and REPLACE the `cli-live:<adapter>` source. An absent/failed CLI is
 * recorded as an honest failure (the declared `cli:<adapter>` binding still
 * stands); the probe is never a fabricated list.
 */
async function syncCliLiveSource(
  cache: DiscoveredCache,
  adapter: string,
  syncedAt: string,
  run: ModelsSyncOptions['cliRun'],
): Promise<{ cache: DiscoveredCache; result: SourceSyncResult }> {
  const source = `cli-live:${adapter}`;
  try {
    const ids = await discoverCliModels(adapter, run);
    const models = mergeDiscovered(catalog, ids);
    return {
      cache: upsertSource(cache, source, models, syncedAt),
      result: {
        source,
        kind: 'cli-live',
        ok: true,
        discovered: models.length,
        catalogued: countCatalogued(models),
        error: null,
      },
    };
  } catch (error) {
    return { cache, result: failure(source, 'cli-live', describeError(error)) };
  }
}

/** A failed source result — prior cache set is left untouched (not wiped). */
function failure(
  source: string,
  kind: 'api' | 'ollama' | 'cli-live',
  error: string,
): SourceSyncResult {
  return { source, kind, ok: false, discovered: 0, catalogued: 0, error };
}

/**
 * Record each agent-CLI adapter's DECLARED tier-bindings as a `cli:<name>` source
 * (#131) — the harness's own routing, normalized through the vendored catalog.
 * Pure static read: no network, no subprocess, no key. An adapter with no
 * non-empty binding yields an honest empty set (REPLACE clears any stale rows).
 */
function syncCliBindings(
  cache: DiscoveredCache,
  syncedAt: string,
): { cache: DiscoveredCache; results: SourceSyncResult[] } {
  const results: SourceSyncResult[] = [];
  for (const name of CLI_AGENT_ADAPTERS) {
    const aliases = [...new Set(Object.values(adapterDefinitions[name].tierBinding))].filter(
      (alias) => alias !== '',
    );
    const models = mergeDiscovered(catalog, aliases);
    cache = upsertSource(cache, `cli:${name}`, models, syncedAt);
    results.push({
      source: `cli:${name}`,
      kind: 'cli',
      ok: true,
      discovered: models.length,
      catalogued: countCatalogued(models),
      error: null,
    });
  }
  return { cache, results };
}

/**
 * `kernloop models sync` [CLM-0088]: discover every registered endpoint + ollama,
 * normalize, REPLACE each source's discovered set in the machine-local cache,
 * write it, and audit the run (source ids + counts, never the key). Per-source
 * failure is isolated; a failed source keeps its prior set. Returns the
 * per-source summary. Network happens here (the kernel adapters); this layer
 * never reads the key.
 */
export async function modelsSyncTool(
  kern: Kernloop,
  options: ModelsSyncOptions = {},
): Promise<ModelsSyncResult> {
  const syncedAt = kern.store.clock().toISOString();
  let cache = loadDiscoveredCache(kern.paths.modelsCache, syncedAt);
  const results: SourceSyncResult[] = [];
  for (const id of Object.keys(kern.config.endpoints)) {
    const step = await syncApiSource(kern, cache, id, syncedAt);
    cache = step.cache;
    results.push(step.result);
  }
  if (options.skipOllama !== true) {
    const step = await syncOllamaSource(cache, options.ollamaHost ?? DEFAULT_OLLAMA_HOST, syncedAt);
    cache = step.cache;
    results.push(step.result);
  }
  if (options.skipCliLive !== true) {
    for (const adapter of CLI_DISCOVERY_ADAPTERS) {
      const step = await syncCliLiveSource(cache, adapter, syncedAt, options.cliRun);
      cache = step.cache;
      results.push(step.result);
    }
  }
  if (options.skipCliAdapters !== true) {
    const step = syncCliBindings(cache, syncedAt);
    cache = step.cache;
    results.push(...step.results);
  }
  writeFileSync(kern.paths.modelsCache, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  appendEvent(kern.store, {
    type: 'cli.models.sync',
    payload: {
      syncedAt,
      sources: results.map((r) => ({
        source: r.source,
        kind: r.kind,
        ok: r.ok,
        discovered: r.discovered,
        catalogued: r.catalogued,
        ...(r.error === null ? {} : { error: r.error }),
      })),
    },
  });
  return { cache: kern.paths.modelsCache, syncedAt, sources: results };
}

/** One row of the merged catalog `models list` prints. */
export interface ModelsListRow {
  /** The served alias/id this row names. */
  readonly id: string;
  /** Provenance of THIS row: `vendored` (committed snapshot) or `discovered`. */
  readonly origin: 'vendored' | 'discovered';
  readonly family: string;
  readonly generation: string;
  readonly tier: ModelIdentity['tier'];
  /** How the identity was resolved (table | rule | unknown). */
  readonly resolvedBy: ModelIdentity['resolvedBy'];
  /** For a discovered row, which source served it; null for a vendored row. */
  readonly source: string | null;
  /** For a discovered row, when its source was last synced; null for vendored. */
  readonly syncedAt: string | null;
}

/** The `models list` outcome — the merged catalog + the cache's freshness. */
export interface ModelsListResult {
  /** The vendored snapshot's pin date (provenance of the committed rows). */
  readonly vendoredSnapshot: string;
  /** The discovered cache's last-write stamp, or null when no cache exists yet. */
  readonly discoveredSnapshot: string | null;
  /** The merged rows: every vendored entry, then every discovered entry. */
  readonly models: readonly ModelsListRow[];
}

/** Build the vendored rows from the committed catalog (always resolvedBy table). */
function vendoredRows(): ModelsListRow[] {
  return Object.entries(catalog.models).map(([id, e]) => ({
    id,
    origin: 'vendored',
    family: e.family,
    generation: e.generation,
    tier: e.tier,
    resolvedBy: 'table',
    source: null,
    syncedAt: null,
  }));
}

/** Build the discovered rows from the cache, carrying per-source freshness. */
function discoveredRows(cache: DiscoveredCache): ModelsListRow[] {
  const rows: ModelsListRow[] = [];
  for (const [source, entry] of Object.entries(cache.sources)) {
    for (const m of entry.models) {
      rows.push({
        id: m.raw,
        origin: 'discovered',
        family: m.family,
        generation: m.generation,
        tier: m.tier,
        resolvedBy: m.resolvedBy,
        source,
        syncedAt: entry.syncedAt,
      });
    }
  }
  return rows;
}

/**
 * `kernloop models list` [CLM-0088]: print the merged catalog — every vendored
 * entry plus every discovered entry — each row naming id, family/generation/tier,
 * `resolvedBy`, and (for discovered rows) the source + when it was last synced,
 * so the cache's freshness is stated honestly. Read-only; no network, no audit.
 * A missing cache simply yields no discovered rows.
 */
export function modelsListTool(kern: Kernloop): ModelsListResult {
  const cache = loadDiscoveredCache(kern.paths.modelsCache, kern.store.clock().toISOString());
  const hasCache = Object.keys(cache.sources).length > 0;
  return {
    vendoredSnapshot: catalog.snapshot,
    discoveredSnapshot: hasCache ? cache.snapshot : null,
    models: [...vendoredRows(), ...discoveredRows(cache)],
  };
}
