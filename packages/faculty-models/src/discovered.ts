/**
 * The machine-local DISCOVERED catalog [CLM-0087] — the persistence + lookup
 * side of model discovery (spec §5.7 "Discovery (live `/v1/models`
 * enumeration)"). Where the vendored {@link import('./catalog.js').Catalog} is a
 * reviewed, committed snapshot, the discovered cache is what an endpoint
 * ACTUALLY served on the last `kernloop models sync`, normalized through the
 * SAME pure {@link resolveIdentity} — discovery just feeds the resolver more ids.
 *
 * This module stays PURE and offline by construction: it makes no HTTP call,
 * touches no secret, and has no clock (Date.now is unavailable in this repo —
 * the CLI layer, which has a clock, stamps `syncedAt`/`snapshot` and passes them
 * in). The cache file itself is machine-local and GITIGNORED (like
 * `memory.sqlite`); `kernloop init` excludes it.
 *
 * HONESTY (prime directive):
 *  - the cache records ONLY ids an endpoint actually returned, each carrying its
 *    SOURCE and the time it was synced (provenance);
 *  - a re-sync REPLACES a source's whole set ({@link upsertSource}), so a model
 *    that vanished from the endpoint does NOT silently persist as available;
 *  - a missing or corrupt cache resolves to the EMPTY cache (no discovered
 *    models) — never a crash, never a fabricated model.
 *
 * @module faculty-models/discovered
 */
import { readFileSync } from 'node:fs';
import { ModelIdentitySchema, type ModelIdentity } from '@kernloop/contracts';
import { z } from 'zod';
import type { Catalog } from './catalog.js';
import { resolveIdentity } from './resolve.js';

/** One synced source's discovered set: when it was synced + the normalized ids. */
export const DiscoveredSourceSchema = z.strictObject({
  /** ISO timestamp the CLI stamped at sync time (Date.now is unavailable here). */
  syncedAt: z.string().min(1),
  /** The normalized identities the source served at `syncedAt` (replace-on-resync). */
  models: z.array(ModelIdentitySchema),
});
export type DiscoveredSource = z.infer<typeof DiscoveredSourceSchema>;

/**
 * The whole discovered cache: a snapshot stamp plus a per-source map. The key is
 * the source id (an endpoint id, or `ollama`). Each source carries its own
 * freshness, so `models list` can state honestly when each was last synced.
 */
export const DiscoveredCacheSchema = z.strictObject({
  /** ISO timestamp of the last write (the CLI stamps it); the cache's provenance. */
  snapshot: z.string().min(1),
  /** Source id → its last discovered set. Replace-on-resync (never accumulates). */
  sources: z.record(z.string().min(1), DiscoveredSourceSchema),
});
export type DiscoveredCache = z.infer<typeof DiscoveredCacheSchema>;

/** The empty cache — what a missing/corrupt file degrades to (no discovered models). */
export function emptyDiscoveredCache(snapshot: string): DiscoveredCache {
  return { snapshot, sources: {} };
}

/**
 * Normalize a source's discovered ids into {@link ModelIdentity}s [CLM-0087] by
 * running EACH id through the unchanged, pure {@link resolveIdentity} against the
 * vendored catalog: a vendored table hit yields full metadata, an uncatalogued
 * but well-formed id is rule-parsed, garbage is an honest unknown. Discovery
 * adds ids; it does not change how an id normalizes. De-duplicates by `raw`.
 */
export function mergeDiscovered(
  catalog: Catalog,
  discoveredIds: readonly string[],
): ModelIdentity[] {
  const seen = new Set<string>();
  const out: ModelIdentity[] = [];
  for (const id of discoveredIds) {
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(resolveIdentity(id, catalog));
  }
  return out;
}

/**
 * REPLACE a source's discovered set in the cache, stamping the new snapshot time
 * [CLM-0087] — replace, never merge, so a model the source NO LONGER serves does
 * not persist as available (the honesty guarantee). Returns a new cache (pure).
 */
export function upsertSource(
  cache: DiscoveredCache,
  source: string,
  models: readonly ModelIdentity[],
  syncedAt: string,
): DiscoveredCache {
  return {
    snapshot: syncedAt,
    sources: { ...cache.sources, [source]: { syncedAt, models: [...models] } },
  };
}

/**
 * Load + validate the discovered cache from `file` [CLM-0087]. Defensive: a
 * MISSING file, unreadable file, non-JSON, or a body that fails the zod schema
 * all degrade to the EMPTY cache (stamped with `nowIso`) rather than throwing —
 * a corrupt machine-local cache must never crash the loop or fabricate a model.
 * The single boundary where the on-disk shape is validated.
 */
export function loadDiscoveredCache(file: string, nowIso: string): DiscoveredCache {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return emptyDiscoveredCache(nowIso); // missing / unreadable / non-JSON
  }
  const parsed = DiscoveredCacheSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyDiscoveredCache(nowIso);
}

/**
 * A `raw` id → its discovered {@link ModelIdentity}, flattened across every
 * source (a later source wins on a duplicate id). The lookup index the loop's
 * provenance normalization consults so a DISCOVERED model normalizes by the
 * cache, not by the rule layer.
 */
export function discoveredIndex(cache: DiscoveredCache): Map<string, ModelIdentity> {
  const index = new Map<string, ModelIdentity>();
  for (const source of Object.values(cache.sources)) {
    for (const model of source.models) index.set(model.raw, model);
  }
  return index;
}

/**
 * Resolve a served id consulting the discovered cache [CLM-0087]: vendored
 * catalog TABLE → discovered cache → rule → unknown. A vendored table hit always
 * wins (the reviewed snapshot is the most trusted). Otherwise, if the id was
 * DISCOVERED (the endpoint served it), return its cached normalized identity —
 * so a discovered model normalizes by the cache rather than degrading to a bare
 * rule parse. Falls through to the pure {@link resolveIdentity} (rule → unknown)
 * for an id neither catalogued nor discovered. Never throws.
 */
export function resolveWithDiscovered(
  rawId: string,
  catalog: Catalog,
  cache: DiscoveredCache,
): ModelIdentity {
  if (catalog.models[rawId] !== undefined) return resolveIdentity(rawId, catalog); // table wins
  const discovered = discoveredIndex(cache).get(rawId);
  if (discovered !== undefined) return discovered;
  return resolveIdentity(rawId, catalog); // rule → unknown
}
