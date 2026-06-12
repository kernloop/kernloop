/**
 * @kernloop/faculty-models — Layer 2 model-identity normalization faculty
 * (spec §5.7 (Models), §8.4 two-axis model design) [CLM-0080].
 *
 * The SUPPLY side of the model story: where {@link
 * import('@kernloop/contracts').ModelRequirement} is the DEMAND a component
 * declares, this faculty normalizes the served alias/id the loop resolved into a
 * {@link ModelIdentity} — the real model class behind a harness-specific string
 * — so provenance (and a later phase's fitness) name a model honestly, admitting
 * an unrecognized one rather than guessing.
 *
 * Pure and offline by construction: `resolveIdentity` does no I/O and no model
 * call; the catalog is a VENDORED JSON snapshot, not a fetch (no HTTP, no
 * secrets, no network). The discovered-cache module (`discovered.ts`) is the
 * persistence + lookup side of model discovery [CLM-0087] — it normalizes the
 * ids an endpoint served through the SAME pure resolver and reads a
 * machine-local cache file, but makes NO HTTP call and has no clock itself: the
 * actual `/v1/models` / `/api/tags` enumeration lives in the kernel adapter, and
 * the CLI (which has a clock) stamps the cache. The faculty imports only
 * @kernloop/contracts and external deps (constitutional rule 5); the loop wiring
 * lives in @kernloop/cli, which composes faculties.
 */
export { resolveIdentity } from './resolve.js';
export {
  catalog,
  loadCatalog,
  parseCatalog,
  CatalogSchema,
  CatalogEntrySchema,
  type Catalog,
  type CatalogEntry,
} from './catalog.js';
export { modelsManifest } from './manifest.js';
export {
  mergeDiscovered,
  upsertSource,
  loadDiscoveredCache,
  emptyDiscoveredCache,
  discoveredIndex,
  resolveWithDiscovered,
  DiscoveredCacheSchema,
  DiscoveredSourceSchema,
  type DiscoveredCache,
  type DiscoveredSource,
} from './discovered.js';
export { ModelIdentitySchema, type ModelIdentity } from '@kernloop/contracts';
