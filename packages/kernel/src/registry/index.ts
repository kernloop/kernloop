/**
 * Kernel ManifestRegistry (spec §3.1) — public surface of the registry
 * module.
 *
 * @module kernel/registry
 */

export {
  ManifestRegistry,
  ManifestRegistryError,
  type ManifestRegistryErrorCode,
} from './manifest-registry.js';
