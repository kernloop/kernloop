/**
 * The vendored model catalog [CLM-0080] — a PINNED models.dev-pattern snapshot
 * (spec §8.4 "volatile tier→concrete-model bindings live in overlay/catalog
 * config"). It is data, not a fetch: discovery via a provider's `/v1/models`
 * endpoint is a LATER phase, and this faculty makes NO HTTP call, touches no
 * secret, and never reaches the network. The snapshot is stamped with a
 * hardcoded date because `Date.now` is unavailable in this repo; refresh is a
 * re-pin (a reviewed edit to `catalog/models.json`), never a runtime mutation.
 *
 * Keys are the served aliases/ids the adapters' served models normalize to — incl.
 * the gemini model family, still reachable via agy/an api endpoint after the gemini
 * CLI adapter was retired (#387) (the
 * adapter `tierBinding` values — `opus`, `gemini-3.1-pro`, … — plus common
 * codex/ollama ids), NOT the whole model world: the catalog is deliberately
 * small, covering only what the loop can serve. Each entry carries the
 * structural identity (family/generation/variant/tier) and the nullable cost
 * metadata an honest `ModelIdentity` needs.
 *
 * `loadCatalog` validates the raw JSON through zod at this boundary, so a
 * malformed snapshot fails loudly at load rather than yielding a half-typed
 * catalog downstream.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ModelTierSchema } from '@kernloop/contracts';

/**
 * One catalogued model — the metadata a `table`-resolved {@link
 * import('@kernloop/contracts').ModelIdentity} carries. Cost/context are
 * present here (a catalogued model is, by definition, known); the nullable
 * shape on the identity itself exists for the `rule`/`unknown` resolutions.
 */
export const CatalogEntrySchema = z.strictObject({
  provider: z.string().min(1),
  family: z.string().min(1),
  generation: z.string().min(1),
  variant: z.string().nullable(),
  tier: ModelTierSchema,
  contextWindow: z.number().int().positive(),
  inputCostPerMTok: z.number().nonnegative(),
  outputCostPerMTok: z.number().nonnegative(),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;

/** The whole vendored snapshot: a pin date plus the alias/id → entry table. */
export const CatalogSchema = z.strictObject({
  /** Hardcoded pin date (Date.now is unavailable); the snapshot's provenance. */
  snapshot: z.string().min(1),
  /** Human-facing note on what the catalog is and how it is refreshed. */
  note: z.string().min(1),
  /** Served alias/id → its catalogued identity. */
  models: z.record(z.string(), CatalogEntrySchema),
});
export type Catalog = z.infer<typeof CatalogSchema>;

/**
 * Parse + validate a raw snapshot object into a {@link Catalog}. Pure: the
 * caller supplies the parsed JSON, this enforces the schema (zod at the
 * boundary). Throws on a malformed snapshot — honesty over a silently
 * half-loaded catalog.
 */
export function parseCatalog(raw: unknown): Catalog {
  return CatalogSchema.parse(raw);
}

/**
 * Load the vendored snapshot from `catalog/models.json` next to this module.
 * Read once at import time into {@link catalog}; this function exists so a test
 * can re-load explicitly. The path resolves relative to the built module so it
 * works from `dist/` (the JSON is shipped alongside).
 */
export function loadCatalog(): Catalog {
  const file = fileURLToPath(new URL('./catalog/models.json', import.meta.url));
  return parseCatalog(JSON.parse(readFileSync(file, 'utf8')));
}

/** The loaded vendored catalog — read once; pure data thereafter. */
export const catalog: Catalog = loadCatalog();
